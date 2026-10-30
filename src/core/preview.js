// Local-only link previews: which preview, if any, a posted link gets. Built from the link
// alone, never from a third-party metadata service. The image or YouTube thumbnail itself is
// still fetched directly by each viewer, with no referrer.

/**
 * A link's preview: the image itself, a YouTube thumbnail, or a hostname chip. `host` is the
 * link's hostname, the chip a failed image or thumbnail falls back to.
 * @typedef {{ kind: 'image', url: string, host: string }
 *   | { kind: 'youtube', id: string, url: string, host: string }
 *   | { kind: 'link', url: string, host: string }} Preview
 */

/** Paths that are direct images, query string ignored. */
const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp)$/i;

/** A YouTube video id: exactly eleven URL-safe base64 characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * The YouTube video id a URL names, or null.
 * @param {URL} url
 * @returns {string | null}
 */
function youtubeId(url) {
  let id = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1);
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.slice('/shorts/'.length);
  }
  return id !== null && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * The thumbnail for a YouTube video id, built from the id alone.
 * @param {string} id
 * @returns {string}
 */
export function youtubeThumb(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

/**
 * The preview a link gets, or null. Only a link written absolute, `http://` or `https://`,
 * previews: relative, protocol-relative and mailto links get none.
 * @param {string} href
 * @returns {Preview | null}
 */
export function previewOf(href) {
  if (!/^https?:\/\//i.test(href)) return null;
  /** @type {URL} */
  let url;
  try {
    url = new URL(href);
  } catch {
    // Expected and harmless: a link the browser cannot parse simply gets no preview, and
    // stays in the message as the sanitiser left it.
    return null;
  }
  const host = url.hostname;
  if (IMAGE_PATH.test(url.pathname)) return { kind: 'image', url: href, host };
  const id = youtubeId(url);
  if (id !== null) return { kind: 'youtube', id, url: href, host };
  return { kind: 'link', url: href, host };
}

/**
 * The preview for a message: its first previewable link that is not already shown as an
 * image. A skipped link passes to the next one.
 * @param {Iterable<string>} hrefs the message's links, in order
 * @param {ReadonlySet<string>} shownSrcs links already on show as images in the message
 * @returns {Preview | null}
 */
export function pickPreview(hrefs, shownSrcs) {
  for (const href of hrefs) {
    if (shownSrcs.has(href)) continue;
    const preview = previewOf(href);
    if (preview) return preview;
  }
  return null;
}
