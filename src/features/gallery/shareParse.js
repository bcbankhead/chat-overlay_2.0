// Text rules for shared images and the gallery's size limit. Pure: no DOM, no network.
// A share arrives as `[[img src="plugins/share/view.php?id=<digits>" ...]]` in a message's
// text field (reference/ANALYSIS.md, Images); the share id is the `images` key and the URL
// is derived from it, so a host or path change does not duplicate entries.

// Ids are usually 15 digits but not always: 17933387086952 was seen live (2026-10-30). Six is
// the floor, since a like names its image by the id's last six digits (tagging/reactions.js).
const SHARE_ID = /plugins\/share\/view\.php\?id=(\d{6,})(?!\d)/g;
const SHARE_PATH = 'plugins/share/view.php?id=';

/**
 * Every share id in a message's text, first occurrence order, without duplicates.
 * @param {string} text
 * @returns {string[]}
 */
export function extractShareIds(text) {
  return [...new Set([...String(text).matchAll(SHARE_ID)].map((m) => m[1]))];
}

/**
 * The image's URL, derived from its share id against the chat page's address.
 * @param {string} id
 * @param {string} base
 * @returns {string}
 */
export function shareUrl(id, base) {
  return new URL(SHARE_PATH + encodeURIComponent(id), base).href;
}

/**
 * @typedef {object} LimitItem
 * @property {string} id
 * @property {number} receivedAt
 * @property {number} bytes      stored on disk for the record: original (if kept) plus thumbnail
 * @property {boolean} [favorite]
 */

/**
 * The ids to delete for the gallery to fit `limitBytes`: oldest non-favourites first, until
 * it fits or none are left. A favourite is never chosen, though its bytes count.
 * @param {LimitItem[]} items
 * @param {number} limitBytes
 * @returns {string[]}
 */
export function overLimit(items, limitBytes) {
  let total = items.reduce((sum, item) => sum + (item.bytes || 0), 0);
  /** @type {string[]} */
  const ids = [];
  const candidates = items.filter((item) => !item.favorite).sort((a, b) => a.receivedAt - b.receivedAt);
  for (const item of candidates) {
    if (total <= limitBytes) break;
    ids.push(item.id);
    total -= item.bytes || 0;
  }
  return ids;
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

/** The size at which a tile's size chip turns orange: 1 MB in formatBytes's binary units. */
export const LARGE_BYTES = 1024 * 1024;

/**
 * Whether a record's size on disk reads as large on its tile.
 * @param {number} bytes
 * @returns {boolean}
 */
export function isLarge(bytes) {
  return bytes >= LARGE_BYTES;
}

/**
 * A byte count for the header: `0 B`, `512 B`, `14.2 KB`, `3.1 MB`.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  let value = Math.max(0, bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
}
