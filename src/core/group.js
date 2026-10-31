// Message grouping: a run of public messages from one sender shows its avatar, name and
// time once. A sender change, a whisper, a notice or a gap over GROUP_GAP_S ends the run.

/** Messages further apart than this start a new group even from the same sender. */
export const GROUP_GAP_S = 5 * 60;

/**
 * What grouping reads from a row: its sender, its kind and its time in seconds.
 * @typedef {{ user: string, kind: string, t: number }} GroupKey
 */

/**
 * A record's time in seconds: its `mTime`, or its receipt time while pending (empty mTime).
 * @param {{ mTime: string, receivedAt: number }} record
 */
export function groupTime(record) {
  const t = Number(record.mTime);
  return t > 0 ? t : record.receivedAt / 1000;
}

/**
 * A record's replay order in milliseconds: `groupTime` scaled, so history replays by message
 * time (TDF-0031). A record with no mTime (an own message the server never returns, or an
 * engine notice) sorts by its `orderAt`, an estimate of its server time set once a poll has
 * supplied clock-skew samples and re-estimated when an own message's send is confirmed;
 * without one, it sorts by its receipt time.
 * @param {{ mTime: string, receivedAt: number, orderAt?: number }} record
 */
export function orderKey(record) {
  if (!(Number(record.mTime) > 0) && typeof record.orderAt === 'number') return record.orderAt;
  return groupTime(record) * 1000;
}

/**
 * Whether `cur` continues the group `prev` belongs to. Only public messages group; a
 * whisper or notice never continues one and is never continued.
 * @param {GroupKey | null} prev
 * @param {GroupKey} cur
 */
export function continuesGroup(prev, cur) {
  return (
    prev !== null &&
    prev.kind === 'public' &&
    cur.kind === 'public' &&
    prev.user === cur.user &&
    Math.abs(cur.t - prev.t) <= GROUP_GAP_S
  );
}

/**
 * 24-hour local `HH:MM` for a time in seconds.
 * @param {number} seconds
 */
export function clockHHMM(seconds) {
  const d = new Date(seconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The local calendar day of a time in seconds, as `YYYY-MM-DD`.
 * @param {number} seconds
 */
export function localDay(seconds) {
  const d = new Date(seconds * 1000);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @type {Map<string | undefined, { weekday: Intl.DateTimeFormat, month: Intl.DateTimeFormat }>} */
const labelFormatters = new Map();

/**
 * The weekday and month formatters for `locale`, built once per locale.
 * @param {string} [locale]
 */
function formattersFor(locale) {
  let f = labelFormatters.get(locale);
  if (!f) {
    f = {
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }),
    };
    labelFormatters.set(locale, f);
  }
  return f;
}

/**
 * A message's time label: `HH:MM` on the viewer's local day, otherwise the full form
 * `<weekday>, <month> <day> <year> HH:MM` (`Thu, Oct 29 2026 22:43` in en-US). Weekday and
 * month names follow `locale` (the viewer's own when omitted); the order is fixed, 24-hour.
 * @param {number} seconds the message's time
 * @param {number} nowSeconds the viewer's current time
 * @param {string} [locale]
 */
export function timeLabel(seconds, nowSeconds, locale) {
  const clock = clockHHMM(seconds);
  if (localDay(seconds) === localDay(nowSeconds)) return clock;
  const d = new Date(seconds * 1000);
  const f = formattersFor(locale);
  const weekday = f.weekday.format(d);
  const month = f.month.format(d);
  return `${weekday}, ${month} ${d.getDate()} ${d.getFullYear()} ${clock}`;
}
