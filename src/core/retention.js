// The Chat history rules (TDF-0033.5), shared by the core's replay and by the Options feature's
// prune (which re-exports them from selectors.js). Pure: no I/O.
//
// The member's setting is Chat history (last 100): on replays the newest 100 lines, off keeps
// and replays none. Storage is bounded apart from it, by a fixed internal age.

export const DAY_MS = 86_400_000;

/**
 * The Chat history setting: 100 replays the newest 100 lines, 0 keeps and replays none.
 * @typedef {0 | 100} HistoryCount
 */

/** Chat history on: the most lines replay shows and the view keeps. */
export const HISTORY_ON = /** @type {const} */ (100);

/** Stored lines older than this are deleted, whatever the setting; there is no control for it. */
export const STORAGE_AGE_DAYS = 30;

/**
 * A stored Chat history value, read: anything other than 0 or 100 reads as on (100), so an
 * out-of-range value is never handed on.
 * @param {unknown} value
 * @returns {HistoryCount}
 */
export function parseHistoryCount(value) {
  return value === 0 ? 0 : HISTORY_ON;
}

/**
 * The Chat history count a retired `retentionDays` value migrates to: 0 days keeps none and
 * becomes 0; any other value, a legacy null (keep everything) included, becomes on.
 * @param {unknown} days
 * @returns {HistoryCount}
 */
export function countFromDays(days) {
  return days === 0 ? 0 : HISTORY_ON;
}

/**
 * The storage cutoff under a Chat history setting: off deletes every line, on deletes those
 * older than STORAGE_AGE_DAYS.
 * @param {HistoryCount} count
 * @param {number} now
 * @returns {number}
 */
export function storageCutoff(count, now) {
  return count === 0 ? Infinity : now - STORAGE_AGE_DAYS * DAY_MS;
}
