// Image reactions in the message view (UI design 2026-10-27, Message view → Image reactions).
// Clicking a posted image opens the smiley picker at the pointer; a choice reacts, and
// choosing the same smiley again takes yours back. Chips with counts sit under the image.
// The view has no decoration extension point, so this attaches to its DOM (B5): a
// capture-phase click and a MutationObserver, editing no message-view file.

import { fixedSmilieSrc } from '../../core/smiliefix.js';
import { safeDecodeURIComponent } from '../../core/parse.js';
import { extractShareIds } from '../gallery/shareParse.js';

const ROW = 'tdf-rx-row';
const CHIP = 'tdf-rx-chip';

/**
 * @param {{
 *   doc: Document,
 *   win: any,
 *   store: { reactionsFor: (imageId: string) => import('./infer.js').ReactionCount[], onChange: (fn: () => void) => () => void },
 *   queue: import('./queue.js').ReactionQueue,
 *   openSmileyPicker: (options: { x: number, y: number, extraRows?: { label: string, run: () => void }[], onPick: (code: string) => void }) => () => void,
 * }} deps
 * @returns {() => void} uninstall
 */
export function installReactionUi({ doc, win, store, queue, openSmileyPicker }) {
  /** @param {string} code */
  const smilieSrc = (code) => {
    const codes = Array.isArray(win.mySmilies) ? win.mySmilies : [];
    const imgs = Array.isArray(win.mySmiliesImg) ? win.mySmiliesImg : [];
    const src = /src=['"]([^'"]+)['"]/.exec(String(imgs[codes.indexOf(code)] ?? ''))?.[1] ?? '';
    return fixedSmilieSrc(src);
  };

  /**
   * @param {string} shareId
   * @param {string} code
   */
  const toggle = (shareId, code) =>
    queue.toggle(shareId, code, store.reactionsFor(shareId).some((r) => r.code === code && r.mine));

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
    const counts = store.reactionsFor(shareId);
    const pending = queue.entriesFor(shareId);
    const codes = [...new Set([...counts.map((c) => c.code), ...pending.map((p) => p.code)])];
    const row = doc.createElement('div');
    row.className = ROW;
    row.dataset.share = shareId;
    for (const code of codes) {
      const counted = counts.find((c) => c.code === code);
      const entry = pending.find((p) => p.code === code);
      const mine = counted?.mine ?? false;
      // A queued reaction counts as yours already; a queued take-back does not yet subtract.
      const count = (counted?.count ?? 0) + (entry && !entry.retract && !mine ? 1 : 0);
      if (count === 0) continue;
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = CHIP;
      chip.dataset.share = shareId;
      chip.dataset.code = code;
      if (mine || (entry && !entry.retract)) chip.classList.add('tdf-rx-mine');
      if (entry?.state === 'queued' || entry?.state === 'sending') chip.classList.add('tdf-rx-queued');
      if (entry?.state === 'failed') chip.classList.add('tdf-rx-failed');
      const names = (counted?.senders ?? []).map((s) => safeDecodeURIComponent(s)).join(', ');
      chip.title =
        entry?.state === 'failed'
          ? `${code}: not sent (${entry.reason}). Click to retry`
          : entry?.state === 'queued'
            ? `${code}: queued (#${entry.position})${names ? ` · ${names}` : ''}`
            : entry?.state === 'sending'
              ? `${code}: sending${names ? ` · ${names}` : ''}`
              : `${code}${names ? `: ${names}` : ''}`;
      const img = doc.createElement('img');
      img.alt = code;
      img.src = smilieSrc(code);
      const n = doc.createElement('span');
      n.textContent = String(count);
      chip.append(img, n);
      row.appendChild(chip);
    }
    return row.childElementCount ? row : null;
  };

  /** @param {Element} msg */
  const render = (msg) => {
    for (const old of msg.querySelectorAll(`:scope > .${ROW}`)) old.remove();
    for (const shareId of sharesIn(msg)) {
      const row = buildRow(shareId);
      if (row) msg.appendChild(row);
    }
  };

  const renderAll = () => {
    for (const msg of doc.querySelectorAll('#tdf-chat .tdf-msg')) render(msg);
  };

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    if (!target.closest?.('#tdf-chat')) return;
    const chip = /** @type {HTMLElement | null} */ (target.closest(`.${CHIP}`));
    if (chip) {
      toggle(chip.dataset.share ?? '', chip.dataset.code ?? '');
      return;
    }
    if (target.tagName !== 'IMG' || !target.classList.contains('tdf-posted')) return;
    const shareId = shareOf(target);
    // No share id, no token to name the image by (B7): the plain link stays.
    if (shareId === null) return;
    event.preventDefault();
    const href = target.closest('a')?.href ?? /** @type {HTMLImageElement} */ (target).src;
    openSmileyPicker({
      x: event.clientX,
      y: event.clientY + 8,
      extraRows: [{ label: 'Open full size', run: () => win.open(href, '_blank', 'noopener') }],
      onPick: (code) => toggle(shareId, code),
    });
  };
  doc.addEventListener('click', onClick, true);

  // Rows the view adds (live, replayed, or replaced on confirm) get their chips.
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
  renderAll();

  return () => {
    doc.removeEventListener('click', onClick, true);
    observer.disconnect();
    offStore();
    offQueue();
  };
}
