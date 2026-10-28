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
