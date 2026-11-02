import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, filmstripWindow, step } from './roster.js';

test('step moves by delta and clamps at both ends without wrapping', () => {
  assert.equal(step(2, 1, 5), 3);
  assert.equal(step(2, -1, 5), 1);
  assert.equal(step(4, 1, 5), 4, 'the last item does not wrap to the first');
  assert.equal(step(0, -1, 5), 0, 'the first item does not wrap to the last');
  assert.equal(step(1, 10, 5), 4);
  assert.equal(step(0, 0, 1), 0);
  assert.equal(step(0, 1, 0), -1, 'an empty roster has no index');
});

test('the filmstrip window centres on the item, shifts inward at the ends, and never overruns', () => {
  assert.deepEqual(filmstripWindow(5, 11, 5), { start: 3, end: 8 });
  assert.deepEqual(filmstripWindow(0, 11, 5), { start: 0, end: 5 });
  assert.deepEqual(filmstripWindow(10, 11, 5), { start: 6, end: 11 });
  assert.deepEqual(filmstripWindow(1, 3, 5), { start: 0, end: 3 }, 'a short roster is shown whole');
  assert.deepEqual(filmstripWindow(5, 11, 4), { start: 4, end: 8 }, 'an even window leans right');
  assert.deepEqual(filmstripWindow(0, 0, 5), { start: 0, end: 0 });
  assert.deepEqual(filmstripWindow(3, 5, 0), { start: 0, end: 0 });
  assert.deepEqual(filmstripWindow(99, 5, 3), { start: 2, end: 5 }, 'an index past the end is clamped');
});

test('dedupe keeps each share id once, at its first occurrence, in order', () => {
  /** @param {string} id @param {string} src */
  const item = (id, src) => ({ id, src, thumb: null, kind: /** @type {const} */ ('unknown') });
  const out = dedupe([item('a', '1'), item('b', '2'), item('a', '3'), item('c', '4'), item('b', '5')]);
  assert.deepEqual(
    out.map((i) => `${i.id}${i.src}`),
    ['a1', 'b2', 'c4'],
  );
  assert.deepEqual(dedupe([]), []);
});
