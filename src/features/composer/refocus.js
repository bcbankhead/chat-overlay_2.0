// The message box is where focus belongs. It takes focus when the chat loads, when the last open
// menu, picker, flyout or media popover closes, after a plain click outside every other field,
// after a middle click or a right press, when a focused control is removed from the page, when a
// printable key is pressed with nothing editable focused (the key lands in the box), and when the
// window regains focus. Clicks are watched in the capture phase, so a control that stops a click's
// propagation (gallery buttons, a drag release swallowed on its root) still hands focus back
// (TDF-0061). It never takes focus from another text field, from a text selection the user has
// made, or while a menu or the media popover (TDF-0035) is open — the popover's arrow keys reach it
// only while focus is off the box (TDF-0040). A press that closes a menu leaves the decision to
// its click, so a drag that starts outside a menu still selects text; a press that removes the
// focused control is settled when it ends, click or no click. Clicks, removals, load and window focus are mouse-only: on a touch screen each would open
// the keyboard. A keyboard-activated click (Enter or Space on a focused control) or context menu
// leaves focus on that control, and a popover closed from the keyboard or on a touch screen leaves
// focus where the popover returned it (its opener). The menus belong to other slices, so they are
// watched, not wired (TDF-0009 Shared Contract, Extension points).

const POPOVER = '.tdf-lb';
/** The mouse events after which the box takes focus back. */
const PRESSES = /** @type {const} */ (['click', 'auxclick', 'contextmenu']);

/**
 * A menu, picker, flyout or media popover that is open, by the markup its owner gives it. The
 * popover's layer (`.tdf-lb`, gallery/lightbox.js) exists only while it is open.
 */
export const OPEN_MENU =
  `.tdf-rail-menu:not([hidden]), .tdf-sm-picker:not([hidden]), .tdf-rail-flyout.tdf-open, ${POPOVER}`;

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

  const popoverOpen = () => doc.querySelector(POPOVER) !== null;
  let wasOpen = menuOpen();
  let popoverWasOpen = popoverOpen();
  let pressing = false;
  let touch = false;
  /** whether the last input was a key rather than a pointer press */
  let keyed = false;
  /** the element that last took focus, so its removal from the page can be seen */
  /** @type {Element | null} */
  let focused = null;
  /** @param {FocusEvent} event */
  const onFocusIn = (event) => {
    focused = /** @type {Element | null} */ (event.target);
  };
  /** @param {PointerEvent} event */
  const onPointerDown = (event) => {
    pressing = true;
    keyed = false;
    touch = event.pointerType === 'touch';
  };
  /** Whether the control that last took focus has left the page and dropped focus to the body. */
  const dropped = () => {
    const active = doc.activeElement;
    return focused !== null && focused !== bar && !focused.isConnected && (active === null || active === doc.body);
  };
  const onPointerUp = () => {
    pressing = false;
    // A focused control removed during the press: a click that follows takes focus itself, and a
    // press that ends with no click (cancelled, a native drag) must not leave focus on the body.
    if (dropped()) {
      focused = null;
      if (!touch && !coarse()) setTimeout(take, 0);
    }
  };
  const check = () => {
    const isOpen = menuOpen();
    // A close during a press is settled by that press's click. The popover returns focus to its
    // opener itself; a keyboard or touch close keeps it there.
    const popoverKept = popoverWasOpen && (keyed || coarse());
    if (wasOpen && !isOpen && !pressing && !popoverKept) take();
    // A focused control removed from the page (a trashed tile, a re-rendered rail row) drops focus
    // to the body. During a press it waits for the press's end; not on a touch screen.
    if (!pressing && dropped()) {
      focused = null;
      if (!coarse()) take();
    }
    wasOpen = isOpen;
    popoverWasOpen = popoverOpen();
  };
  /**
   * A mouse click, middle click or right press, seen in the capture phase so a target that stops
   * the event's propagation (gallery buttons, a drag release swallowed on its root) cannot hide it.
   * @param {MouseEvent} event
   */
  const onClick = (event) => {
    // A click with no press behind it (detail 0) is a keyboard activation: focus stays on the
    // control. A context menu opened from the keyboard has no press behind it either.
    if (touch || (event.type === 'contextmenu' ? keyed : event.detail === 0)) return;
    const target = /** @type {Element | null} */ (event.target);
    const field = target?.closest?.('input, textarea, select, [contenteditable]') ?? null;
    if (holdsTyping(field, bar)) return;
    // A task, not a microtask: from the capture phase a microtask would run before the target's
    // own handlers, and a click that opens a menu must see it open.
    setTimeout(take, 0);
  };
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    keyed = true;
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
  for (const type of PRESSES) doc.addEventListener(type, onClick, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocusIn, true);
  win?.addEventListener('focus', onWindowFocus);
  if (!coarse()) take();
  return () => {
    observer.disconnect();
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);
    for (const type of PRESSES) doc.removeEventListener(type, onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocusIn, true);
    win?.removeEventListener('focus', onWindowFocus);
  };
}
