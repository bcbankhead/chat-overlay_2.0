// The media popover's roster (TDF-0035): the items it steps through, and the pure arithmetic
// of stepping and of the filmstrip's window. No DOM: lightbox.js renders, and each entry point
// (the chat's share images, the gallery's shown tiles) builds the items.

/**
 * What an item is shown as. `unknown` until the popover has tried it: an `<img>` first, then a
 * `<video>` when the image fails to load.
 * @typedef {'image' | 'video' | 'unknown'} MediaKind
 */

/**
 * @typedef {object} MediaItem
 * @property {string} id         the share id, which identifies the item across the roster
 * @property {string} src        what the popover's stage loads
 * @property {string | null} thumb  the filmstrip thumbnail's URL; null has none
 * @property {MediaKind} kind
 */

/**
 * The index `delta` steps from `index`, clamped to the roster: it does not wrap.
 * @param {number} index
 * @param {number} delta
 * @param {number} length
 * @returns {number}  -1 for an empty roster
 */
export function step(index, delta, length) {
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.max(0, index + delta));
}

/**
 * The filmstrip's window: at most `slots` consecutive indexes around `index`, centred on it
 * where the roster allows and shifted inward at either end, so the window stays full.
 * @param {number} index
 * @param {number} length
 * @param {number} slots
 * @returns {{ start: number, end: number }}  half-open, `start` inclusive and `end` exclusive
 */
export function filmstripWindow(index, length, slots) {
  if (length <= 0 || slots <= 0) return { start: 0, end: 0 };
  const size = Math.min(slots, length);
  const at = Math.min(length - 1, Math.max(0, index));
  const start = Math.min(length - size, Math.max(0, at - Math.floor((size - 1) / 2)));
  return { start, end: start + size };
}

/**
 * The items with each share id kept once, at its first occurrence.
 * @template {MediaItem} T
 * @param {readonly T[]} items
 * @returns {T[]}
 */
export function dedupe(items) {
  /** @type {Set<string>} */
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
