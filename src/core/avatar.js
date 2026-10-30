// One avatar, wherever a user is shown (TDF-0013): an initials tile, with the picture over
// it once there is one. A picked chat avatar shows at once, as the engine's does. A user who
// never picked one (the engine's `online.gif`), has none, or whose picture fails, gets their
// forum profile picture instead, as does an image-share post (the plugin's globe). That
// picture is added once it has loaded, or at once when this page load already found it; until
// it shows, and whenever it fails too, the tile shows. Never an empty square.

import { initials, tileSlot } from './initials.js';

/**
 * Avatar values that are not the user's picture: `online.gif`, the engine's value for a user
 * who never picked one (a green dot), and `share.gif`, the share plugin's globe on an
 * image-share post.
 */
export const NOT_PICKED = Object.freeze(['online.gif', 'share.gif']);

/**
 * Whether an avatar value names a picture the user picked.
 * @param {string} file
 */
export function isPicked(file) {
  return Boolean(file) && !NOT_PICKED.includes(file);
}

/**
 * @param {Document} doc
 * @param {{
 *   name: string,
 *   userID?: string,
 *   file: string,
 *   src: string,
 *   className: string,
 *   resolver?: import('./avatarResolver.js').AvatarResolver | null,
 * }} options `name` decoded; `file` the engine's avatar value; `src` where that file is served
 * @returns {HTMLSpanElement}
 */
export function renderAvatar(doc, { name, userID = '', file, src, className, resolver = null }) {
  const box = doc.createElement('span');
  box.className = className;
  const tile = doc.createElement('span');
  tile.className = 'tdf-tile';
  tile.dataset.tile = String(tileSlot(name));
  tile.textContent = initials(name);
  tile.setAttribute('aria-hidden', 'true');
  box.appendChild(tile);

  const forum = () => {
    if (!resolver) return;
    const known = resolver.peek?.(name);
    if (known !== undefined) {
      // Already answered: added at once, so a re-rendered row does not flash the tile.
      if (known) show(known, true);
      return;
    }
    resolver.resolve(name, userID).then((url) => {
      if (url) show(url, false);
    });
  };

  /**
   * @param {string} url
   * @param {boolean} now add the picture before it loads, rather than once it has
   */
  function show(url, now) {
    const img = picture();
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = url;
    // Otherwise added on load, so a picture that never arrives never covers the tile.
    if (now || (img.complete && img.naturalWidth)) box.appendChild(img);
    else img.addEventListener('load', () => box.appendChild(img), { once: true });
  }

  if (isPicked(file)) {
    const img = picture();
    img.setAttribute('loading', 'lazy');
    // Expected and harmless: a deleted or broken avatar file loses only the picture.
    img.addEventListener(
      'error',
      () => {
        img.remove();
        forum();
      },
      { once: true },
    );
    img.src = src;
    box.appendChild(img);
  } else {
    forum();
  }
  return box;

  function picture() {
    const img = doc.createElement('img');
    img.className = 'tdf-avatar-img';
    img.alt = '';
    return img;
  }
}
