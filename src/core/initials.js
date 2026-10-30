// The initials tile shown for a user with no avatar (TDF-0013): two letters and a palette
// slot, both derived from the name alone, so a name looks the same on every install. The
// slot is a selector, not a colour (Vector 18): theme.css maps it to --tdf-tile-<slot> per
// theme, so a theme change never leaves a stale colour behind.

import { safeDecodeURIComponent } from './parse.js';

/** Palette slots theme.css defines (`--tdf-tile-0` to `--tdf-tile-7`). */
export const TILE_SLOTS = 8;

/**
 * The tile's letters: the first letter of the name plus the first capital after it, else
 * its second letter. Non-letters are skipped; one letter gives one, none gives `?`.
 * bobSmith → BS, Alice → AL, alice → AL, `Cobra 666` → CO, `_x` → X.
 * @param {string} name the user name, raw or decoded
 * @returns {string}
 */
export function initials(name) {
  const letters = safeDecodeURIComponent(name).match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return '?';
  const [first, ...rest] = letters;
  const capital = rest.find((c) => /\p{Lu}/u.test(c));
  return (first + (capital ?? rest[0] ?? '')).toUpperCase();
}

/**
 * The palette slot for a name: an FNV-1a hash of the decoded name, mod TILE_SLOTS.
 * @param {string} name
 * @returns {number}
 */
export function tileSlot(name) {
  const text = safeDecodeURIComponent(name);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % TILE_SLOTS;
}
