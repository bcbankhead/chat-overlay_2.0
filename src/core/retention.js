// The Chat history window's cutoff rule, shared by the core's replay and view trim and by the
// Options feature's prune (which re-exports it from selectors.js). Pure: no I/O.

export const DAY_MS = 86_400_000;

/**
 * Messages received before the returned time are deleted. 0 keeps none (every line), a stored
 * legacy null keeps everything.
 * @param {number | null} days
 * @param {number} now
 * @returns {number | null} null when nothing expires
 */
export function historyCutoff(days, now) {
  if (days === null) return null;
  if (days === 0) return Infinity;
  return now - days * DAY_MS;
}
