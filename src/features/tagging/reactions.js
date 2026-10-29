// Reaction text rules. Pure: no DOM, no engine. A reaction is a whole message: a bare smilie
// code, `<code> ^<last 6 digits of the share id>` naming the image, or `-<code> ^<suffix>`
// taking the sender's reaction back. Codes are the engine's own `mySmilies`, matched
// case-sensitively as the engine does; the stored text keeps the raw code, since smilies are
// expanded only at render.

/** The engine's 15 smilie codes (reference/ANALYSIS.md, Smilies), for tests. */
export const SMILIE_CODES_FIXTURE = Object.freeze([
  ':)', ';)', ':P', ':7', ';(', ':(', ':V', '[(', '[x', ':h', '*R', '8)', ':d', ':L', ':o',
]);

/** Digits of the share id a token carries. */
const SUFFIX_LENGTH = 6;

/**
 * @typedef {object} Reaction
 * @property {string} code
 * @property {string | null} suffix  null for a bare reaction
 * @property {boolean} retract
 */

const TOKEN = /^(.+?)\s+\^(\d{6})$/;

/**
 * The reaction a message's text is, or null when it is anything else.
 * @param {string} text
 * @param {readonly string[]} codes
 * @returns {Reaction | null}
 */
export function parseReaction(text, codes) {
  const t = String(text).trim();
  if (codes.includes(t)) return { code: t, suffix: null, retract: false };
  const m = TOKEN.exec(t);
  if (!m) return null;
  const [, head, suffix] = m;
  if (codes.includes(head)) return { code: head, suffix, retract: false };
  if (head.startsWith('-') && codes.includes(head.slice(1))) return { code: head.slice(1), suffix, retract: true };
  return null;
}

/**
 * The share id's last digits, as a token carries them.
 * @param {string} shareId
 * @returns {string}
 */
function shareSuffix(shareId) {
  return shareId.slice(-SUFFIX_LENGTH);
}

/**
 * The message text that reacts to (or, with `retract`, takes back a reaction to) an image.
 * @param {string} code
 * @param {string} shareId
 * @param {boolean} retract
 * @returns {string}
 */
export function reactionText(code, shareId, retract) {
  return `${retract ? '-' : ''}${code} ^${shareSuffix(shareId)}`;
}
