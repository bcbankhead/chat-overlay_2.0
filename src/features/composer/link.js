// Labelled links for the composer. The chat renders `[[`/`]]` as `<`/`>`, so a link with its
// own label is `[[a href=… target=_blank]]label[[/a]]`. The href is protocol-relative and
// unquoted: addMessage escapes quotes to entities that are never decoded, and the URL
// auto-linker (message.js.php:953) rewrites any `http(s)://` inside the tag.

/**
 * Percent-encoded after the authority: smilie-forming and tag-breaking characters
 * (`:) ;) 8) [( *R` …, quotes, whitespace), `@` (the email linker, message.js.php:928) and
 * `|` (escaped to `&#127;` by addMessage).
 */
const ENCODE = /[()[\];:*'"@|\s]/g;

/**
 * A label the auto-linkers or the tag syntax would rewrite inside the anchor. A trailing `[`
 * would join the closing `[[/a]]` into `[[[`.
 */
const BAD_LABEL = /\[\[|\]\]|[\r\n@]|https?:\/\/|\[$/i;

/**
 * @param {string} text
 * @returns {URL | null}
 */
function parseHttpUrl(text) {
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    // Not a URL: the caller pastes the text as it is, which is the intended outcome.
    return null;
  }
}

/** @param {string} ch */
function percent(ch) {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Whether the text is exactly one http(s) URL, with nothing around it.
 * @param {string} text
 * @returns {boolean}
 */
export function isSingleHttpUrl(text) {
  return parseHttpUrl(text) !== null;
}

/**
 * The composer text for a link to `url` labelled `label`, or null when either cannot be
 * carried intact — the caller then pastes normally.
 * @param {string} url
 * @param {string} label
 * @returns {string | null}
 */
export function buildLabelledLink(url, label) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  // Userinfo feeds the email linker and a port such as `:7` forms a smilie; an IPv6 host
  // carries both colons and brackets.
  if (parsed.username || parsed.password || parsed.port || parsed.hostname.startsWith('[')) return null;
  if (!label.trim() || BAD_LABEL.test(label)) return null;
  const rest = (parsed.pathname + parsed.search + parsed.hash).replace(ENCODE, percent);
  return `[[a href=//${parsed.hostname}${rest} target=_blank]]${label}[[/a]]`;
}
