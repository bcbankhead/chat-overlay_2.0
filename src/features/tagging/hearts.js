// Floating hearts for a like (TDF-0011): a few hearts rise from the image's heart and fade
// over the interface. Each is `position: fixed` on the page body, so no overflow in the view
// clips it, and is removed when its animation ends, or by a backstop if that never fires.
// Nothing plays when the reader asks for reduced motion.

const HEARTS = 6;
/** Past the longest animation (tagging.css .tdf-hearts-float) plus the longest delay. */
const BACKSTOP_MS = 2000;
const MAX_DELAY_MS = 300;
const MAX_DRIFT_PX = 28;

/**
 * Float hearts up from `anchor`.
 * @param {Document} doc
 * @param {any} win
 * @param {Element} anchor
 * @param {() => number} [random]
 * @returns {HTMLElement[]} the hearts added; none under reduced motion
 */
export function burst(doc, win, anchor, random = Math.random) {
  if (typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return [];
  const rect = anchor.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top;
  /** @type {HTMLElement[]} */
  const hearts = [];
  for (let i = 0; i < HEARTS; i += 1) {
    const heart = doc.createElement('span');
    heart.className = 'tdf-hearts-float';
    heart.setAttribute('aria-hidden', 'true');
    heart.textContent = '♥';
    heart.style.left = `${x}px`;
    heart.style.top = `${y}px`;
    heart.style.setProperty('--tdf-drift', `${Math.round((random() * 2 - 1) * MAX_DRIFT_PX)}px`);
    heart.style.animationDelay = `${Math.round(random() * MAX_DELAY_MS)}ms`;
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      win.clearTimeout(backstop);
      heart.remove();
    };
    const backstop = win.setTimeout(remove, BACKSTOP_MS);
    heart.addEventListener('animationend', remove, { once: true });
    doc.body.appendChild(heart);
    hearts.push(heart);
  }
  return hearts;
}
