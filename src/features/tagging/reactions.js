// Reaction text rules. Pure: no DOM, no engine. A reaction is a whole message: a bare smilie
// code, `<code> <token>` naming the image, or `-<code> <token>` taking the sender's reaction
// back (sent only by older installs; still parsed so every install infers alike). The token is
// `^<last 6 digits of the share id>`, sent wrapped in a span coloured like the native chat's
// background so a reader without the script does not see it (TDF-0011); the `[[font color=…]]`
// wrap and the plain token are accepted too. Codes are the engine's own `mySmilies`, matched
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
/** `[[span style=color:#hex]]^123456[[/span]]`, its attribute quoted or not. */
const SPAN_TOKEN = /^(.+?)\s+\[\[span\s+style=(['"]?)color:[^'"\]]+\2\]\]\^(\d{6})\[\[\/span\]\]$/i;
/** `[[font color=#hex]]^123456[[/font]]`, its attribute quoted or not. */
const FONT_TOKEN = /^(.+?)\s+\[\[font\s+color=(['"]?)[^'"\]]+\2\]\]\^(\d{6})\[\[\/font\]\]$/i;
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
 * The head and share-id suffix of a tokened message, in any of its forms, or null.
 * @param {string} t
 * @returns {[string, string] | null}
 */
function tokened(t) {
  const plain = TOKEN.exec(t);
  if (plain) return [plain[1], plain[2]];
  const wrapped = SPAN_TOKEN.exec(t) ?? FONT_TOKEN.exec(t);
  return wrapped ? [wrapped[1], wrapped[3]] : null;
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
  const m = tokened(t);
  if (!m) return null;
  const [head, suffix] = m;
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
 * The message text that likes an image. With `color` (`#rrggbb`) the token is wrapped in a
 * span of that colour; the attribute is unquoted, so the text holds no character the engine
 * escapes and its repeat filter still compares equal (engineSend.js resetRepeat).
 * @param {string} code
 * @param {string} shareId
 * @param {string | null} [color]
 * @returns {string}
 */
export function reactionText(code, shareId, color = null) {
  const token = `^${shareSuffix(shareId)}`;
  return color ? `${code} [[span style=color:${color}]]${token}[[/span]]` : `${code} ${token}`;
}

/** @param {number} n */
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * A CSS colour as `#rrggbb`, or null when it is transparent or not one this reads.
 * Accepts `#rgb`, `#rrggbb` (and their alpha forms) and `rgb()` / `rgba()`, as
 * getComputedStyle reports them.
 * @param {string} css
 * @returns {string | null}
 */
export function toHexColor(css) {
  const s = String(css).trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && h.slice(6) === '00') return null;
    return `#${h.slice(0, 6)}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (!rgb) return null;
  const alpha = rgb[4];
  if (alpha !== undefined && parseFloat(alpha) === 0) return null;
  return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
}
