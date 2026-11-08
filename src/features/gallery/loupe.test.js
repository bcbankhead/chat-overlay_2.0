import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOUPE_SIZE, loupeFrame, loupeSize } from './loupe.js';

const origin = { left: 20, top: 10 };
/** A 1000x800 image shown at 500x400 from (100, 50). */
const rect = { left: 100, top: 50, width: 500, height: 400 };
const natural = { width: 1000, height: 800 };

test('the loupe is 500px', () => {
  assert.equal(LOUPE_SIZE, 500);
});

test('at the image centre the loupe is centred on the cursor and shows the natural centre', () => {
  const f = loupeFrame({ clientX: 350, clientY: 250, rect, natural, origin });
  assert.deepEqual(f, { size: 500, left: 80, top: -10, bgX: 250 - 500, bgY: 250 - 400, bgW: 1000, bgH: 800 });
});

test('a scaled image maps the cursor to its natural pixel', () => {
  const f = loupeFrame({ clientX: 150, clientY: 150, rect, natural, origin });
  // 50px in on screen is 100 natural px; 100px down is 200.
  assert.equal(f?.bgX, 250 - 100);
  assert.equal(f?.bgY, 250 - 200);
});

test('at a corner the background is offset past the edge, so the loupe is clipped, not clamped', () => {
  const f = loupeFrame({ clientX: 100, clientY: 50, rect, natural, origin });
  assert.deepEqual(f, { size: 500, left: -170, top: -210, bgX: 250, bgY: 250, bgW: 1000, bgH: 800 });
  const g = loupeFrame({ clientX: 600, clientY: 450, rect, natural, origin });
  assert.equal(g?.bgX, 250 - 1000);
  assert.equal(g?.bgY, 250 - 800);
});

test('a 1:1 image still draws', () => {
  const f = loupeFrame({ clientX: 110, clientY: 60, rect, natural: { width: 500, height: 400 }, origin });
  assert.deepEqual(f, { size: 500, left: -160, top: -200, bgX: 240, bgY: 240, bgW: 500, bgH: 400 });
});

test('outside the image, or with a zero size, there is no frame', () => {
  assert.equal(loupeFrame({ clientX: 99, clientY: 250, rect, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 451, rect, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect: { ...rect, width: 0 }, natural, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect, natural: { width: 0, height: 800 }, origin }), null);
  assert.equal(loupeFrame({ clientX: 350, clientY: 250, rect, natural: { width: 1000, height: 0 }, origin }), null);
});

test('in a smaller layer the loupe shrinks to its shorter side and stays centred on the cursor', () => {
  const f = loupeFrame({ clientX: 350, clientY: 250, rect, natural, origin, bound: { width: 600, height: 300 } });
  assert.deepEqual(f, { size: 300, left: 180, top: 90, bgX: 150 - 500, bgY: 150 - 400, bgW: 1000, bgH: 800 });
});

test('the loupe size is LOUPE_SIZE unless a positive side of the bound is smaller', () => {
  assert.equal(loupeSize(), LOUPE_SIZE);
  assert.equal(loupeSize({ width: 900, height: 700 }), LOUPE_SIZE, 'a larger layer is no cap');
  assert.equal(loupeSize({ width: 320, height: 640 }), 320);
  assert.equal(loupeSize({ width: 0, height: 0 }), LOUPE_SIZE, 'an unmeasured layer is no cap');
  assert.equal(loupeSize({ width: 0, height: 250 }), 250);
  assert.equal(loupeSize({ width: 333.7, height: 600 }), 333, 'rounded down to a whole pixel');
});