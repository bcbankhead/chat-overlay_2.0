// Scroll position tests shared by every slice that keeps a list pinned to its bottom.

/**
 * Whether a scrollable element rests at its bottom, within a pixel of rounding.
 * @param {{ scrollHeight: number, scrollTop: number, clientHeight: number }} el
 * @returns {boolean}
 */
export function atBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}

/**
 * How far a slide to the bottom still has to go, on an ease-out curve: `gap0` at the start,
 * 0 once `duration` has passed. The caller subtracts it from the live bottom each frame, so a
 * bottom that moves mid-slide is still where the slide ends.
 * @param {number} gap0 the distance to the bottom when the slide started
 * @param {number} elapsed milliseconds since the slide started
 * @param {number} duration milliseconds the slide takes
 * @returns {number}
 */
export function slideTop(gap0, elapsed, duration) {
  if (!(duration > 0) || elapsed >= duration) return 0;
  const left = 1 - Math.max(0, elapsed) / duration;
  return gap0 * left * left * left;
}
