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
//
// Magnifier (TDF-0071): a click on the shown image toggles a 500px loupe that follows the cursor
// over it and shows it at natural size (loupe.js), shrunk to the quick view's shorter side when
// that is smaller. Images only, fine pointers only; it starts off on every open and stays as set
// across steps within one open (TDF-0077). On a touch-only device a tap on the image opens it in a
// new tab instead; the bar's new-tab button does the same on any pointer.
//
// Wheel (TDF-0077): the wheel anywhere on the popover steps between items, up to the next and down
// to the previous, one step per gesture: a step, then nothing until WHEEL_QUIET_MS pass with no
// wheel event. Sideways input over the filmstrip scrolls it natively; the page behind never scrolls.

import { loupeFrame } from './loupe.js';
import { dedupe, filmstripWindow, step } from './roster.js';

/** Filmstrip thumbnails rendered at most; the strip scrolls within them. */
export const FILMSTRIP_SLOTS = 41;

const LAYER = 'tdf-lb';

/** Quiet time, in ms, that ends one wheel gesture: the next wheel event after it steps again. */
export const WHEEL_QUIET_MS = 250;

/**
 * The message box's id — composer/index.js's BAR, copied rather than imported so the gallery does
 * not pull in the composer; a drift test holds the two together.
 */
export const MESSAGE_BOX_ID = 'optionsBar';

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
 * @property {() => number} [now]  the clock the wheel's quiet period is timed by, in ms; a test passes its own
 */

/**
 * Open the popover; a popover already open closes first.
 * @param {LightboxDeps} deps
 * @returns {{ close: () => void, layer: HTMLElement }}
 */
export function openLightbox({ doc, win, host, items: given, index: start, zoom, report, opener, kinds = knownKinds, now = () => win.performance.now() }) {
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
  // A loupe needs a cursor to follow: without a fine pointer an image tap opens a new tab instead.
  const fine = win.matchMedia?.('(any-pointer: fine)')?.matches ?? true;
  layer.classList.toggle('tdf-lb-fine', fine);
  const counter = el('span', 'tdf-lb-count');
  const bar = el('div', 'tdf-lb-bar');
  bar.append(counter, tabButton, closeButton);
  const prev = button('tdf-lb-prev', 'Previous', ICONS.prev);
  const next = button('tdf-lb-next', 'Next', ICONS.next);
  const stage = el('div', 'tdf-lb-stage');
  const main = el('div', 'tdf-lb-main');
  main.append(prev, stage, next);
  const strip = el('div', 'tdf-lb-strip');
  const loupe = el('div', 'tdf-lb-loupe');
  loupe.setAttribute('aria-hidden', 'true');
  loupe.hidden = true;
  layer.append(bar, main, strip, loupe);

  /** the magnifier's state, shown only by the layer's tdf-lb-magnifying class; off on open, it carries over steps */
  let magnifying = false;
  /** when the last counted wheel event arrived, by `now()`; a gesture ends WHEEL_QUIET_MS after it */
  let lastWheel = -Infinity;
  /** whether the stage holds an image, the one kind the magnifier applies to */
  let imageOn = false;
  /** @type {{ img: HTMLImageElement, token: number, x: number, y: number } | null} the cursor's last place over the stage's image */
  let cursor = null;

  const hideLoupe = () => {
    loupe.hidden = true;
  };

  /** Draw the loupe at the remembered cursor, when it rests over the image on the stage. */
  const drawLoupe = () => {
    if (!magnifying || !cursor || cursor.token !== shown) return;
    const { img } = cursor;
    const box = layer.getBoundingClientRect();
    const frame = loupeFrame({
      clientX: cursor.x,
      clientY: cursor.y,
      rect: img.getBoundingClientRect(),
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      origin: box,
      bound: box,
    });
    if (!frame) {
      hideLoupe();
      return;
    }
    loupe.style.width = `${frame.size}px`;
    loupe.style.height = `${frame.size}px`;
    loupe.style.left = `${frame.left}px`;
    loupe.style.top = `${frame.top}px`;
    loupe.style.backgroundPosition = `${frame.bgX}px ${frame.bgY}px`;
    loupe.style.backgroundSize = `${frame.bgW}px ${frame.bgH}px`;
    loupe.hidden = false;
  };

  /** @param {boolean} on */
  const setMagnifying = (on) => {
    magnifying = on;
    layer.classList.toggle('tdf-lb-magnifying', on);
    if (on) drawLoupe();
    else hideLoupe();
  };

  const toggleMagnifier = () => {
    if (!fine || !imageOn) return;
    setMagnifying(!magnifying);
  };

  /** Leave the stage to a kind the magnifier does not apply to. */
  const noMagnifier = () => {
    imageOn = false;
    hideLoupe();
  };

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
    noMagnifier();
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
    noMagnifier();
  };

  /**
   * @param {import('./roster.js').MediaItem} item
   * @param {number} token
   */
  const showImage = (item, token) => {
    const img = el('img', 'tdf-lb-media tdf-lb-image');
    img.alt = '';
    img.addEventListener(
      'load',
      () => {
        kinds.set(item.id, 'image');
        // A cursor already resting on the image gets the loupe without having to move.
        drawLoupe();
      },
      { once: true },
    );
    img.addEventListener(
      'error',
      () => {
        // An image known to be one that fails now is unavailable; anything else may be a video.
        if (kindOf(item) === 'image') showUnavailable(item, token);
        else showVideo(item, token);
      },
      { once: true },
    );
    img.addEventListener('mousemove', (event) => {
      if (token !== shown) return;
      cursor = { img, token, x: event.clientX, y: event.clientY };
      drawLoupe();
    });
    img.addEventListener('mouseleave', () => {
      if (cursor?.img === img) cursor = null;
      hideLoupe();
    });
    // Fine pointer: the click toggles the magnifier. Touch only: it opens the image in a new tab,
    // synchronously inside the click so the browser does not block it.
    img.addEventListener('click', () => {
      if (token !== shown) return;
      if (fine) toggleMagnifier();
      else doZoom(item);
    });
    img.src = item.src;
    stage.replaceChildren(img);
    tabButton.hidden = false;
    imageOn = true;
    // The item's own src, so the loupe and the stage show the same image.
    loupe.style.backgroundImage = `url(${JSON.stringify(item.src)})`;
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
    cursor = null;
    hideLoupe();
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
    // Escape in the message box closes the popover: the box has nothing open for Escape to close
    // while the popover is up, and stopping it here keeps the box's own Escape handlers from firing
    // (TDF-0040). The arrows stay with the box, which moves its caret.
    const onBox = target?.tagName === 'TEXTAREA' && target.id === MESSAGE_BOX_ID;
    // Any other text field behind the popover keeps its own caret keys and Escape.
    const inField = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    if (inField && !(onBox && event.key === 'Escape')) return;
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
      return;
    }
  };

  /**
   * The wheel steps between items, one step per gesture. Ctrl/Cmd+wheel and trackpad pinch are
   * left to the browser's zoom. Over the filmstrip, sideways input is left to scroll it natively
   * and vertical input is cancelled without a step; elsewhere sideways input is cancelled without
   * a step. The step's renderStrip() re-centres a strip that drifted.
   * @param {WheelEvent} event
   */
  const onWheel = (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const target = /** @type {Element | null} */ (event.target);
    if (target?.closest?.('.tdf-lb-strip')) {
      if (sideways) return;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (sideways || event.deltaY === 0) return;
    const t = now();
    if (t - lastWheel >= WHEEL_QUIET_MS) go(step(index, event.deltaY < 0 ? 1 : -1, items.length));
    lastWheel = t;
  };

  /** A resize moves the image under a still cursor: drop the loupe until the next move. */
  const onResize = () => {
    place();
    hideLoupe();
  };

  function close() {
    if (closed) return;
    closed = true;
    shown++;
    if (openNow === close) openNow = null;
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('resize', onResize);
    layer.removeEventListener('wheel', onWheel);
    for (const v of stage.querySelectorAll('video')) v.pause?.();
    layer.remove();
    if (returnTo && 'focus' in returnTo && typeof returnTo.focus === 'function') {
      /** @type {HTMLElement} */ (returnTo).focus();
    }
  }

  openNow = close;
  place();
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('resize', onResize);
  layer.addEventListener('wheel', onWheel, { passive: false });
  doc.body.appendChild(layer);
  if (items.length === 0) {
    close();
    return { close, layer };
  }
  go(index);
  closeButton.focus();
  return { close, layer };
}
