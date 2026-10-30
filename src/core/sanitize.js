// Allowlist sanitiser for message HTML. The chat passes raw HTML from any sender
// (`[[`/`]]` → `<`/`>`), so nothing reaches the view without going through here.

const ALLOWED_TAGS = new Set(['A', 'IMG', 'BR', 'B', 'I', 'U', 'PRE', 'SPAN']);

/** Attributes kept per tag; everything else (on*, id, class, …) is dropped. */
const ALLOWED_ATTRS = {
  A: ['href', 'title'],
  IMG: ['src', 'alt', 'title', 'style', 'width', 'height'],
  PRE: ['style'],
  SPAN: ['style'],
};

const ALLOWED_STYLES = new Set(['color', 'font-family', 'white-space', 'max-width', 'max-height']);

/** Whitespace and control characters a browser ignores inside a URL scheme. */
// eslint-disable-next-line no-control-regex
const URL_NOISE = /[\u0000- \u007f-\u009f]/g;

/**
 * @param {string} value
 * @param {string[]} schemes allowed absolute schemes, lower case, with the colon
 */
function safeUrl(value, schemes) {
  const compact = value.replace(URL_NOISE, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*:)/.exec(compact);
  if (!scheme) return true; // relative or protocol-relative
  return schemes.includes(scheme[1]);
}

/** @param {string} style */
function filterStyle(style) {
  const kept = [];
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!ALLOWED_STYLES.has(prop) || value === '') continue;
    if (/url\(|expression|javascript:|[<>\\]/i.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

/** @param {Element} el */
function cleanAttributes(el) {
  const allowed = ALLOWED_ATTRS[/** @type {keyof typeof ALLOWED_ATTRS} */ (el.tagName)] ?? [];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowed.includes(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href' && !safeUrl(attr.value, ['http:', 'https:', 'mailto:'])) {
      el.removeAttribute(attr.name);
    } else if (name === 'src' && !safeUrl(attr.value, ['http:', 'https:'])) {
      el.removeAttribute(attr.name);
    } else if (name === 'style') {
      const style = filterStyle(attr.value);
      if (style) el.setAttribute('style', style);
      else el.removeAttribute(attr.name);
    }
  }
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/** @param {Node} parent */
function walk(parent) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 1) {
      const el = /** @type {Element} */ (node);
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // Disallowed elements are replaced by their text, which renders inert.
        el.replaceWith(el.ownerDocument.createTextNode(el.textContent ?? ''));
        continue;
      }
      cleanAttributes(el);
      walk(el);
    } else if (node.nodeType !== 3) {
      node.parentNode?.removeChild(node); // comments, processing instructions
    }
  }
}

/**
 * Parse untrusted HTML and return a fragment holding only allowlisted markup.
 * @param {string} html
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function sanitize(html, doc = globalThis.document) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  walk(template.content);
  return template.content;
}
