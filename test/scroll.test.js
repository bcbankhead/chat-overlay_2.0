import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atBottom, slideTop } from '../src/core/scroll.js';

test('exactly at the bottom is pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 300, clientHeight: 200 }), true);
});

test('one pixel off the bottom still counts as pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 299, clientHeight: 200 }), true);
});

test('scrolled up is not pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 100, clientHeight: 200 }), false);
});

test('a slide starts at its full gap and ends at the bottom', () => {
  assert.equal(slideTop(120, 0, 150), 120);
  assert.equal(slideTop(120, 150, 150), 0);
  assert.equal(slideTop(120, 400, 150), 0, 'a late frame never overshoots');
  assert.equal(slideTop(120, -5, 150), 120, 'a frame stamped before the start holds the gap');
});

test('a slide eases out: most of the distance goes early, and it never backs up', () => {
  assert.equal(slideTop(80, 75, 150), 10, 'half the time leaves an eighth of the gap');
  let last = Infinity;
  for (let t = 0; t <= 150; t += 5) {
    const gap = slideTop(80, t, 150);
    assert.ok(gap <= last, `gap grew at ${t}ms`);
    last = gap;
  }
});

test('a zero duration jumps straight to the bottom', () => {
  assert.equal(slideTop(50, 0, 0), 0);
});
