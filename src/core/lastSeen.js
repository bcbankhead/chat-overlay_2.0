// The 'last seen' tooltip text for a Recently online row (TDF-0066): how long ago a user's newest
// entry or exit line was sent, bucketed to hours below a day and days from a day on. Pure: the
// caller supplies "now" on the server's clock, so device clock skew never reaches the age.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * @param {number} n
 * @param {string} unit singular
 * @returns {string}
 */
const count = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The tooltip for a line sent at `mTimeSeconds`, read at `nowMs`.
 * Under an hour → 'Last seen < 1 hour ago'; 1 to 23 hours → 'Last seen N hour(s) ago';
 * 24 hours and over → 'Last seen N day(s) ago'. A line from the future (clock noise) reads as
 * under an hour.
 * @param {string | number | null | undefined} mTimeSeconds server unix time, seconds
 * @param {number} nowMs epoch ms on the server's clock
 * @returns {string | null} null when the time is absent, not a positive finite number, or `nowMs`
 *   is not finite
 */
export function lastSeenText(mTimeSeconds, nowMs) {
  if (mTimeSeconds === null || mTimeSeconds === undefined || mTimeSeconds === '') return null;
  const seconds = Number(mTimeSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(nowMs)) return null;
  const age = Math.max(0, nowMs - seconds * 1000);
  if (age < HOUR_MS) return 'Last seen < 1 hour ago';
  if (age < DAY_MS) return `Last seen ${count(Math.floor(age / HOUR_MS), 'hour')} ago`;
  return `Last seen ${count(Math.floor(age / DAY_MS), 'day')} ago`;
}
