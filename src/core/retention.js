// The Chat history rules (TDF-0033.5), shared by the core's replay and by the Options feature's
// prune (which re-exports them from selectors.js). Pure: no I/O.
//
// The member's setting is Chat history (last HISTORY_ON): on replays the newest HISTORY_ON
// lines, off keeps and replays none. Storage is bounded apart from it, by a fixed internal age.
// The rows kept on screen during live chat are bounded apart from it too, by LIVE_CEILING
// (TDF-0056), so lowering the look-back never shrinks live chat.

export const DAY_MS = 86_400_000;

/**
 * The Chat history setting: 25 replays the newest 25 lines, 0 keeps and replays none.
 * @typedef {0 | 25} HistoryCount
 */

/**
 * Chat history on, the look-back (TDF-0056): the most stored lines replay shows, the most
 * pre-load server lines the engine may draw (TDF-0055), and the label's count.
 */
export const HISTORY_ON = /** @type {const} */ (25);

/**
 * The most rows the view keeps on screen, whatever the Chat history setting (TDF-0056): live
 * lines show with history off too. Separate from HISTORY_ON, which it does not follow.
 */
export const LIVE_CEILING = /** @type {const} */ (200);

/** Stored lines older than this are deleted, whatever the setting; there is no control for it. */
export const STORAGE_AGE_DAYS = 30;

/**
 * A stored Chat history value, read: anything other than 0 reads as on (HISTORY_ON, 25), so an
 * out-of-range value is never handed on, and a value stored under the old look-back (100) reads
 * as on with no migration.
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
