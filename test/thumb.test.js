import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thumbGeometry } from '../src/core/thumb.js';

const area = (over) => ({ view: 100, total: 400, scrollTop: 0, inset: 3, min: 24, ...over });

test('nothing overflows: no thumb', () => {
  assert.equal(thumbGeometry(area({ total: 100 })), null);
  assert.equal(thumbGeometry(area({ total: 101 })), null, 'a one-pixel overflow is rounding, not content');
  assert.equal(thumbGeometry(area({ total: 50 })), null);
});

test('the thumb is sized to the visible share of the track and starts at the inset', () => {
  // track 94; 94 * 100 / 400 = 23.5, raised to the minimum
  assert.deepEqual(thumbGeometry(area()), { height: 24, offset: 3 });
  assert.deepEqual(thumbGeometry(area({ total: 200 })), { height: 47, offset: 3 });
});

test('the thumb keeps a minimum height on long content', () => {
  assert.equal(thumbGeometry(area({ total: 100000 }))?.height, 24);
});

test('scrolled to the end, the thumb sits at the end of the track', () => {
  const g = thumbGeometry(area({ total: 200, scrollTop: 100 }));
  assert.deepEqual(g, { height: 47, offset: 3 + 94 - 47 });
  const mid = thumbGeometry(area({ total: 200, scrollTop: 50 }));
  assert.equal(mid?.offset, 3 + (94 - 47) / 2);
});

test('overscroll is clamped to the track', () => {
  assert.equal(thumbGeometry(area({ total: 200, scrollTop: 150 }))?.offset, 3 + 94 - 47);
  assert.equal(thumbGeometry(area({ total: 200, scrollTop: -20 }))?.offset, 3);
});

test('the thumb never outgrows a short track', () => {
  assert.equal(thumbGeometry(area({ view: 20, total: 40 }))?.height, 14);
});
