// The sidebar's rooms: each a chip-accordion (name, count, caret) over its user list. The
// current room is open by default and fills the height; the others sit collapsed at the
// bottom, and an expanded one offers Join room. A name opens the name menu. Below the current
// room's online users, under a rule and a `Recently online` header, the users its entry and exit
// lines name who are not online show ghosted (TDF-0058). A ghosted row opens the name menu's
// offline form: its 'Last seen …' line, View Profile, then the registered actions (TDF-0075,
// TDF-0075.2); the forum userID that View Profile needs comes
// from the user's online rows, this load or saved by an earlier one (core/seenUsers.js).

import { renderAvatar } from '../../core/avatar.js';
import { lastSeenText } from '../../core/lastSeen.js';
import { safeDecodeURIComponent } from '../../core/parse.js';
import { presence as pagePresence } from '../../core/presence.js';
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

/** At most this many rows in the current room's list; online users are never hidden (TDF-0058). */
export const LIST_CAP = 20;

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
 *   onOffline?: (user: import('./menuModel.js').OfflineUser, seenText: string | null, x: number, y: number) => void,
 *   onError: (err: unknown) => void,
 *   avatars?: () => import('../../core/avatarResolver.js').AvatarResolver | null,
 *   seen?: () => import('../../core/seenUsers.js').SeenUsers | null,
 *   presence?: import('../../core/presence.js').Presence,
 * }} deps `avatars` and `seen` are read per render: the bootstrap publishes them after the rail
 *   may mount.
 *   `presence` defaults to the page's store, which the engine hook writes
 * @returns {(slots: { current: HTMLElement, others: HTMLElement }) => () => void} mount, returning unmount
 */
export function createRoomList({
  doc,
  engine,
  store,
  attachScrollbar,
  onUser,
  onOffline = () => {},
  onError,
  avatars = () => null,
  seen = () => null,
  presence = pagePresence,
}) {
  return (slots) => {
    /** @type {Map<string, boolean>} opened or closed by the user, this page load */
    const chosen = new Map();
    /** @type {Map<string, RoomView>} */
    const views = new Map();
    /** @type {Map<string, import('./rowParse.js').RailUser>} by `uuID|roomID`, for the name menu */
    let users = new Map();
    /**
     * Ghosted rows by `uuID|roomID`, with their line's time for the menu's 'Last seen …'.
     * @type {Map<string, { user: import('./menuModel.js').OfflineUser, mTime: string }>}
     */
    let offline = new Map();
    /**
     * What each user's online rows told this page load, by uuID: a ghosted row needs the forum
     * userID under profileRef 2, and the engine's own form of the name. Earlier loads' answers
     * come from `seen()`.
     * @type {Map<string, { userID: string, rawName: string }>}
     */
    const remembered = new Map();
    /** @type {(() => void) | null} the saved users' load notice, once they are published */
    let offSeen = null;

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
      const seenUsers = seen();
      for (const line of away) {
        const known = remembered.get(line.uuID) ?? seenUsers?.get(line.uuID);
        /** @type {import('./menuModel.js').OfflineUser} */
        const user = { uuID: line.uuID, name: line.name, ...(line.rawName ? { rawName: line.rawName } : {}), ...(known ?? {}) };
        offline.set(`${user.uuID}|${room.roomID}`, { user, mTime: line.mTime });
        const li = doc.createElement('li');
        li.className = 'tdf-rail-user tdf-rail-offline';
        li.dataset.uuid = user.uuID;
        li.dataset.room = room.roomID;
        // Every ghosted row says when its user was last seen, on the server's clock (TDF-0066).
        const lastSeen = lastSeenText(line.mTime, presence.serverNow());
        if (lastSeen !== null) li.title = lastSeen;
        // The list re-renders only on store changes, so a quiet room would let the age go stale.
        const refreshSeen = () => {
          const now = lastSeenText(line.mTime, presence.serverNow());
          if (now !== null) li.title = now;
        };
        li.addEventListener('mouseenter', refreshSeen);
        li.addEventListener('focus', refreshSeen);
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
      const saved = seen();
      // Published by the bootstrap, possibly after the first render: its load re-renders, so a
      // ghosted row seen before this page load gets its profile id.
      if (saved && !offSeen) offSeen = saved.subscribe(safeRender);
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
          saved?.remember({ uuID: user.uuID, userID: user.userID, rawName: user.rawName });
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
          const away = /** @type {{ user: import('./menuModel.js').OfflineUser, mTime: string }} */ (offline.get(key));
          onOffline(away.user, lastSeenText(away.mTime, presence.serverNow()), event.clientX, event.clientY);
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
      offSeen?.();
      offSeen = null;
      for (const slot of [slots.current, slots.others]) {
        slot.removeEventListener('click', onName);
        slot.removeEventListener('contextmenu', onName);
      }
      for (const v of views.values()) v.detach();
      views.clear();
    };
  };
}
