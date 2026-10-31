// The message box is where focus belongs. It takes focus when the chat loads, when the last open
// menu, picker or flyout closes, after a plain click outside every other field, when a printable
// key is pressed with nothing editable focused (the key lands in the box), and when the window
// regains focus. It never takes focus from another text field, from a text selection the user
// has made, or while a menu is open. A press that closes a menu leaves the decision to its click,
// so a drag that starts outside a menu still selects text. Clicks, load and window focus are
// mouse-only: on a touch screen each would open the keyboard. A keyboard-activated click (Enter or
// Space on a focused control) leaves focus on that control. The menus belong to other slices,
// so they are watched, not wired (TDF-0009 Shared Contract, Extension points).

/** A menu, picker or flyout that is open, by the markup its owner gives it. */
export const OPEN_MENU = '.tdf-rail-menu:not([hidden]), .tdf-sm-picker:not([hidden]), .tdf-rail-flyout.tdf-open';

/**
 * Whether `el` takes typing of its own, so focus must stay with it.
 * @param {Element | null} el
 * @param {HTMLTextAreaElement} bar
 */
function holdsTyping(el, bar) {
  if (!el || el === bar) return false;
  if (/** @type {HTMLElement} */ (el).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = /** @type {HTMLInputElement} */ (el).type;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'range', 'color'].includes(type);
}

/**
 * @param {HTMLTextAreaElement} bar
 * @param {Document} [doc]
 * @returns {() => void} stop watching
 */
export function installRefocus(bar, doc = bar.ownerDocument) {
  const win = doc.defaultView;
  const coarse = () => Boolean(win?.matchMedia?.('(pointer: coarse)').matches);
  const menuOpen = () => doc.querySelector(OPEN_MENU) !== null;
  const selecting = () => {
    const selection = doc.getSelection();
    return selection !== null && !selection.isCollapsed && selection.toString() !== '';
  };
  /** Focus the box unless something else has a better claim to it. */
  const take = () => {
    if (doc.activeElement === bar || menuOpen() || selecting() || holdsTyping(doc.activeElement, bar)) return;
    bar.focus({ preventScroll: true });
  };

  let wasOpen = menuOpen();
  let pressing = false;
  let touch = false;
  /** @param {PointerEvent} event */
  const onPointerDown = (event) => {
    pressing = true;
    touch = event.pointerType === 'touch';
  };
  const onPointerUp = () => {
    pressing = false;
  };
  const check = () => {
    const isOpen = menuOpen();
    // A close during a press is settled by that press's click.
    if (wasOpen && !isOpen && !pressing) take();
    wasOpen = isOpen;
  };
  /** @param {MouseEvent} event */
  const onClick = (event) => {
    // A click with no press behind it (detail 0) is a keyboard activation: focus stays on the control.
    if (event.detail === 0 || touch) return;
    const target = /** @type {Element | null} */ (event.target);
    const field = target?.closest?.('input, textarea, select, [contenteditable]') ?? null;
    if (holdsTyping(field, bar)) return;
    // After the target's own handlers, so a click that opens a menu sees it open.
    queueMicrotask(take);
  };
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = doc.activeElement;
    // Space presses a focused control; it is typing only with nothing focused.
    if (event.key === ' ' && active && active !== doc.body && active !== bar) return;
    if (active === bar || menuOpen() || holdsTyping(active, bar)) return;
    bar.focus({ preventScroll: true });
  };
  const onWindowFocus = () => {
    if (!coarse()) take();
  };

  const observer = new MutationObserver(check);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('pointercancel', onPointerUp, true);
  doc.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey, true);
  win?.addEventListener('focus', onWindowFocus);
  if (!coarse()) take();
  return () => {
    observer.disconnect();
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);
    doc.removeEventListener('click', onClick);
    doc.removeEventListener('keydown', onKey, true);
    win?.removeEventListener('focus', onWindowFocus);
  };
}
