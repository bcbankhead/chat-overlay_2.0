// The gallery's display order (TDF-0060), defined here and nowhere else. A record's display key
// is its manual `position` when it has one, else its `receivedAt`: both are in milliseconds, so
// a new capture, carrying the newest `receivedAt`, lands at the top of any manual order. Keys
// sort descending, ties broken by id. Eviction (shareParse.js `overLimit`) never reads this: it
// stays on `receivedAt` alone.

/**
 * The fields the order reads.
 * @typedef {{ id: string, receivedAt: number, position?: number }} Orderable
 */

/**
 * A record's display key.
 * @param {Orderable} r
 * @returns {number}
 */
export const displayKey = (r) => r.position ?? r.receivedAt;

/**
 * Descending by display key, then ascending by id, so equal keys still order the same way.
 * @param {Orderable} a
 * @param {Orderable} b
 * @returns {number}
 */
function compareDisplay(a, b) {
  const d = displayKey(b) - displayKey(a);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sort `rows` into display order, in place, and return them.
 * @template {Orderable} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function displayOrder(rows) {
  return rows.sort(compareDisplay);
}

/**
 * A key strictly between the keys of the tile above (`above`, the larger) and the tile below.
 * An open end takes one millisecond past the other; no neighbour at all takes 0. Null when no
 * double lies strictly between them: the gap is exhausted, or the two keys are equal.
 * @param {number | null} above
 * @param {number | null} below
 * @returns {number | null}
 */
export function keyBetween(above, below) {
  if (above === null && below === null) return 0;
  if (above === null) {
    const k = /** @type {number} */ (below) + 1;
    return k > /** @type {number} */ (below) ? k : null;
  }
  if (below === null) {
    const k = above - 1;
    return k < above ? k : null;
  }
  const k = above / 2 + below / 2;
  return k < above && k > below ? k : null;
}

/**
 * The writes that move `id` between `aboveId` and `belowId` (null for an open end) when their
 * gap has no room (keyBetween returned null), given every record. The caller owns the one-write
 * case; this only rebalances: the smallest run around the drop whose bounds leave a millisecond
 * per row is respaced evenly, and only the moved row and the rows whose key changes are written.
 * A missing record yields no writes; a missing neighbour is an open end.
 * @param {Orderable[]} rows
 * @param {string} id
 * @param {string | null} aboveId
 * @param {string | null} belowId
 * @returns {{ id: string, position: number }[]}
 */
export function planRebalance(rows, id, aboveId, belowId) {
  const moved = rows.find((r) => r.id === id);
  if (!moved) return [];
  const above = aboveId === null ? undefined : rows.find((r) => r.id === aboveId && r.id !== id);
  const below = belowId === null ? undefined : rows.find((r) => r.id === belowId && r.id !== id);

  const order = displayOrder(rows.filter((r) => r.id !== id));
  const at = below ? order.indexOf(below) : above ? order.indexOf(above) + 1 : 0;
  order.splice(at, 0, moved);
  const top = order.reduce((m, r) => Math.max(m, displayKey(r)), -Infinity);

  let i = at;
  let j = at;
  /** @type {number[]} */
  let keys = [];
  for (;;) {
    const count = j - i + 1;
    const hi = i > 0 ? displayKey(order[i - 1]) : null;
    const lo = j < order.length - 1 ? displayKey(order[j + 1]) : null;
    if (hi === null && lo === null) {
      keys = order.slice(i, j + 1).map((_, m) => top - m);
      break;
    }
    if (hi === null) {
      keys = order.slice(i, j + 1).map((_, m) => /** @type {number} */ (lo) + count - m);
      break;
    }
    if (lo === null) {
      keys = order.slice(i, j + 1).map((_, m) => hi - 1 - m);
      break;
    }
    if (hi - lo >= count + 1) {
      const step = (hi - lo) / (count + 1);
      keys = order.slice(i, j + 1).map((_, m) => hi - step * (m + 1));
      break;
    }
    // Widen by one on each side that can still widen.
    if (i > 0) i -= 1;
    if (j < order.length - 1) j += 1;
  }

  /** @type {{ id: string, position: number }[]} */
  const writes = [];
  order.slice(i, j + 1).forEach((r, m) => {
    if (r === moved || displayKey(r) !== keys[m]) writes.push({ id: r.id, position: keys[m] });
  });
  return writes;
}
