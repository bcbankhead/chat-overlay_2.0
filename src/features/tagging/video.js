// Uploaded videos in the chat (TDF-0065). A video upload arrives as an upload notice —
// `File Uploaded: [<name>.mp4] - <a href="plugins/share/view.php?id=…">Click Here</a> to view the
// file.` — with no image, so the chat shows a link that opens a new window. When the notice names a
// video file, its body is rebuilt as a small filename caption and a paused <video> on the share URL,
// playable with its own controls, with a small button that opens it in the media quick view (ui.js
// handles the button's click). A share that does arrive as `[[img …]]` markup and fails to load as
// an image is swapped for a video the same way. The share's link is replaced, not kept around the
// video: a control click inside an <a target="_blank"> would follow the link. If the video fails,
// the original notice, or the broken image, comes back as before, is reported with the video's
// MediaError, and is not tried again. A notice video loads nothing until it is played (preload
// none): view.php ignores Range, so even a metadata read can fetch the whole file.
// Tagging-side because core imports nothing from features; the view's per-row ResizeObserver
// re-pins a pinned chat when the row grows, so no scrolling code is needed here.

import { extractShareIds } from '../gallery/shareParse.js';

/** The wrapper an embedded video sits in; it carries the share id and its link's href. */
export const VIDEO = 'tdf-video';
/** The overlay button that opens the video in the quick view. */
export const VIDEO_OPEN = 'tdf-video-open';
/** An upload notice video's filename caption. */
const VIDEO_NAME = 'tdf-video-name';
/** Set on a share image, or an upload notice's row, once a video was tried for it, so it is tried at most once. */
const TRIED = 'data-tdf-tried';
/** An upload notice's text before its link, naming a video file; group 1 is the filename. */
const UPLOAD = /^\s*File Uploaded:\s*\[([^\]]*\.(?:mp4|webm|mov|m4v))\]\s*-\s*$/i;
/** An upload notice's text after its link. */
const UPLOAD_TAIL = /^\s*to view the file\.?\s*$/i;
const SVG = 'http://www.w3.org/2000/svg';
/** An embedded video's starting volume, 30%, so an unexpected play does not deafen the member. */
export const INLINE_VOLUME = 0.3;
/** An expand glyph: four corners. */
const OPEN_PATH = 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5';

/**
 * The share id a chat image links to, or null.
 * @param {Element} img
 * @returns {string | null}
 */
export function imageShareId(img) {
  const link = img.closest('a');
  return extractShareIds(`${link?.getAttribute('href') ?? ''} ${img.getAttribute('src') ?? ''}`)[0] ?? null;
}

/**
 * Whether an element sits in a public message's or a whisper's body.
 * @param {Element} el
 * @returns {boolean}
 */
export function inMediaBody(el) {
  return !!(el.closest('.tdf-msg.tdf-kind-public .tdf-body') || el.closest('.tdf-msg.tdf-kind-whisper .tdf-body'));
}

/**
 * Whether a chat image is one a video may replace: a share in a public message or a whisper's
 * body, outside a link preview, not tried before.
 * @param {Element} img
 * @returns {string | null} its share id, or null when it is not
 */
export function videoCandidate(img) {
  if (img.tagName !== 'IMG' || img.hasAttribute(TRIED)) return null;
  if (img.closest('.tdf-preview')) return null;
  if (!inMediaBody(img)) return null;
  return imageShareId(img);
}

/**
 * The wrapper an embedded video sits in: an optional filename caption, the paused video with its
 * own controls, and the open button.
 * @param {Document} doc
 * @param {{ src: string, href: string, shareId: string, caption?: string, preload: 'none' | 'metadata' }} spec
 * @returns {{ wrapper: HTMLElement, video: HTMLVideoElement }}
 */
function videoWrapper(doc, { src, href, shareId, caption, preload }) {
  const wrapper = doc.createElement('span');
  wrapper.className = VIDEO;
  wrapper.dataset.share = shareId;
  wrapper.dataset.href = href;
  if (caption !== undefined) {
    const name = doc.createElement('span');
    name.className = VIDEO_NAME;
    name.textContent = caption;
    name.title = caption;
    wrapper.appendChild(name);
  }
  const video = doc.createElement('video');
  video.controls = true;
  video.volume = INLINE_VOLUME;
  video.preload = preload;
  video.setAttribute('playsinline', '');
  video.src = src;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = VIDEO_OPEN;
  button.title = 'Open in quick view';
  button.setAttribute('aria-label', 'Open in quick view');
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', OPEN_PATH);
  svg.appendChild(path);
  button.appendChild(svg);
  wrapper.append(video, button);
  return { wrapper, video };
}

/**
 * Replace a share image (its link, else the image) in place with an embedded video. Inside a
 * like frame it takes the old node's place, so the frame's heart and stack survive.
 * @param {Document} doc
 * @param {HTMLImageElement} img
 * @param {string} shareId
 * @returns {{ wrapper: HTMLElement, video: HTMLVideoElement, original: Element }}
 */
export function embedVideo(doc, img, shareId) {
  const original = img.closest('a') ?? img;
  const href = /** @type {HTMLAnchorElement | null} */ (img.closest('a'))?.href ?? img.src;
  const { wrapper, video } = videoWrapper(doc, { src: img.getAttribute('src') ?? '', href, shareId, preload: 'metadata' });
  original.replaceWith(wrapper);
  return { wrapper, video, original };
}

/**
 * The video an upload notice links to, or null. A non-image upload arrives as
 * `<br>File Uploaded: [<name>] - <a href="…view.php?id=…">Click Here</a> to view the file.`; it is
 * a video when the bracketed name ends in a video extension. Only a body that is exactly that
 * notice qualifies, since its whole body is replaced: the link a direct child, with only leading
 * <br>s and the notice text before it and `to view the file.` after it. The link must be a share
 * with no image inside, on the chat's own origin, in a public message's or a whisper's body,
 * outside a link preview.
 * @param {Element} link
 * @returns {{ shareId: string, name: string } | null}  `name` is the filename, extension included
 */
export function uploadVideo(link) {
  if (link.tagName !== 'A' || link.querySelector('img')) return null;
  if (link.closest('.tdf-preview') || !inMediaBody(link)) return null;
  const body = link.parentElement;
  if (!body?.classList.contains('tdf-body')) return null;
  const shareId = extractShareIds(link.getAttribute('href') ?? '')[0];
  if (shareId === undefined) return null;
  if (new URL(/** @type {HTMLAnchorElement} */ (link).href).origin !== new URL(link.ownerDocument.baseURI).origin) return null;
  const nodes = [...body.childNodes];
  const at = nodes.indexOf(link);
  let start = 0;
  while (start < at && nodes[start].nodeName === 'BR') start += 1;
  const before = nodes.slice(start, at);
  const after = nodes.slice(at + 1);
  if (![...before, ...after].every((n) => n.nodeType === 3)) return null;
  const match = UPLOAD.exec(before.map((n) => n.textContent).join(''));
  if (!match || !UPLOAD_TAIL.test(after.map((n) => n.textContent).join(''))) return null;
  return { shareId, name: match[1] };
}

/**
 * Rebuild an upload notice's body as just its video: the filename caption and the paused video,
 * which loads nothing until played, the notice text around the link dropped.
 * @param {Document} doc
 * @param {Element} body
 * @param {HTMLAnchorElement} link
 * @param {string} shareId
 * @param {string} name
 * @returns {{ wrapper: HTMLElement, video: HTMLVideoElement, original: Node[] }}  `original`: the body's old children
 */
export function embedUpload(doc, body, link, shareId, name) {
  const { wrapper, video } = videoWrapper(doc, {
    src: link.getAttribute('href') ?? '',
    href: link.href,
    shareId,
    caption: name,
    preload: 'none',
  });
  const original = [...body.childNodes];
  body.replaceChildren(wrapper);
  return { wrapper, video, original };
}

/**
 * Embed uploaded videos in the chat. An upload notice naming a video is rebuilt as its caption and
 * video: in the rows present at the install (history replay) and in rows added later, seen by an
 * observer created here — before ui.js's, so it runs first on each batch and the like frame is
 * drawn around the video. A share image that fails is swapped for a video: those that fail from
 * now on, and those that already failed before the install, whose one `error` event has passed
 * (the event does not bubble, so it is caught in the capture phase). Each row or image is tried once;
 * a video that fails puts back what it replaced and reports why.
 * @param {{ doc: Document, report?: (err: unknown) => void }} deps  only #tdf-chat acts
 * @returns {() => void} uninstall
 */
export function installChatVideo({ doc, report = (err) => console.error(err) }) {
  /**
   * @param {HTMLVideoElement} video
   * @param {string} shareId
   * @param {string} restored  what came back in the video's place
   */
  const failed = (video, shareId, restored) => {
    const cause = `MediaError ${video.error?.code ?? 'none'}: ${video.error?.message || 'no message'}`;
    report(new Error(`video: share ${shareId} did not play (${cause}), so its ${restored} came back`));
  };
  /** @param {Element} target */
  const tryEmbed = (target) => {
    if (target?.tagName !== 'IMG' || !target.closest?.('#tdf-chat')) return;
    try {
      const shareId = videoCandidate(target);
      if (shareId === null) return;
      target.setAttribute(TRIED, '');
      const { wrapper, video, original } = embedVideo(doc, /** @type {HTMLImageElement} */ (target), shareId);
      // Not a video either: today's broken image comes back, and is not tried again.
      video.addEventListener(
        'error',
        () => {
          if (!wrapper.isConnected) return;
          wrapper.replaceWith(original);
          failed(video, shareId, 'image');
        },
        { once: true },
      );
    } catch (err) {
      report(err);
    }
  };
  /** @param {Element} row */
  const tryUpload = (row) => {
    if (row.hasAttribute(TRIED) || !row.closest('#tdf-chat')) return;
    try {
      for (const node of row.querySelectorAll('.tdf-body a[href]')) {
        const found = uploadVideo(node);
        if (found === null) continue;
        row.setAttribute(TRIED, '');
        const body = /** @type {Element} */ (node.closest('.tdf-body'));
        const { wrapper, video, original } = embedUpload(doc, body, /** @type {HTMLAnchorElement} */ (node), found.shareId, found.name);
        // Not playable: the notice and its link come back unchanged, and are not tried again.
        video.addEventListener(
          'error',
          () => {
            if (!wrapper.isConnected) return;
            body.replaceChildren(...original);
            failed(video, found.shareId, 'notice');
          },
          { once: true },
        );
        return;
      }
    } catch (err) {
      report(err);
    }
  };
  /** @param {Event} event */
  const onError = (event) => tryEmbed(/** @type {Element} */ (event.target));
  doc.addEventListener('error', onError, true);
  for (const node of doc.querySelectorAll('#tdf-chat img')) {
    const img = /** @type {HTMLImageElement} */ (node);
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src') !== null && !img.classList.contains('tdf-posted')) tryEmbed(img);
  }
  for (const row of doc.querySelectorAll('#tdf-chat .tdf-msg')) tryUpload(row);
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const el = /** @type {Element} */ (node);
            if (el.classList.contains('tdf-msg')) tryUpload(el);
            else for (const row of el.querySelectorAll('.tdf-msg')) tryUpload(row);
          }
        }
      })
    : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  return () => {
    doc.removeEventListener('error', onError, true);
    observer?.disconnect();
  };
}
