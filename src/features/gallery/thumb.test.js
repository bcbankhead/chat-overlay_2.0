import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeThumb } from './thumb.js';

test('the thumbnail is a 128×128 centre crop, encoded as WebP, and the bitmap is released', async () => {
  /** @type {unknown[][]} */
  const drawn = [];
  /** @type {unknown[]} */
  const encoded = [];
  let closed = false;
  let size = [0, 0];
  const out = new Blob([new Uint8Array(4)], { type: 'image/webp' });
  const env = /** @type {any} */ ({
    createImageBitmap: async () => ({ width: 300, height: 200, close: () => (closed = true) }),
    OffscreenCanvas: class {
      /** @param {number} w @param {number} h */
      constructor(w, h) {
        size = [w, h];
      }
      getContext() {
        return { drawImage: (/** @type {unknown[]} */ ...args) => drawn.push(args.slice(1)) };
      }
      /** @param {unknown} opts */
      async convertToBlob(opts) {
        encoded.push(opts);
        return out;
      }
    },
  });
  assert.equal(await makeThumb(new Blob([]), env), out);
  assert.deepEqual(size, [128, 128]);
  assert.deepEqual(drawn, [[50, 0, 200, 200, 0, 0, 128, 128]]);
  assert.deepEqual(encoded, [{ type: 'image/webp', quality: 0.82 }]);
  assert.equal(closed, true);
});

test('a browser without canvas support refuses with the reason', async () => {
  await assert.rejects(makeThumb(new Blob([]), {}), /cannot draw thumbnails/);
});

test('a canvas with no 2d context refuses, and still releases the bitmap', async () => {
  let closed = false;
  const env = /** @type {any} */ ({
    createImageBitmap: async () => ({ width: 10, height: 10, close: () => (closed = true) }),
    OffscreenCanvas: class {
      getContext() {
        return null;
      }
    },
  });
  await assert.rejects(makeThumb(new Blob([]), env), /no 2d canvas context/);
  assert.equal(closed, true);
});
