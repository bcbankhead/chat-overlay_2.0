// Scroll position tests shared by every slice that keeps a list pinned to its bottom.

/**
 * Whether a scrollable element rests at its bottom, within a pixel of rounding.
 * @param {{ scrollHeight: number, scrollTop: number, clientHeight: number }} el
 * @returns {boolean}
 */
export function atBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}
