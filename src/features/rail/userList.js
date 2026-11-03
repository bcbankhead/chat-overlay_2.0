// The sidebar's rooms: each a chip-accordion (name, count, caret) over its user list. The
// current room is open by default and fills the height; the others sit collapsed at the
// bottom, and an expanded one offers Join room. A name opens the name menu. Below the current
// room's online users, under a rule and a `Recently online` header, the users its entry and exit
// lines name who are not online show ghosted; a ghosted row opens the profile only (TDF-0058).

import { renderAvatar } from '../../core/avatar.js';
import { safeDecodeURIComponent } from '../../core/parse.js';
import { presence as pagePresence } from '../../core/presence.js';
import { ICONS, renderIcon } from './icons.js';
import { offlineProfileCall } from './menuModel.js';
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

/** At most this many rows in the current room's list; online users are never hidden (TDF-0058). */
export const LIST_CAP = 20;

/** The one tooltip every inert ghosted row carries, whatever kept it from opening a profile (TDF-0059). */
const OFFLINE_TOOLTIP = 'User offline';

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
 *   avatars?: () => import('../../core/avatarResolver.js').AvatarResolver | null,
 *   presence?: import('../../core/presence.js').Presence,
 * }} deps `avatars` is read per render: the bootstrap publishes it after the rail may mount.
 *   `presence` defaults to the page's store, which the engine hook writes
 * @returns {(slots: { current: HTMLElement, others: HTMLElement }) => () => void} mount, returning unmount
 */
export function createRoomList({
  doc,
  engine,
  store,
  attachScrollbar,
  onUser,
  onError,
  avatars = () => null,
  presence = pagePresence,
}) {
  return (slots) => {
    /** @type {Map<string, boolean>} opened or closed by the user, this page load */
    const chosen = new Map();
    /** @type {Map<string, RoomView>} */
    const views = new Map();
    /** @type {Map<string, import('./rowParse.js').RailUser>} by `uuID|roomID`, for the name menu */
    let users = new Map();
    /** @type {Map<string, import('./menuModel.js').OfflineUser>} ghosted rows by `uuID|roomID` */
    let offline = new Map();
    /**
     * What each user's online rows told this page load, by uuID: a ghosted row needs the forum
     * userID under profileRef 2, and the engine's own form of the name.
     * @type {Map<string, { userID: string, rawName: string }>}
     */
    const remembered = new Map();

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
      const img = renderAvatar(doc, {
        name: safeDecodeURIComponent(user.rawName),
        userID: user.userID,
        file: user.avatar,
        src: `avatars/${user.avatar}`,
        className: 'tdf-rail-avatar',
        resolver: avatars(),
      });
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
     * The current room's ghosted rows: rule, header, then each recently online user not online
     * now, newest line first, as many as the cap leaves room for.
     * @param {import('./rowParse.js').RailRoom} room
     * @param {ReadonlySet<string>} online uuIDs online in any room the rail lists: a user who
     *   moved to another room is not offline
     * @returns {HTMLElement[]}
     */
    function renderOffline(room, online) {
      const cap = Math.max(0, LIST_CAP - room.users.length);
      const away = presence
        .seen(room.roomID)
        .filter((line) => !online.has(line.uuID))
        .slice(0, cap);
      if (away.length === 0) return [];
      const rule = doc.createElement('li');
      rule.className = 'tdf-rail-rule';
      rule.setAttribute('role', 'separator');
      const head = doc.createElement('li');
      head.className = 'tdf-rail-section-head';
      head.textContent = 'Recently online';
      /** @type {HTMLElement[]} */
      const rows = [rule, head];
      const flags = engine.flags();
      for (const line of away) {
        const known = remembered.get(line.uuID);
        /** @type {import('./menuModel.js').OfflineUser} */
        const user = { uuID: line.uuID, name: line.name, ...(line.rawName ? { rawName: line.rawName } : {}), ...(known ?? {}) };
        offline.set(`${user.uuID}|${room.roomID}`, user);
        const li = doc.createElement('li');
        li.className = 'tdf-rail-user tdf-rail-offline';
        li.dataset.uuid = user.uuID;
        li.dataset.room = room.roomID;
        if (!offlineProfileCall(user, flags)) {
          li.classList.add('tdf-rail-inert');
          li.title = OFFLINE_TOOLTIP;
        }
        const img = renderAvatar(doc, {
          name: user.name,
          userID: user.userID ?? '',
          file: '',
          src: '',
          className: 'tdf-rail-avatar',
          resolver: avatars(),
        });
        const name = doc.createElement('span');
        name.className = 'tdf-rail-user-name';
        name.textContent = user.name;
        li.append(img, name);
        rows.push(li);
      }
      return rows;
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
      offline = new Map();
      /** @type {Set<string>} */
      const online = new Set();
      for (const room of rooms) {
        for (const user of room.users) {
          remembered.set(user.uuID, { userID: user.userID, rawName: user.rawName });
          online.add(user.uuID);
        }
      }
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
        // The history poll is per room, so only the current room knows who left it.
        if (isCurrent) rows.push(...renderOffline(room, online));
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
      if (!row) return;
      const key = `${row.dataset.uuid}|${row.dataset.room}`;
      if (row.classList.contains('tdf-rail-offline')) {
        event.preventDefault();
        try {
          // Built in the same render as the row, so a ghosted row always has its user.
          const away = /** @type {import('./menuModel.js').OfflineUser} */ (offline.get(key));
          const call = offlineProfileCall(away, engine.flags());
          if (call) engine.call([call]);
        } catch (err) {
          onError(err);
        }
        return;
      }
      const user = users.get(key);
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

    const safeRender = () => {
      try {
        render();
      } catch (err) {
        onError(err);
      }
    };
    render();
    const offStore = store.subscribe(render);
    const offPresence = presence.subscribe(safeRender);
    return () => {
      offStore();
      offPresence();
      for (const slot of [slots.current, slots.others]) {
        slot.removeEventListener('click', onName);
        slot.removeEventListener('contextmenu', onName);
      }
      for (const v of views.values()) v.detach();
      views.clear();
    };
  };
}
