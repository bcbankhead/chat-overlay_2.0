// Text rules for shared images and the gallery's size limit. Pure: no DOM, no network.
// A share arrives as `[[img src="plugins/share/view.php?id=<15 digits>" ...]]` in a message's
// text field (reference/ANALYSIS.md, Images); the share id is the `images` key and the URL
// is derived from it, so a host or path change does not duplicate entries.

const SHARE_ID = /view\.php\?id=(\d{15})(?!\d)/g;
const SHARE_PATH = 'plugins/share/view.php?id=';

/** @type {Record<string, string>} */
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

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
 * File extension for a served content type; `bin` when it is not a known image type.
 * @param {string | null | undefined} contentType
 * @returns {string}
 */
export function extFromType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? 'bin';
}

/**
 * A sender name reduced to filename-safe characters.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeSender(name) {
  let decoded = String(name ?? '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Not URI-encoded: keep it as given.
  }
  const safe = decoded
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 40);
  return safe || 'unknown';
}

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * `<sender>_<YYYY-MM-DD_HHmmss>_<shareId>.<ext>`, in local time. The time is the message's
 * `mTime` (unix seconds); an own pending echo has none, so its `receivedAt` is used (A1).
 * @param {{ sender: string, mTime: string, receivedAt: number, id: string, contentType: string }} image
 * @returns {string}
 */
export function buildFilename({ sender, mTime, receivedAt, id, contentType }) {
  const seconds = Number(mTime);
  const at = new Date(mTime !== '' && Number.isFinite(seconds) ? seconds * 1000 : receivedAt);
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_` +
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${sanitizeSender(sender)}_${stamp}_${id}.${extFromType(contentType)}`;
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
