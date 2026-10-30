// Image likes in the message view (UI design 2026-10-27, Message view → Image reactions;
// TDF-0011). Right-clicking a posted image likes it at once; clicking it opens the smiley
// picker, and a pick likes it with that smiley. Likes are permanent. A heart with the count of
// distinct senders sits under the image, its title naming each sender's smiley(s), and hearts
// float up from it when a like is made or arrives live. The view has no decoration extension
// point, so this attaches to its DOM (B5): capture-phase listeners and a MutationObserver,
// editing no message-view file. It also hides a like's ^suffix token in the view.

import { safeDecodeURIComponent } from '../../core/parse.js';
import { atBottom } from '../../core/scroll.js';
import { extractShareIds } from '../gallery/shareParse.js';
import { burst as floatHearts } from './hearts.js';

const ROW = 'tdf-rx-row';
const HEART = 'tdf-rx-heart';
/** The smiley a right-click likes with. */
const LIKE_CODE = ':h';
/** A token at the end of a text node: `^` and the share id's last 6 digits. */
const TOKEN_TAIL = /\s*\^\d{6}\s*$/;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT

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
 *   openSmileyPicker: (options: { x: number, y: number, extraRows?: { label: string, run: () => void }[], onPick: (code: string) => void }) => () => void,
 *   burst?: (doc: Document, win: any, anchor: Element) => unknown,
 * }} deps
 * @returns {() => void} uninstall
 */
export function installReactionUi({ doc, win, store, queue, openSmileyPicker, burst = floatHearts }) {
  /** @param {string} shareId */
  const heartsOf = (shareId) =>
    [...doc.querySelectorAll(`#tdf-chat .${HEART}`)].filter((h) => /** @type {HTMLElement} */ (h).dataset.share === shareId);

  /** @param {string} shareId */
  const celebrate = (shareId) => {
    for (const heart of heartsOf(shareId)) burst(doc, win, heart);
  };

  /**
   * Like an image. Hearts float only when a like was actually queued.
   * @param {string} shareId
   * @param {string} code
   */
  const like = (shareId, code) => {
    if (queue.like(shareId, code, store.likesFor(shareId).mine)) celebrate(shareId);
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
   * Share ids of the message's images, in order.
   * @param {Element} msg
   */
  const sharesIn = (msg) => [
    ...new Set([...msg.querySelectorAll('.tdf-body img')].map(shareOf).filter((id) => id !== null)),
  ];

  /**
   * @param {string} shareId
   * @returns {HTMLElement | null}
   */
  const buildRow = (shareId) => {
    const likes = store.likesFor(shareId);
    const entry = queue.entriesFor(shareId)[0];
    // A like still queued counts as yours already.
    const count = likes.count + (entry && !likes.mine ? 1 : 0);
    if (count === 0) return null;
    const row = doc.createElement('div');
    row.className = ROW;
    row.dataset.share = shareId;
    const heart = doc.createElement('button');
    heart.type = 'button';
    heart.className = HEART;
    heart.dataset.share = shareId;
    if (likes.mine || entry) heart.classList.add('tdf-rx-mine');
    if (entry?.state === 'queued' || entry?.state === 'sending') heart.classList.add('tdf-rx-queued');
    if (entry?.state === 'failed') heart.classList.add('tdf-rx-failed');
    const lines = likes.senders.map((s) => `${safeDecodeURIComponent(s.sender)} ${s.codes.join(', ')}`);
    if (entry?.state === 'failed') lines.unshift(`Not sent (${entry.reason}). Click to retry`);
    else if (entry?.state === 'queued') lines.unshift(`Your like: queued (#${entry.position})`);
    else if (entry?.state === 'sending') lines.unshift('Your like: sending');
    heart.title = lines.join('\n');
    const icon = doc.createElement('span');
    icon.className = 'tdf-rx-heart-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '♥';
    const n = doc.createElement('span');
    n.textContent = String(count);
    heart.append(icon, n);
    row.appendChild(heart);
    return row;
  };

  /**
   * What may stand before a token in a like, as parseReaction reads it: exactly one smiley —
   * one expanded smiley (no text), or one code the engine left unexpanded — either taken back
   * with `-`.
   * @param {string} text
   * @param {number} smileys  expanded smileys before the token
   */
  const isLikeHead = (text, smileys) => {
    const codes = Array.isArray(win.mySmilies) ? win.mySmilies : [];
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
    for (const old of msg.querySelectorAll(`:scope > .${ROW}`)) old.remove();
    for (const shareId of sharesIn(msg)) {
      const row = buildRow(shareId);
      if (row) msg.appendChild(row);
    }
  };

  /**
   * Run `fn`, which may add heart rows. A list scrolled to the bottom (the view's autoscroll
   * ran before the rows grew it) stays at the bottom, so the newest message is not pushed down.
   * @param {() => void} fn
   */
  const keepPinned = (fn) => {
    const list = doc.querySelector('#tdf-chat .tdf-list');
    const pinned = list !== null && atBottom(list);
    fn();
    if (pinned && list) list.scrollTop = list.scrollHeight;
  };

  const renderAll = () =>
    keepPinned(() => {
      for (const msg of doc.querySelectorAll('#tdf-chat .tdf-msg')) render(msg);
    });

  /**
   * The share id of the posted image an event hit inside the overlay, or null. No share id,
   * no token to name the image by (B7): the plain link stays.
   * @param {Event} event
   */
  const postedShare = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (!target.closest?.('#tdf-chat')) return null;
    if (target.tagName !== 'IMG' || !target.classList.contains('tdf-posted')) return null;
    return shareOf(target);
  };

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (!target.closest?.('#tdf-chat')) return;
    const heart = /** @type {HTMLElement | null} */ (target.closest(`.${HEART}`));
    if (heart) {
      // Only a failed like is retried from its heart; a like is never taken back.
      const shareId = heart.dataset.share ?? '';
      const entry = queue.entriesFor(shareId)[0];
      if (entry?.state === 'failed') like(shareId, entry.code);
      return;
    }
    const shareId = postedShare(event);
    if (shareId === null) return;
    event.preventDefault();
    const href = target.closest('a')?.href ?? /** @type {HTMLImageElement} */ (target).src;
    openSmileyPicker({
      x: event.clientX,
      y: event.clientY + 8,
      extraRows: [{ label: 'Open full size', run: () => win.open(href, '_blank', 'noopener') }],
      onPick: (code) => like(shareId, code),
    });
  };
  doc.addEventListener('click', onClick, true);

  /** @param {MouseEvent} event */
  const onContextMenu = (event) => {
    const shareId = postedShare(event);
    if (shareId === null) return;
    event.preventDefault();
    like(shareId, LIKE_CODE);
  };
  doc.addEventListener('contextmenu', onContextMenu, true);

  // Rows the view adds (live, replayed, or replaced on confirm) get their heart.
  const observer = new win.MutationObserver((/** @type {MutationRecord[]} */ records) =>
    keepPinned(() => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const el = /** @type {Element} */ (node);
          if (el.nodeType === 1 && el.classList.contains('tdf-msg') && el.closest('#tdf-chat')) render(el);
        }
      }
    }),
  );
  observer.observe(doc.body, { childList: true, subtree: true });

  const offStore = store.onChange(renderAll);
  const offQueue = queue.onChange(renderAll);
  const offLike = store.onLike((imageId) => celebrate(imageId));
  renderAll();

  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('contextmenu', onContextMenu, true);
    observer.disconnect();
    offStore();
    offQueue();
    offLike();
  };
}
