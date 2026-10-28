// The sidebar's rooms: each a chip-accordion (name, count, caret) over its user list. The
// current room is open by default and fills the height; the others sit collapsed at the
// bottom, and an expanded one offers Join room. A name opens the name menu.

import { ICONS, renderIcon } from './icons.js';
import { readRooms } from './rowParse.js';

/**
 * @typedef {object} UserStore
 * @property {() => import('./rowParse.js').RailRoom[]} rooms
 * @property {(fn: () => void) => () => void} subscribe
 */

/**
 * Watch #userContainer and publish its rooms. The engine rewrites status spans on every
 * poll, so subscribers are told only when what was read actually changed.
 * @param {Window} win
 * @param {HTMLElement} container
 * @param {(err: unknown) => void} onError
 */
export function createUserStore(win, container, onError) {
  /** @type {import('./rowParse.js').RailRoom[]} */
  let rooms = readRooms(container);
  let snapshot = JSON.stringify(rooms);
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let scheduled = false;

  function refresh() {
    scheduled = false;
    /** @type {import('./rowParse.js').RailRoom[]} */
    let next;
    try {
      next = readRooms(container);
    } catch (err) {
      onError(err);
      return;
    }
    const nextSnapshot = JSON.stringify(next);
    if (nextSnapshot === snapshot) return;
    rooms = next;
    snapshot = nextSnapshot;
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        onError(err);
      }
    }
  }

  const observer = new win.MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    win.requestAnimationFrame(refresh);
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });

  return {
    rooms: () => rooms,
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    disconnect: () => observer.disconnect(),
  };
}

/**
 * @typedef {object} RoomView
 * @property {HTMLElement} section
 * @property {HTMLButtonElement} chip
 * @property {HTMLElement} name
 * @property {HTMLElement} count
 * @property {HTMLButtonElement} join
 * @property {HTMLElement} scroll   the scroll area, holding the floating thumb and `list`
 * @property {HTMLUListElement} list
 * @property {() => void} detach    the scroll area's floating scrollbar
 */

/**
 * The rooms, rendered into the sidebar's `current` and `others` slots. Each room keeps its
 * elements across re-renders, so a poll update leaves its scroll position alone.
 * @param {{
 *   doc: Document,
 *   engine: import('./engine.js').Engine,
 *   store: UserStore,
 *   attachScrollbar: (el: HTMLElement) => () => void,
 *   onUser: (user: import('./rowParse.js').RailUser, x: number, y: number) => void,
 *   onError: (err: unknown) => void,
 * }} deps
 * @returns {(slots: { current: HTMLElement, others: HTMLElement }) => () => void} mount, returning unmount
 */
export function createRoomList({ doc, engine, store, attachScrollbar, onUser, onError }) {
  return (slots) => {
    /** @type {Map<string, boolean>} opened or closed by the user, this page load */
    const chosen = new Map();
    /** @type {Map<string, RoomView>} */
    const views = new Map();
    /** @type {Map<string, import('./rowParse.js').RailUser>} by `uuID|roomID`, for the name menu */
    let users = new Map();

    const empty = doc.createElement('div');
    empty.className = 'tdf-rail-empty';
    empty.textContent = 'The user list is not available.';

    /** @param {string} roomID */
    function view(roomID) {
      const known = views.get(roomID);
      if (known) return known;
      const section = doc.createElement('section');
      section.className = 'tdf-rail-room';
      section.dataset.room = roomID;
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'tdf-rail-room-chip';
      const name = doc.createElement('span');
      name.className = 'tdf-rail-room-name';
      const count = doc.createElement('span');
      count.className = 'tdf-rail-room-count';
      const caret = doc.createElement('span');
      caret.className = 'tdf-rail-caret';
      renderIcon(caret, ICONS.caret);
      chip.append(name, count, caret);
      chip.addEventListener('click', () => {
        chosen.set(roomID, !section.classList.contains('tdf-open'));
        render();
      });
      const join = doc.createElement('button');
      join.type = 'button';
      join.className = 'tdf-rail-join';
      join.textContent = 'Join room';
      join.addEventListener('click', () => {
        try {
          engine.changeRooms(roomID);
        } catch (err) {
          onError(err);
        }
      });
      const scroll = doc.createElement('div');
      scroll.className = 'tdf-rail-users';
      const list = doc.createElement('ul');
      scroll.appendChild(list);
      section.append(chip, join, scroll);
      /** @type {RoomView} */
      const made = { section, chip, name, count, join, scroll, list, detach: attachScrollbar(scroll) };
      views.set(roomID, made);
      return made;
    }

    /** @param {import('./rowParse.js').RailUser} user */
    function renderUser(user) {
      const li = doc.createElement('li');
      li.className = 'tdf-rail-user';
      li.dataset.uuid = user.uuID;
      li.dataset.room = user.roomID;
      const img = doc.createElement('img');
      img.className = 'tdf-rail-avatar';
      img.alt = '';
      if (user.avatar) img.src = `avatars/${user.avatar}`;
      const name = doc.createElement('span');
      name.className = 'tdf-rail-user-name';
      name.textContent = user.name;
      li.append(img, name);
      // The engine's own list shows BRB, Away and Idle beside the name; so does this one.
      const status = user.statusText.trim();
      if (status) {
        const tag = doc.createElement('span');
        tag.className = 'tdf-rail-user-status';
        tag.textContent = status;
        li.appendChild(tag);
      }
      return li;
    }

    /**
     * Put `children` into `parent` in order, moving only what is out of place: a scroll
     * area taken out of the document loses its position.
     * @param {HTMLElement} parent
     * @param {HTMLElement[]} children
     */
    function arrange(parent, children) {
      children.forEach((child, i) => {
        if (parent.children[i] !== child) parent.insertBefore(child, parent.children[i] ?? null);
      });
      while (parent.children.length > children.length) parent.lastElementChild?.remove();
    }

    function render() {
      const rooms = store.rooms();
      const current = engine.roomID();
      const live = new Set(rooms.map((r) => r.roomID));
      for (const [id, v] of views) {
        if (live.has(id)) continue;
        v.detach();
        views.delete(id);
      }
      users = new Map();
      /** @type {HTMLElement[]} */
      const others = [];
      /** @type {HTMLElement | null} */
      let here = null;
      for (const room of rooms) {
        const v = view(room.roomID);
        const isCurrent = room.roomID === current;
        const open = chosen.get(room.roomID) ?? isCurrent;
        v.section.classList.toggle('tdf-current', isCurrent);
        v.section.classList.toggle('tdf-open', open);
        v.chip.setAttribute('aria-expanded', String(open));
        v.name.textContent = room.name || room.roomID;
        v.count.textContent = String(room.count);
        v.join.hidden = isCurrent || !open;
        v.scroll.hidden = !open;
        /** @type {HTMLElement[]} */
        const rows = room.users.map(renderUser);
        if (rows.length === 0) {
          const none = doc.createElement('li');
          none.className = 'tdf-rail-empty';
          none.textContent = 'Nobody here';
          rows.push(none);
        }
        v.list.replaceChildren(...rows);
        for (const user of room.users) users.set(`${user.uuID}|${user.roomID}`, user);
        if (isCurrent) here = v.section;
        else others.push(v.section);
      }
      arrange(slots.current, [here ?? empty]);
      arrange(slots.others, others);
    }

    /** @param {MouseEvent} event */
    const onName = (event) => {
      const target = /** @type {Element | null} */ (event.target);
      const row = /** @type {HTMLElement | null} */ (target?.closest?.('.tdf-rail-user') ?? null);
      const user = row && users.get(`${row.dataset.uuid}|${row.dataset.room}`);
      if (!user) return;
      event.preventDefault();
      try {
        onUser(user, event.clientX, event.clientY);
      } catch (err) {
        onError(err);
      }
    };
    for (const slot of [slots.current, slots.others]) {
      slot.addEventListener('click', onName);
      slot.addEventListener('contextmenu', onName);
    }

    render();
    const offStore = store.subscribe(render);
    return () => {
      offStore();
      for (const slot of [slots.current, slots.others]) {
        slot.removeEventListener('click', onName);
        slot.removeEventListener('contextmenu', onName);
      }
      for (const v of views.values()) v.detach();
      views.clear();
    };
  };
}
