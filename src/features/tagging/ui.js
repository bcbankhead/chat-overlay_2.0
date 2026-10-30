// Image likes in the message view (UI design 2026-10-27, Message view → Image reactions;
// TDF-0011, TDF-0014). A posted image sits in a frame whose hover heart, in its corner, likes
// it; clicking the image opens it full size in a new tab. Likes are permanent. Up to
// three hearts stack in the image's lower-left corner, one per liker, with no count and no
// names; hearts float up from the image's bottom edge when a like is made or arrives live.
// The view has no decoration extension point, so this attaches to its DOM (B5): a capture-
// phase listener and a MutationObserver, editing no message-view file. It also hides a like's
// ^suffix token in the view. A like it queues is announced on core's liked channel, which
// the gallery saves the image from (TDF-0015).

import { emitLiked } from '../../core/events.js';
import { extractShareIds } from '../gallery/shareParse.js';
import { burst as floatHearts } from './hearts.js';

const FRAME = 'tdf-rx-frame';
const LIKE = 'tdf-rx-like';
const STACK = 'tdf-rx-stack';
/** Hearts the stack shows at most. */
const STACK_MAX = 3;
/** The smiley the corner heart likes with. */
const LIKE_CODE = ':h';
/** A token at the end of a text node: `^` and the share id's last 6 digits. */
const TOKEN_TAIL = /\s*\^\d{6}\s*$/;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const SVG = 'http://www.w3.org/2000/svg';
const HEART_PATH =
  'M12 20.5s-7.6-4.6-9.4-9.4C1.3 7.6 3.4 4.5 6.7 4.5c2.2 0 3.7 1.2 5.3 3.1 1.6-1.9 3.1-3.1 5.3-3.1 3.3 0 5.4 3.1 4.1 6.6-1.8 4.8-9.4 9.4-9.4 9.4z';

/**
 * @param {{
 *   doc: Document,
 *   win: any,
 *   store: {
 *     likesFor: (imageId: string) => import('./infer.js').LikeCount,
 *     onChange: (fn: () => void) => () => void,
 *     onLike: (fn: (imageId: string, sender: string) => void) => () => void,
 *   },
 *   queue: import('./queue.js').ReactionQueue,
 *   codes: readonly string[],
 *   burst?: (doc: Document, win: any, anchor: Element) => unknown,
 * }} deps
 * @returns {() => void} uninstall
 */
export function installReactionUi({ doc, win, store, queue, codes, burst = floatHearts }) {
  // The form the view's rows carry in data-user: start.js compares inbound users to it alike.
  const me = String(win.userName ?? '');

  /** @param {string} shareId */
  const framesOf = (shareId) =>
    [...doc.querySelectorAll(`#tdf-chat .${FRAME}`)].filter((f) => /** @type {HTMLElement} */ (f).dataset.share === shareId);

  /**
   * Float hearts from each of the image's frames, anchored on the image itself.
   * @param {string} shareId
   */
  const celebrate = (shareId) => {
    for (const frame of framesOf(shareId)) {
      const img = frame.querySelector('img');
      if (img) burst(doc, win, img);
    }
  };

  /**
   * Like an image. Hearts float, and the like is announced, only when a like was actually
   * queued. A row with no server id (none, or a pending `local-…` one) announces nothing.
   * @param {string} shareId
   * @param {string} code
   * @param {Element} likeButton
   */
  const like = (shareId, code, likeButton) => {
    if (!queue.like(shareId, code, store.likesFor(shareId).mine)) return;
    celebrate(shareId);
    const msg = /** @type {HTMLElement | null} */ (likeButton.closest('.tdf-msg'));
    const messageId = msg?.dataset.id ?? '';
    if (messageId === '' || messageId.startsWith('local-')) return;
    emitLiked({ shareId, messageId, user: msg?.dataset.user ?? '', mTime: msg?.dataset.mtime ?? '' });
  };

  /**
   * The share id an image in a public message links to, or null. Whispers are out: another
   * install could not resolve a reaction to one (A1).
   * @param {Element} img
   */
  const shareOf = (img) => {
    if (!img.closest('.tdf-msg.tdf-kind-public .tdf-body')) return null;
    const link = img.closest('a');
    return extractShareIds(`${link?.getAttribute('href') ?? ''} ${img.getAttribute('src') ?? ''}`)[0] ?? null;
  };

  /**
   * An inline SVG icon of one path.
   * @param {string} d
   */
  const icon = (d) => {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  };

  /**
   * The frame around a posted image (its link, else the image), made once and reused.
   * @param {Element} img
   * @param {string} shareId
   * @returns {HTMLElement}
   */
  const frameOf = (img, shareId) => {
    const target = img.closest('a') ?? img;
    const parent = target.parentElement;
    if (parent?.classList.contains(FRAME)) return parent;
    const frame = doc.createElement('span');
    frame.className = FRAME;
    frame.dataset.share = shareId;
    target.before(frame);
    const stack = doc.createElement('span');
    stack.className = STACK;
    stack.setAttribute('aria-hidden', 'true');
    frame.append(target, stack);
    return frame;
  };

  /**
   * Bring a frame's like button and stack up to date.
   * @param {HTMLElement} frame
   * @param {string} shareId
   * @param {boolean} own  the image is yours, which you cannot like
   */
  const decorate = (frame, shareId, own) => {
    const likes = store.likesFor(shareId);
    const entry = queue.entriesFor(shareId)[0];
    let likeButton = /** @type {HTMLButtonElement | null} */ (frame.querySelector(`:scope > .${LIKE}`));
    if (own) likeButton?.remove();
    else {
      if (!likeButton) {
        // Beside the link, never in it, so clicking the heart follows no link.
        likeButton = doc.createElement('button');
        likeButton.type = 'button';
        likeButton.className = LIKE;
        likeButton.dataset.share = shareId;
        likeButton.appendChild(icon(HEART_PATH));
        frame.querySelector(`:scope > .${STACK}`)?.before(likeButton);
      }
      const mine = likes.mine || entry !== undefined;
      likeButton.classList.toggle('tdf-rx-mine', mine);
      likeButton.classList.toggle('tdf-rx-queued', entry?.state === 'queued' || entry?.state === 'sending');
      likeButton.classList.toggle('tdf-rx-failed', entry?.state === 'failed');
      likeButton.setAttribute('aria-pressed', String(mine));
      likeButton.title =
        entry?.state === 'failed'
          ? `Not sent (${entry.reason}). Click to retry`
          : entry?.state === 'queued'
            ? `Your like: queued (#${entry.position})`
            : entry?.state === 'sending'
              ? 'Your like: sending'
              : likes.mine
                ? 'Liked'
                : 'Like';
      likeButton.setAttribute('aria-label', likeButton.title);
    }
    // A like still queued counts as yours already.
    const likers = likes.count + (entry && !likes.mine ? 1 : 0);
    const shown = Math.min(STACK_MAX, likers);
    const stack = /** @type {HTMLElement} */ (frame.querySelector(`:scope > .${STACK}`));
    while (stack.children.length > shown) stack.lastElementChild?.remove();
    while (stack.children.length < shown) stack.appendChild(icon(HEART_PATH));
  };

  /**
   * What may stand before a token in a like, as parseReaction reads it: exactly one smiley —
   * one expanded smiley (no text), or one code the engine left unexpanded — either taken back
   * with `-`.
   * @param {string} text
   * @param {number} smileys  expanded smileys before the token
   */
  const isLikeHead = (text, smileys) => {
    const code = text.startsWith('-') ? text.slice(1) : text;
    return code === '' ? smileys === 1 : smileys === 0 && codes.includes(code);
  };

  /**
   * Hide a like's ^suffix token. In a public message that is only a smiley and its token —
   * plain, in a span the sanitiser kept, or in a font tag it turned to text — the token is
   * removed, and any wrapper it leaves empty.
   * @param {Element} msg
   */
  const stripToken = (msg) => {
    if (!msg.classList.contains('tdf-kind-public')) return;
    const body = msg.querySelector('.tdf-body');
    if (!body || body.querySelector('a') || [...body.querySelectorAll('img')].some((img) => shareOf(img) !== null)) return;
    const walker = doc.createTreeWalker(body, SHOW_TEXT);
    /** @type {Text[]} */
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(/** @type {Text} */ (node));
    const last = texts.reverse().find((t) => t.data.trim() !== '');
    if (!last || !TOKEN_TAIL.test(last.data)) return;
    const lead = last.data.replace(TOKEN_TAIL, '');
    const before = texts.slice(texts.indexOf(last) + 1).reverse().map((t) => t.data).join('');
    const imgs = [...body.querySelectorAll('img')];
    if (imgs.some((img) => !(img.compareDocumentPosition(last) & 4 /* DOCUMENT_POSITION_FOLLOWING */))) return;
    if (!isLikeHead(`${before}${lead}`.trim(), imgs.length)) return;
    last.data = lead;
    let el = last.parentElement;
    while (el && el !== body && (el.textContent ?? '').trim() === '' && !el.querySelector('img')) {
      const parent = el.parentElement;
      el.remove();
      el = parent;
    }
  };

  /** @param {Element} msg */
  const render = (msg) => {
    stripToken(msg);
    const own = me !== '' && /** @type {HTMLElement} */ (msg).dataset.user === me;
    for (const img of msg.querySelectorAll('.tdf-body img')) {
      const shareId = shareOf(img);
      if (shareId !== null) decorate(frameOf(img, shareId), shareId, own);
    }
  };

  const renderAll = () => {
    for (const msg of doc.querySelectorAll('#tdf-chat .tdf-msg')) render(msg);
  };

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (!target.closest?.('#tdf-chat')) return;
    const likeButton = /** @type {HTMLElement | null} */ (target.closest(`.${FRAME} > .${LIKE}`));
    if (likeButton) {
      event.preventDefault();
      // A like is never taken back: one made or queued sends nothing; a failed one retries.
      const shareId = likeButton.dataset.share ?? '';
      const entry = queue.entriesFor(shareId)[0];
      if (entry?.state === 'failed') like(shareId, entry.code, likeButton);
      else if (!entry && !store.likesFor(shareId).mine) like(shareId, LIKE_CODE, likeButton);
      return;
    }
    // Clicking the image opens it full size in a new tab. No share id, no frame (B7): the plain
    // link stays.
    if (target.tagName !== 'IMG' || !target.closest(`.${FRAME}`) || shareOf(target) === null) return;
    event.preventDefault();
    const img = /** @type {HTMLImageElement} */ (target);
    win.open(img.closest('a')?.href ?? img.src, '_blank', 'noopener');
  };
  doc.addEventListener('click', onClick, true);

  // Rows the view adds (live, replayed, or replaced on confirm) get their frame.
  const observer = new win.MutationObserver((/** @type {MutationRecord[]} */ records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const el = /** @type {Element} */ (node);
        if (el.nodeType === 1 && el.classList.contains('tdf-msg') && el.closest('#tdf-chat')) render(el);
      }
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  const offStore = store.onChange(renderAll);
  const offQueue = queue.onChange(renderAll);
  const offLike = store.onLike((imageId) => celebrate(imageId));
  renderAll();

  return () => {
    doc.removeEventListener('click', onClick, true);
    observer.disconnect();
    offStore();
    offQueue();
    offLike();
  };
}
