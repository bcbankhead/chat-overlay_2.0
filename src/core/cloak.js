// The pre-mount cloak (TDF-0018, TDF-0026). A site include placed in <head> runs before the
// body is parsed; until the page is laid out and every feature is ready, the body is
// transparent and takes no clicks or keyboard focus, and only the page background shows, so
// neither the original chat nor a half-styled overlay ever flashes on a slow load, and nothing
// can be typed into a page no one can see. The overlay's theme is
// not loaded yet, so the colour follows the OS scheme. Lifting fades the body in. Every start
// path lifts it, and a failsafe lifts it regardless, so a start that hangs never leaves a
// blank page.

export const CLOAK_ID = 'tdf-cloak';

/** The engine page's background at mount: theme.css's `.body` rule (drift-tested). */
export const CLOAK_LIGHT = '#FBFBFF';
export const CLOAK_DARK = '#DADAE6';

/** How long the cloak may stand before it lifts on its own. */
export const CLOAK_MS = 8000;

/** How long the body takes to fade in once the cloak lifts. */
export const CLOAK_FADE_MS = 200;

/**
 * Hide the body until the returned `lift` is called, or `ms` pass; then fade it in.
 * @param {Document} doc
 * @param {Pick<Window, 'setTimeout' | 'clearTimeout'>} win
 * @param {number} [ms]
 * @param {() => void} [onExpire] called when the failsafe lifts the cloak, not on a lift
 * @returns {() => void} lift: fades the body in, then removes the cloak; safe to call more
 *   than once
 */
export function cloak(doc, win, ms = CLOAK_MS, onExpire) {
  const background =
    `html { background: ${CLOAK_LIGHT} !important; }\n` +
    `@media (prefers-color-scheme: dark) { html { background: ${CLOAK_DARK} !important; } }\n`;
  const style = doc.createElement('style');
  style.id = CLOAK_ID;
  style.textContent = `${background}body { opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; }`;
  (doc.head ?? doc.documentElement).appendChild(style);
  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    win.clearTimeout(timer);
    // The new rule's transition applies to the change it makes, so the body fades up from 0.
    style.textContent = `${background}body { transition: opacity ${CLOAK_FADE_MS}ms ease-out; }`;
    win.setTimeout(() => style.remove(), CLOAK_FADE_MS);
  };
  const timer = win.setTimeout(() => {
    lift();
    onExpire?.();
  }, ms);
  return lift;
}
