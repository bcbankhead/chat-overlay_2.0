import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayKey, displayOrder, keyBetween, planRebalance } from './order.js';

/**
 * @param {string} id
 * @param {number} receivedAt
 * @param {number} [position]
 */
const r = (id, receivedAt, position) => (position === undefined ? { id, receivedAt } : { id, receivedAt, position });

/**
 * Apply `writes` to `rows` and return the ids in display order.
 * @param {{ id: string, receivedAt: number, position?: number }[]} rows
 * @param {{ id: string, position: number }[]} writes
 */
const after = (rows, writes) => {
  const byId = new Map(writes.map((w) => [w.id, w.position]));
  return displayOrder(rows.map((x) => (byId.has(x.id) ? { ...x, position: byId.get(x.id) } : x))).map((x) => x.id);
};

test('the display key is the position when set, else receivedAt; order is descending, ties by id', () => {
  assert.equal(displayKey(r('a', 5)), 5);
  assert.equal(displayKey(r('a', 5, 2)), 2);
  assert.equal(displayKey(r('a', 5, 0)), 0, 'a zero position still counts');
  const rows = [r('a', 1), r('b', 3), r('c', 2, 10), r('e', 3), r('d', 3)];
  assert.deepEqual(displayOrder(rows).map((x) => x.id), ['c', 'b', 'd', 'e', 'a']);
});

test('a new capture, carrying the newest receivedAt, lands above every manual position', () => {
  const rows = [r('a', 1000, 5000), r('b', 2000, 1500), r('new', 6000)];
  assert.deepEqual(displayOrder(rows).map((x) => x.id), ['new', 'a', 'b']);
});

test('keyBetween: the midpoint, an open end one past the other, no neighbours 0', () => {
  assert.equal(keyBetween(10, 4), 7);
  assert.equal(keyBetween(null, 4), 5);
  assert.equal(keyBetween(10, null), 9);
  assert.equal(keyBetween(null, null), 0);
});

test('keyBetween is null once no double lies strictly between, or the keys are equal', () => {
  assert.equal(keyBetween(5, 5), null);
  assert.equal(keyBetween(1, 1 - Number.EPSILON / 2), null);
  const big = 2 ** 53;
  assert.equal(keyBetween(null, big), null, 'big + 1 is big');
  assert.equal(keyBetween(big, null), big - 1);
});

test('planRebalance: a missing record writes nothing; a missing neighbour is an open end', () => {
  // a and b share a key, so nothing lies between them.
  const rows = [r('a', 1000), r('b', 1000), r('c', 5)];
  assert.deepEqual(planRebalance(rows, 'gone', 'a', 'b'), []);
  assert.deepEqual(after(rows, planRebalance(rows, 'c', 'a', 'gone')), ['a', 'c', 'b'], 'straight below a');
  assert.deepEqual(after(rows, planRebalance(rows, 'c', 'gone', 'b')), ['a', 'c', 'b'], 'straight above b');
});

test('planRebalance rebalances an exhausted gap, writing only the rows whose key changes', () => {
  // a and b share a key, so nothing lies between them; d and e are far below and untouched.
  const rows = [r('a', 1000), r('b', 1000), r('c', 1001 - 1, 999), r('d', 10), r('e', 5)];
  const writes = planRebalance(rows, 'd', 'a', 'b');
  assert.deepEqual(after(rows, writes), ['a', 'd', 'b', 'c', 'e']);
  assert.ok(!writes.some((w) => w.id === 'e'), 'e keeps its key');
  assert.ok(writes.some((w) => w.id === 'd'));
  const keys = new Map(writes.map((w) => [w.id, w.position]));
  const final = rows.map((x) => keys.get(x.id) ?? x.position ?? x.receivedAt);
  assert.equal(new Set(final).size, final.length, 'every key distinct afterwards');
});

test('planRebalance takes over once repeated halving exhausts the gap, keeping the order', () => {
  /** @type {{ id: string, receivedAt: number, position?: number }[]} */
  let rows = [r('top', 2), r('bottom', 1), r('x', 0)];
  let rebalanced = 0;
  // Drop x between top and bottom, then the old bottom back below it, many times: each halves the
  // gap, as store.move does, until keyBetween runs out and the rebalance respaces the run.
  for (let n = 0; n < 80; n += 1) {
    const order = displayOrder([...rows]).map((x) => x.id);
    const last = order[order.length - 1];
    const key = (/** @type {string} */ id) => displayKey(/** @type {typeof rows[0]} */ (rows.find((x) => x.id === id)));
    const k = keyBetween(key(order[0]), key(order[1]));
    if (k === null) rebalanced += 1;
    const writes = k !== null ? [{ id: last, position: k }] : planRebalance(rows, last, order[0], order[1]);
    const byId = new Map(writes.map((w) => [w.id, w.position]));
    rows = rows.map((x) => (byId.has(x.id) ? { ...x, position: byId.get(x.id) } : x));
    const now = displayOrder([...rows]).map((x) => x.id);
    assert.deepEqual(now, [order[0], last, order[1]], `pass ${n}`);
  }
  assert.ok(rebalanced > 0, 'the gap ran out at least once');
});

test('planRebalance into a crowded top run respaces above the row below it', () => {
  const rows = [r('a', 5, 1), r('b', 5, 1), r('c', 0)];
  assert.deepEqual(after(rows, planRebalance(rows, 'c', 'a', 'b')), ['a', 'c', 'b']);
});
