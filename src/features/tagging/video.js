// Uploaded videos in the chat (TDF-0065). A video share arrives as the same `[[img …]]` markup as
// an image (TDF-0034), so the view renders an <img> that never loads. When a share image in a
// public message or a whisper fails, it is replaced in place with a paused <video> on the same
// URL, playable with its own controls, and a small button that opens it in the media quick view
// (ui.js handles the button's click). The share's link is replaced with it, not kept around it:
// a control click inside an <a target="_blank"> would follow the link. If the video fails too,
// the original image comes back, broken, as before, and is not tried again.
// Tagging-side because core imports nothing from features; the view's per-row ResizeObserver
// re-pins a pinned chat when the row grows, so no scrolling code is needed here.

import { extractShareIds } from '../gallery/shareParse.js';

/** The wrapper an embedded video sits in; it carries the share id and its link's href. */
export const VIDEO = 'tdf-video';
/** The overlay button that opens the video in the quick view. */
export const VIDEO_OPEN = 'tdf-video-open';
/** Set on a share image once a video was tried for it, so it is tried at most once. */
const TRIED = 'data-tdf-tried';
const SVG = 'http://www.w3.org/2000/svg';
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
  const wrapper = doc.createElement('span');
  wrapper.className = VIDEO;
  wrapper.dataset.share = shareId;
  wrapper.dataset.href = href;
  const video = doc.createElement('video');
  video.controls = true;
  video.preload = 'metadata';
  video.setAttribute('playsinline', '');
  video.src = img.getAttribute('src') ?? '';
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
  original.replaceWith(wrapper);
  return { wrapper, video, original };
}

/**
 * Swap each failing share image in the chat for an embedded video: those that fail from now on,
 * and those that already failed before the install, whose one `error` event has passed. The
 * `error` event does not bubble, so it is caught in the capture phase.
 * @param {{ doc: Document, report?: (err: unknown) => void }} deps  only images in #tdf-chat act
 * @returns {() => void} uninstall
 */
export function installChatVideo({ doc, report = (err) => console.error(err) }) {
  /** @param {Element} target */
  const tryEmbed = (target) => {
    if (target?.tagName !== 'IMG' || !target.closest?.('#tdf-chat')) return;
    try {
      const shareId = videoCandidate(target);
      if (shareId === null) return;
      target.setAttribute(TRIED, '');
      const { wrapper, video, original } = embedVideo(doc, /** @type {HTMLImageElement} */ (target), shareId);
      // Not a video either: today's broken image comes back, and is not tried again.
      video.addEventListener('error', () => wrapper.isConnected && wrapper.replaceWith(original), { once: true });
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
  return () => doc.removeEventListener('error', onError, true);
}
