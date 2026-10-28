// The shell's extension points for feature slices (TDF-0009 Shared Contract): the theme
// toggle and the floating scrollbars. Bootstrap mounts the theme here; calls made before
// that are queued and replayed on mount. A second copy of the script never mounts, so its
// queue stays inert.

import { thumbGeometry } from './thumb.js';

// Class names theme.css styles; shell.test.js fails when the two drift.
export const SCROLL_CLASS = 'tdf-scroll';
export const THUMB_CLASS = 'tdf-thumb';
const HIDE_AFTER_MS = 900;
const MIN_THUMB = 24;
const INSET = 3;

/** @type {import('./theme.js').Theme | null} */
let theme = null;
/** @type {(() => void) | null} */
let unsubscribe = null;
/** @type {Set<(theme: import('./theme.js').ResolvedTheme) => void>} */
const listeners = new Set();
/** @type {Array<() => void>} */
let queued = [];
/** @type {Set<(reason: Error) => void>} */
const pendingToggles = new Set();

/**
 * Bootstrap only: hand the loaded theme to the shell and replay what was queued.
 * @param {import('./theme.js').Theme} loaded
 */
export function mount(loaded) {
  if (theme) return;
  theme = loaded;
  unsubscribe = loaded.onChange((t) => {
    for (const fn of listeners) fn(t);
  });
  const current = loaded.current();
  if (current) for (const fn of listeners) fn(current);
  const pending = queued;
  queued = [];
  for (const run of pending) run();
}

/**
 * Bootstrap only: a start that failed after mounting leaves nothing reachable. Toggles
 * still queued are rejected, so their callers learn the overlay did not start.
 */
export function unmount() {
  unsubscribe?.();
  unsubscribe = null;
  theme = null;
  queued = [];
  const pending = [...pendingToggles];
  pendingToggles.clear();
  for (const reject of pending) reject(new Error('overlay did not start'));
}

/**
 * Flip light/dark and persist the choice. Resolves once saved; rejects when the save fails.
 * @returns {Promise<void>}
 */
export function toggleTheme() {
  if (theme) return theme.toggle();
  return new Promise((resolve, reject) => {
    pendingToggles.add(reject);
    // Replayed by mount, once the theme is set.
    queued.push(() => {
      pendingToggles.delete(reject);
      /** @type {import('./theme.js').Theme} */ (theme).toggle().then(resolve, reject);
    });
  });
}

/**
 * Called with the resolved theme on every switch; a listener added before mount is also
 * called once from mount with the initial theme.
 * @param {(theme: import('./theme.js').ResolvedTheme) => void} fn
 * @returns {() => void} off
 */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The applied theme, or null before mount. */
export function currentTheme() {
  return theme?.current() ?? null;
}

/**
 * Give a scroll area a floating scrollbar: native bar hidden, a thin draggable thumb drawn
 * over the content while scrolling or hovering.
 * @param {HTMLElement} el
 * @returns {() => void} detach
 */
export function attachScrollbar(el) {
  if (theme) return floatScrollbar(el);
  /** @type {(() => void) | null} */
  let detach = null;
  let cancelled = false;
  queued.push(() => {
    if (!cancelled) detach = floatScrollbar(el);
  });
  return () => {
    cancelled = true;
    detach?.();
  };
}

/**
 * @param {HTMLElement} el
 * @returns {() => void} detach
 */
function floatScrollbar(el) {
  const doc = el.ownerDocument;
  const thumb = doc.createElement('div');
  thumb.className = THUMB_CLASS;
  el.classList.add(SCROLL_CLASS);
  el.appendChild(thumb);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let hovered = false;
  let dragging = false;
  /** @type {(() => void) | null} */
  let endDrag = null;

  function measure() {
    return thumbGeometry({
      view: el.clientHeight,
      total: el.scrollHeight,
      scrollTop: el.scrollTop,
      inset: INSET,
      min: MIN_THUMB,
    });
  }

  function place() {
    const geometry = measure();
    if (!geometry) {
      thumb.style.display = 'none';
      return false;
    }
    thumb.style.display = '';
    thumb.style.height = `${geometry.height}px`;
    // The thumb lives inside the scrolled content, so it is offset by scrollTop.
    thumb.style.transform = `translateY(${el.scrollTop + geometry.offset}px)`;
    return true;
  }

  function show() {
    if (!place()) return;
    thumb.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!dragging && !hovered) thumb.classList.remove('visible');
    }, HIDE_AFTER_MS);
  }

  const onEnter = () => {
    hovered = true;
    show();
  };
  const onLeave = () => {
    hovered = false;
    show(); // restarts the fade-out timer
  };

  /** @param {MouseEvent} event */
  const onDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Map the thumb's travel onto the scroll range, as thumbGeometry does, so the
    // thumb stays under the pointer even when its height is clamped to the minimum.
    const geometry = measure();
    const travel = el.clientHeight - INSET * 2 - (geometry?.height ?? 0);
    if (!geometry || travel <= 0) return;
    dragging = true;
    thumb.classList.add('dragging');
    const startY = event.clientY;
    const startTop = el.scrollTop;
    const ratio = (el.scrollHeight - el.clientHeight) / travel;
    /** @param {MouseEvent} ev */
    const move = (ev) => {
      el.scrollTop = startTop + (ev.clientY - startY) * ratio;
    };
    const up = () => {
      endDrag?.();
      show();
    };
    endDrag = () => {
      dragging = false;
      endDrag = null;
      thumb.classList.remove('dragging');
      doc.removeEventListener('mousemove', move);
      doc.removeEventListener('mouseup', up);
    };
    doc.addEventListener('mousemove', move);
    doc.addEventListener('mouseup', up);
  };

  el.addEventListener('scroll', show);
  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);
  thumb.addEventListener('mousedown', onDown);

  return () => {
    clearTimeout(timer);
    endDrag?.();
    el.removeEventListener('scroll', show);
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
    thumb.removeEventListener('mousedown', onDown);
    thumb.remove();
    el.classList.remove(SCROLL_CLASS);
  };
}
