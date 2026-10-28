// The built-in Users panel: room and status pickers, then the current room's users. Each
// user row is an accordion holding the engine-gated built-in actions, then registered ones.

import { listUserMenuActions, onRegistryChange } from './api.js';
import { builtInActions } from './menuModel.js';
import { readRooms } from './rowParse.js';
import { renderRoomPicker } from './roomPicker.js';
import { renderStatusPicker, statusFromText } from './statusPicker.js';

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
 * @param {{ doc: Document, engine: import('./engine.js').Engine, store: UserStore, onError: (err: unknown) => void }} deps
 * @returns {import('./api.js').RailPanel}
 */
export function createUsersPanel({ doc, engine, store, onError }) {
  /** @type {number | null} chosen in the rail this page load; outranks what the engine shows */
  let chosenStatus = null;

  /** @param {() => void} fn */
  const attempt = (fn) => {
    try {
      fn();
    } catch (err) {
      onError(err);
    }
  };

  return {
    id: 'users',
    title: 'Users',
    icon: '\u{1F465}',
    order: 0,
    render(container) {
      /** @type {string | null} uuID of the expanded row, kept across re-renders */
      let expanded = null;

      function render() {
        const rooms = store.rooms();
        const current = engine.roomID();
        const room = rooms.find((r) => r.roomID === current);
        const statuses = engine.statuses();
        const own = room?.users.find((u) => u.uuID === engine.uID());
        const status = chosenStatus ?? engine.selectedStatus() ?? (own && statusFromText(own.statusText, statuses)) ?? 1;

        const header = doc.createElement('div');
        header.className = 'tdf-rail-header';
        header.append(
          renderRoomPicker({ doc, rooms, current, onPick: (id) => attempt(() => engine.changeRooms(id)) }),
          renderStatusPicker({
            doc,
            statuses,
            current: status,
            // Re-rendered either way: a refused pick puts the picker back on the real status.
            onPick: (index) => {
              attempt(() => {
                engine.sendStatus(index);
                chosenStatus = index;
              });
              render();
            },
          }),
        );

        const list = doc.createElement('ul');
        list.className = 'tdf-rail-users';
        for (const user of room?.users ?? []) list.appendChild(renderUser(user));
        if (!room) {
          const empty = doc.createElement('li');
          empty.className = 'tdf-rail-empty';
          empty.textContent = 'The user list is not available.';
          list.appendChild(empty);
        }
        container.replaceChildren(header, list);
      }

      /** @param {import('./rowParse.js').RailUser} user */
      function renderUser(user) {
        const li = doc.createElement('li');
        li.className = 'tdf-rail-user';
        li.dataset.uuid = user.uuID;
        const toggle = doc.createElement('button');
        toggle.type = 'button';
        toggle.className = 'tdf-rail-user-name';
        toggle.setAttribute('aria-expanded', String(expanded === user.uuID));
        const name = doc.createElement('span');
        name.textContent = user.name;
        toggle.appendChild(name);
        if (user.statusText.trim()) {
          const status = doc.createElement('span');
          status.className = 'tdf-rail-user-status';
          status.textContent = user.statusText.trim();
          toggle.appendChild(status);
        }
        toggle.addEventListener('click', () => {
          expanded = expanded === user.uuID ? null : user.uuID;
          render();
        });
        li.appendChild(toggle);
        if (expanded === user.uuID) li.appendChild(renderMenu(user));
        return li;
      }

      /** @param {import('./rowParse.js').RailUser} user */
      function renderMenu(user) {
        const menu = doc.createElement('div');
        menu.className = 'tdf-rail-menu';
        menu.setAttribute('role', 'menu');
        /** @type {{ id: string, label: string, run: () => void }[]} */
        const items = [
          ...builtInActions(user, engine.flags()).map((a) => ({ id: a.id, label: a.label, run: () => engine.call(a.calls) })),
          ...listUserMenuActions(user, onError).map((a) => ({
            id: a.id,
            label: a.icon ? `${a.icon} ${a.label}` : a.label,
            run: () => a.run(user),
          })),
        ];
        for (const item of items) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'tdf-rail-action';
          button.setAttribute('role', 'menuitem');
          button.dataset.action = item.id;
          button.textContent = item.label;
          button.addEventListener('click', () => {
            // The engine closes its panel after an action; the accordion does the same.
            expanded = null;
            attempt(item.run);
            render();
          });
          menu.appendChild(button);
        }
        if (items.length === 0) {
          const none = doc.createElement('div');
          none.className = 'tdf-rail-empty';
          none.textContent = 'No actions';
          menu.appendChild(none);
        }
        return menu;
      }

      render();
      const offStore = store.subscribe(render);
      const offRegistry = onRegistryChange(render, onError);
      return () => {
        offStore();
        offRegistry();
      };
    },
  };
}
