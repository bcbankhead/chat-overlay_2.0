// The pre-mount cloak (TDF-0018). A site include placed in <head> runs before the body is
// parsed; until the overlay mounts, the body is hidden and only the page background shows,
// so the original chat never flashes on a slow load. The overlay's theme is not loaded yet,
// so the colour follows the OS scheme. Every start path lifts it, and a failsafe lifts it
// regardless, so a start that hangs never leaves a blank page.

export const CLOAK_ID = 'tdf-cloak';

/** The engine page's background at mount: theme.css's `.body` rule (drift-tested). */
export const CLOAK_LIGHT = '#FBFBFF';
export const CLOAK_DARK = '#DADAE6';

/** How long the cloak may stand before it lifts on its own. */
export const CLOAK_MS = 5000;

/**
 * Hide the body until the returned `lift` is called, or `ms` pass.
 * @param {Document} doc
 * @param {Pick<Window, 'setTimeout' | 'clearTimeout'>} win
 * @param {number} [ms]
 * @param {() => void} [onExpire] called when the failsafe lifts the cloak, not on a lift
 * @returns {() => void} lift: removes the cloak; safe to call more than once
 */
export function cloak(doc, win, ms = CLOAK_MS, onExpire) {
  const style = doc.createElement('style');
  style.id = CLOAK_ID;
  style.textContent =
    `html { background: ${CLOAK_LIGHT} !important; }\n` +
    `@media (prefers-color-scheme: dark) { html { background: ${CLOAK_DARK} !important; } }\n` +
    'body { visibility: hidden !important; }';
  (doc.head ?? doc.documentElement).appendChild(style);
  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    win.clearTimeout(timer);
    style.remove();
  };
  const timer = win.setTimeout(() => {
    lift();
    onExpire?.();
  }, ms);
  return lift;
}
