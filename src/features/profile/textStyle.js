// Pure helpers for the Profile flyout's status and text style. The engine's own formats are
// kept exactly: `myTextStyle` is what message.js.php:289 writes and cookie.js.php:58-72 reads
// back; status indices are `userStatusMes`'s (settings.js.php: 0 select, 1 Here, 2 BRB, 3 Away).

/** Status choices, in the engine's `userStatusMes` order from index 1. */
export const STATUSES = /** @type {const} */ ([
  { index: 1, label: 'Here' },
  { index: 2, label: 'BRB' },
  { index: 3, label: 'Away' },
]);

/** Swatches per row, as the engine's `loopColors`. */
export const COLORS_PER_ROW = 12;

/**
 * The engine's text style, as its globals hold it (loosely typed, as the engine is).
 * @typedef {object} TextStyle
 * @property {unknown} mBold
 * @property {unknown} mItalic
 * @property {unknown} mUnderline
 * @property {unknown} textColor
 * @property {unknown} textSize
 * @property {unknown} textFamily
 */

/**
 * The non-empty string entries of an engine list (`myFontFamily`, `myColor`).
 * @param {unknown} raw
 * @returns {string[]}
 */
function entries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === 'string' && v !== '');
}

/**
 * The engine's font families, empty entries dropped.
 * @param {unknown} raw  `myFontFamily`
 * @returns {string[]}
 */
export function fontList(raw) {
  return entries(raw);
}

/**
 * The engine's colours, empty entries dropped.
 * @param {unknown} raw  `myColor`
 * @returns {string[]}
 */
export function colorList(raw) {
  return entries(raw);
}

/**
 * Split `colors` into rows of `perRow`; the last row may be short.
 * @param {string[]} colors
 * @param {number} [perRow]
 * @returns {string[][]}
 */
export function colorRows(colors, perRow = COLORS_PER_ROW) {
  const size = Math.max(1, Math.floor(perRow));
  /** @type {string[][]} */
  const rows = [];
  for (let i = 0; i < colors.length; i += size) rows.push(colors.slice(i, i + size));
  return rows;
}

/**
 * Whether a list entry is the current choice: the engine's defaults differ in case from its
 * lists (`'verdana'` against `"Verdana"`).
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameChoice(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The `myTextStyle` cookie value, in the engine's own format and field order.
 * @param {TextStyle} style
 * @returns {string}
 */
export function styleCookie({ mBold, mItalic, mUnderline, textColor, textSize, textFamily }) {
  return encodeURI([mBold, mItalic, mUnderline, textColor, textSize, textFamily].map((v) => String(v ?? '')).join('|'));
}

/**
 * The status index `#selectStatusID` holds, 1..3; anything else is Here.
 * @param {unknown} selectValue
 * @returns {1 | 2 | 3}
 */
export function statusIndex(selectValue) {
  const n = Number(selectValue);
  return n === 2 || n === 3 ? n : 1;
}
