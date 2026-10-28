// The built-in Profile chip, first in the header: opens your own forum profile through the
// engine's viewProfile, under the same profileRef rule as the user menu. Absent when the
// engine has profiles off; disabled until your own row is in the list (B4).

import { ICONS, renderIcon } from './icons.js';
import { profileID } from './menuModel.js';

/**
 * @param {{
 *   doc: Document,
 *   engine: import('./engine.js').Engine,
 *   store: import('./userList.js').UserStore,
 *   onError: (err: unknown) => void,
 * }} deps
 * @returns {{ el: HTMLButtonElement, destroy: () => void }}
 */
export function createProfileChip({ doc, engine, store, onError }) {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'tdf-rail-chip tdf-rail-profile';
  el.title = 'Your profile';
  el.setAttribute('aria-label', 'Your profile');
  const icon = doc.createElement('span');
  icon.className = 'tdf-rail-icon';
  renderIcon(icon, ICONS.user);
  el.appendChild(icon);

  const self = () => {
    const uID = engine.uID();
    for (const room of store.rooms()) {
      const own = room.users.find((u) => u.uuID === uID);
      if (own) return own;
    }
    return null;
  };

  const update = () => {
    el.hidden = !engine.flags().profileOn;
    el.disabled = !self();
  };

  el.addEventListener('click', () => {
    const own = self();
    if (!own) return;
    try {
      engine.call([['viewProfile', profileID(own, engine.flags().profileRef), own.rawName]]);
    } catch (err) {
      onError(err);
    }
  });

  update();
  return { el, destroy: store.subscribe(update) };
}
