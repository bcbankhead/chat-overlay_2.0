// The name menu: a left or right click on a user's name opens it leftward from the pointer,
// clamped to the viewport. Whisper (or Stop whispering, for the user already whispered to)
// comes first and replaces the engine's Whisper To field; then the rest of userPanel's
// engine-gated actions, then registered ones. Esc, a press outside it or a scroll closes it.

import { listUserMenuActions } from './api.js';
import { renderIcon } from './icons.js';
import { builtInActions } from './menuModel.js';

const EDGE = 8;

/**
 * @param {{
 *   doc: Document,
 *   win: Window,
 *   engine: import('./engine.js').Engine,
 *   parent: HTMLElement,
 *   onError: (err: unknown) => void,
 * }} deps
 */
export function createNameMenu({ doc, win, engine, parent, onError }) {
  const menu = doc.createElement('div');
  menu.className = 'tdf-rail-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  parent.appendChild(menu);

  /** @param {() => void} fn */
  const attempt = (fn) => {
    try {
      fn();
    } catch (err) {
      onError(err);
    }
  };

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
  }

  /**
   * @param {{ id: string, label: string, icon?: string, disabled?: boolean, run: () => void }} item
   */
  function renderItem(item) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tdf-rail-menu-item';
    button.setAttribute('role', 'menuitem');
    button.dataset.action = item.id;
    button.disabled = Boolean(item.disabled);
    if (item.icon) {
      const icon = doc.createElement('span');
      icon.className = 'tdf-rail-glyph';
      renderIcon(icon, item.icon);
      button.appendChild(icon);
    }
    button.append(item.label);
    button.addEventListener('click', () => {
      close();
      attempt(item.run);
    });
    return button;
  }

  /**
   * @param {import('./rowParse.js').RailUser} user
   * @param {number} x  pointer clientX
   * @param {number} y  pointer clientY
   */
  function open(user, x, y) {
    const builtIn = builtInActions(user, engine.flags());
    // #whisperID is read on open (Shared Contract, Single wrappers); whisperUser stores the
    // decoded name there (message.js.php:682).
    const target = /** @type {HTMLInputElement | null} */ (doc.getElementById('whisperID'))?.value ?? '';
    const self = engine.uID() === user.uuID;
    const whispering = !self && target !== '' && target === user.name;

    /** @type {{ id: string, label: string, icon?: string, disabled?: boolean, run: () => void }[]} */
    const items = [
      whispering
        ? { id: 'stop-whisper', label: 'Stop whispering', run: () => engine.call([['clearWhisper']]) }
        : // It stands in for the engine's Whisper To field, which no group gate guarded, so it
          // calls whisperUser as that field's use did, not userPanel's gated whisper.
          { id: 'whisper', label: 'Whisper', disabled: self, run: () => engine.call([['whisperUser', user.rawName]]) },
      ...builtIn.map((a) => ({ id: a.id, label: a.label, run: () => engine.call(a.calls) })),
      ...listUserMenuActions(user, onError).map((a) => ({ id: a.id, label: a.label, icon: a.icon, run: () => a.run(user) })),
    ];

    const title = doc.createElement('div');
    title.className = 'tdf-rail-menu-title';
    title.textContent = user.name;
    menu.replaceChildren(title);
    for (const item of items) {
      try {
        menu.appendChild(renderItem(item));
      } catch (err) {
        onError(err);
      }
    }
    menu.hidden = false;

    // Leftward from the pointer, toward the message view, kept inside the viewport.
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(EDGE, x - width);
    const top = Math.max(EDGE, Math.min(y, win.innerHeight - height - EDGE));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  /** @param {Event} event */
  const onPress = (event) => {
    const node = /** @type {Node | null} */ (event.target);
    if (!menu.hidden && node && !menu.contains(node)) close();
  };
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  doc.addEventListener('mousedown', onPress, true);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('scroll', close, true);
  win.addEventListener('resize', close);

  return {
    open,
    close,
    destroy() {
      close();
      doc.removeEventListener('mousedown', onPress, true);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('scroll', close, true);
      win.removeEventListener('resize', close);
      menu.remove();
    },
  };
}
