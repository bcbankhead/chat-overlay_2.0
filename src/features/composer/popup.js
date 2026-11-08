// What the composer's pickers share (the smiley picker, smilies.js; the sound board, sfx.js): each
// is one panel appended to <body>, closed by Escape or a press outside it and its own button, and
// opened with its bottom-left corner at a viewport point, kept on screen.

/**
 * Close `el` on Escape, or on a capture-phase mousedown outside it that is not on its button.
 * @param {HTMLElement} el
 * @param {string} buttonSelector
 * @param {() => void} close
 */
export function closeOnOutside(el, buttonSelector, close) {
  const doc = el.ownerDocument;
  doc.addEventListener(
    'mousedown',
    (event) => {
      const target = /** @type {Element} */ (event.target);
      if (!el.hidden && !el.contains(target) && !target.closest?.(buttonSelector)) close();
    },
    true,
  );
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
}

/**
 * Show `el` with its bottom-left corner at viewport point (x, y), kept 8px inside the viewport.
 * @param {HTMLElement} el
 * @param {number} x
 * @param {number} y
 */
export function showAbove(el, x, y) {
  const win = /** @type {Window} */ (el.ownerDocument.defaultView);
  el.hidden = false;
  const rect = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, x), win.innerWidth - rect.width - 8);
  const top = Math.min(Math.max(8, y - rect.height), win.innerHeight - rect.height - 8);
  el.style.left = `${left + win.scrollX}px`;
  el.style.top = `${top + win.scrollY}px`;
}
