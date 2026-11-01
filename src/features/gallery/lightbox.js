// The media popover (TDF-0035): the clicked item over the chat, with previous/next arrows and a
// bottom filmstrip of its neighbours, the current one outlined white. Opened by a share image in
// the chat (tagging/ui.js) and by a gallery tile (view.js), each with its own roster.
//
// Placement: a fixed layer on <body>, kept to #tdf-chat's rect, rather than a child of
// #tdf-chat. #tdf-chat (z-index 5) is its own stacking context and the rail's Gallery flyout
// (#tdf-rail, z-index 10) is drawn over it, so a child would sit under an open flyout. The layer
// is above the rail and fills the chat's height within the chat's bounds.
//
// Kind: an item is tried as an <img>, and as a <video> once the image fails; what loads is
// remembered per share id, so a return visit and the filmstrip know it. Zoom is the entry
// point's own new-tab open, called inside the click so the browser does not block it.

import { dedupe, filmstripWindow, step } from './roster.js';

/** Filmstrip thumbnails rendered at most; the strip scrolls within them. */
export const FILMSTRIP_SLOTS = 41;

const LAYER = 'tdf-lb';

/** @type {Map<string, import('./roster.js').MediaKind>} what each share id loaded as */
const knownKinds = new Map();

/** @type {(() => void) | null} the open popover's close */
let openNow = null;

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  media:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/></svg>',
};

/**
 * @typedef {object} LightboxDeps
 * @property {Document} doc
 * @property {Window & typeof globalThis} win
 * @property {Element | null} host  #tdf-chat, whose rect the popover fills; null fills the window
 * @property {readonly import('./roster.js').MediaItem[]} items
 * @property {number} index  the clicked item
 * @property {(item: import('./roster.js').MediaItem) => void} zoom  opens the item in a new tab, synchronously
 * @property {(err: unknown) => void} report
 * @property {Element | null} [opener]  where focus returns on close; the focused element by default
 * @property {Map<string, import('./roster.js').MediaKind>} [kinds]  the kind cache; a test passes its own
 */

/**
 * Open the popover; a popover already open closes first.
 * @param {LightboxDeps} deps
 * @returns {{ close: () => void, layer: HTMLElement }}
 */
export function openLightbox({ doc, win, host, items: given, index: start, zoom, report, opener, kinds = knownKinds }) {
  openNow?.();
  const items = dedupe(given);
  const returnTo = opener ?? doc.activeElement;
  // The clicked item's place once duplicates are gone: a later copy of a share is its first.
  const clickedId = given[Math.max(0, Math.min(given.length - 1, start))]?.id;
  let index = Math.max(0, items.findIndex((m) => m.id === clickedId));
  /** token of the item on the stage, so a late load or error of an earlier one is ignored */
  let shown = 0;
  let closed = false;

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} className
   */
  const el = (tag, className) => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };
  /**
   * @param {string} className
   * @param {string} label
   * @param {string} icon
   */
  const button = (className, label, icon) => {
    const b = el('button', className);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    return b;
  };

  const layer = el('div', LAYER);
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'Media viewer');
  const closeButton = button('tdf-lb-close', 'Close', ICONS.close);
  const tabButton = button('tdf-lb-tab', 'Open in new tab', ICONS.tab);
  tabButton.hidden = true;
  const counter = el('span', 'tdf-lb-count');
  const bar = el('div', 'tdf-lb-bar');
  bar.append(counter, tabButton, closeButton);
  const prev = button('tdf-lb-prev', 'Previous', ICONS.prev);
  const next = button('tdf-lb-next', 'Next', ICONS.next);
  const stage = el('div', 'tdf-lb-stage');
  const main = el('div', 'tdf-lb-main');
  main.append(prev, stage, next);
  const strip = el('div', 'tdf-lb-strip');
  layer.append(bar, main, strip);

  /** Keep the layer on the chat's rect. */
  const place = () => {
    const rect = host?.getBoundingClientRect();
    const box = rect && rect.width > 0 && rect.height > 0 ? rect : null;
    layer.style.top = `${box ? box.top : 0}px`;
    layer.style.left = `${box ? box.left : 0}px`;
    layer.style.width = box ? `${box.width}px` : '100%';
    layer.style.height = box ? `${box.height}px` : '100%';
  };

  /** @param {import('./roster.js').MediaItem} item */
  const kindOf = (item) => kinds.get(item.id) ?? item.kind;

  /** @param {import('./roster.js').MediaItem} item */
  const doZoom = (item) => {
    try {
      zoom(item);
    } catch (err) {
      report(err);
    }
  };

  /**
   * @param {import('./roster.js').MediaItem} item
   * @param {number} token
   */
  const showUnavailable = (item, token) => {
    if (token !== shown) return;
    const note = el('div', 'tdf-lb-unavailable');
    note.textContent = 'This media could not be loaded. Click to open it in a new tab.';
    note.addEventListener('click', () => doZoom(item));
    stage.replaceChildren(note);
    tabButton.hidden = false;
  };

  /**
   * @param {import('./roster.js').MediaItem} item
   * @param {number} token
   */
  const showVideo = (item, token) => {
    if (token !== shown) return;
    const video = el('video', 'tdf-lb-media tdf-lb-video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener(
      'loadedmetadata',
      () => {
        kinds.set(item.id, 'video');
        if (token === shown) renderStrip();
      },
      { once: true },
    );
    video.addEventListener('error', () => showUnavailable(item, token), { once: true });
    video.src = item.src;
    stage.replaceChildren(video);
    tabButton.hidden = false;
  };

  /**
   * @param {import('./roster.js').MediaItem} item
   * @param {number} token
   */
  const showImage = (item, token) => {
    const img = el('img', 'tdf-lb-media tdf-lb-image');
    img.alt = '';
    img.title = 'Open in new tab';
    img.addEventListener('load', () => kinds.set(item.id, 'image'), { once: true });
    img.addEventListener(
      'error',
      () => {
        // An image known to be one that fails now is unavailable; anything else may be a video.
        if (kindOf(item) === 'image') showUnavailable(item, token);
        else showVideo(item, token);
      },
      { once: true },
    );
    img.addEventListener('click', () => doZoom(item));
    img.src = item.src;
    stage.replaceChildren(img);
    tabButton.hidden = true;
  };

  /** @param {HTMLElement} cell @param {string} icon */
  const glyph = (cell, icon) => {
    const g = el('span', 'tdf-lb-glyph');
    g.innerHTML = icon;
    cell.replaceChildren(g);
  };

  const renderStrip = () => {
    const { start: from, end } = filmstripWindow(index, items.length, FILMSTRIP_SLOTS);
    /** @type {HTMLElement | null} */
    let current = null;
    const cells = [];
    for (let i = from; i < end; i++) {
      const item = items[i];
      const cell = el('button', 'tdf-lb-thumb');
      cell.type = 'button';
      cell.dataset.index = String(i);
      cell.setAttribute('aria-label', `Show item ${i + 1} of ${items.length}`);
      const isVideo = kindOf(item) === 'video';
      if (isVideo) cell.classList.add('tdf-lb-thumb-video');
      if (item.thumb && !isVideo) {
        const img = el('img', '');
        img.alt = '';
        img.decoding = 'async';
        img.addEventListener('error', () => glyph(cell, kindOf(item) === 'video' ? ICONS.play : ICONS.media), {
          once: true,
        });
        img.src = item.thumb;
        cell.appendChild(img);
      } else glyph(cell, isVideo ? ICONS.play : ICONS.media);
      if (i === index) {
        cell.classList.add('tdf-current');
        cell.setAttribute('aria-current', 'true');
        current = cell;
      }
      cells.push(cell);
    }
    strip.replaceChildren(...cells);
    strip.hidden = items.length < 2;
    /** @type {any} */ (current)?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  };

  /** @param {number} to */
  const go = (to) => {
    if (closed || to < 0 || to >= items.length) return;
    index = to;
    const token = ++shown;
    const item = items[index];
    for (const v of stage.querySelectorAll('video')) v.pause?.();
    if (kindOf(item) === 'video') showVideo(item, token);
    else showImage(item, token);
    counter.textContent = `${index + 1} / ${items.length}`;
    prev.disabled = index === 0;
    next.disabled = index === items.length - 1;
    renderStrip();
  };

  prev.addEventListener('click', () => go(step(index, -1, items.length)));
  next.addEventListener('click', () => go(step(index, 1, items.length)));
  tabButton.addEventListener('click', () => doZoom(items[index]));
  closeButton.addEventListener('click', () => close());
  strip.addEventListener('click', (event) => {
    const cell = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest?.('.tdf-lb-thumb'));
    if (cell) go(Number(cell.dataset.index));
  });
  // The backdrop: the layer itself, or the stage around the media.
  layer.addEventListener('click', (event) => {
    if (event.target === layer || event.target === main || event.target === stage) close();
  });

  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    // A text field behind the popover keeps its own caret keys and Escape.
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // A video's own controls take the arrows while it has focus.
    if (target?.tagName === 'VIDEO') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      go(step(index, event.key === 'ArrowLeft' ? -1 : 1, items.length));
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    shown++;
    if (openNow === close) openNow = null;
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('resize', place);
    for (const v of stage.querySelectorAll('video')) v.pause?.();
    layer.remove();
    if (returnTo && 'focus' in returnTo && typeof returnTo.focus === 'function') {
      /** @type {HTMLElement} */ (returnTo).focus();
    }
  }

  openNow = close;
  place();
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('resize', place);
  doc.body.appendChild(layer);
  if (items.length === 0) {
    close();
    return { close, layer };
  }
  go(index);
  closeButton.focus();
  return { close, layer };
}
