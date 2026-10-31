// Focus returns to the message box when the last open menu, picker or flyout closes, unless
// another field holds it. Only on such a close, and not one caused by a press outside every open
// menu: a click elsewhere never takes focus back, so message text stays selectable. The menus
// belong to other slices, so they are watched, not wired (TDF-0009 Shared Contract, Extension points).

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
  let wasOpen = doc.querySelector(OPEN_MENU) !== null;
  let pressedOutside = false;
  /** @param {Event} event */
  const onPress = (event) => {
    const target = /** @type {Node | null} */ (event.target);
    pressedOutside = ![...doc.querySelectorAll(OPEN_MENU)].some((menu) => target !== null && menu.contains(target));
  };
  const onKey = () => {
    pressedOutside = false;
  };
  const check = () => {
    const isOpen = doc.querySelector(OPEN_MENU) !== null;
    if (wasOpen && !isOpen && !pressedOutside && !holdsTyping(doc.activeElement, bar)) bar.focus();
    if (wasOpen !== isOpen) pressedOutside = false;
    wasOpen = isOpen;
  };
  const observer = new MutationObserver(check);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
