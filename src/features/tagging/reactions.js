// Reaction text rules. Pure: no DOM, no engine. A reaction is a whole message: a bare smilie
// code, `<code> ^<last 6 digits of the share id>` naming the image, or `-<code> ^<suffix>`
// taking the sender's reaction back. Codes are the engine's own `mySmilies`, matched
// case-sensitively as the engine does; the stored text keeps the raw code, since smilies are
// expanded only at render. A sender's text style wraps the whole message in `[b]…[/b]`,
// `[i]…[/i]` or `[u]…[/u]` (message.js.php addMessage), so those wrappers are not part of it.

/** Digits of the share id a token carries. */
const SUFFIX_LENGTH = 6;

/**
 * @typedef {object} Reaction
 * @property {string} code
 * @property {string | null} suffix  null for a bare reaction
 * @property {boolean} retract
 */

const TOKEN = /^(.+?)\s+\^(\d{6})$/;
/** One text-style wrapper the engine adds: `[b]<message> [/b]`, and the same for i and u. */
const STYLE = /^\[([biu])\]([\s\S]*)\[\/\1\]$/;

/**
 * The text without its text-style wrappers, trimmed.
 * @param {string} text
 * @returns {string}
 */
function unstyled(text) {
  let t = String(text).trim();
  for (let m = STYLE.exec(t); m; m = STYLE.exec(t)) t = m[2].trim();
  return t;
}

/**
 * The reaction a message's text is, or null when it is anything else.
 * @param {string} text
 * @param {readonly string[]} codes
 * @returns {Reaction | null}
 */
export function parseReaction(text, codes) {
  const t = unstyled(text);
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
