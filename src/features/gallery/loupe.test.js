import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOUPE_SIZE, loupeFrame } from './loupe.js';

const origin = { left: 20, top: 10 };
/** A 1000x800 image shown at 500x400 from (100, 50). */
const rect = { left: 100, top: 50, width: 500, height: 400 };
const natural = { width: 1000, height: 800 };

test('the loupe is 200px', () => {
  assert.equal(LOUPE_SIZE, 200);
});

test('at the image centre the loupe is centred on the cursor and shows the natural centre', () => {
  const f = loupeFrame({ clientX: 350, clientY: 250, rect, natural, origin });
  assert.deepEqual(f, { left: 230, top: 140, bgX: 100 - 500, bgY: 100 - 400, bgW: 1000, bgH: 800 });
});

test('a scaled image maps the cursor to its natural pixel', () => {
  const f = loupeFrame({ clientX: 150, clientY: 150, rect, natural, origin });
  // 50px in on screen is 100 natural px; 100px down is 200.
  assert.equal(f?.bgX, 100 - 100);
  assert.equal(f?.bgY, 100 - 200);
});

test('at a corner the background is offset past the edge, so the loupe is clipped, not clamped', () => {
  const f = loupeFrame({ clientX: 100, clientY: 50, rect, natural, origin });
  assert.deepEqual(f, { left: -20, top: -60, bgX: 100, bgY: 100, bgW: 1000, bgH: 800 });
  const g = loupeFrame({ clientX: 600, clientY: 450, rect, natural, origin });
  assert.equal(g?.bgX, 100 - 1000);
  assert.equal(g?.bgY, 100 - 800);
});

test('a 1:1 image still draws', () => {
  const f = loupeFrame({ clientX: 110, clientY: 60, rect, natural: { width: 500, height: 400 }, origin });
  assert.deepEqual(f, { left: -10, top: -50, bgX: 90, bgY: 90, bgW: 500, bgH: 400 });
});

test('outside the image, or with a zero size, there is no frame', () => {
  assert.equal(loupeFrame({ clientX: 99, clientY: 250, rect, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 451, rect, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect: { ...rect, width: 0 }, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect, natural: { width: 0, height: 800 }, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect, natural: { width: 1000, height: 0 }, origin }), null);
});
