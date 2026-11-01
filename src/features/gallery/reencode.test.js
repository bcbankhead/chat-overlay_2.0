import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RASTER_TYPES } from './open.js';
import { REENCODE_TYPES, baseType, compressOriginal } from './reencode.js';

/**
 * A canvas environment whose image is `width`×`height`, every pixel of alpha `alpha`, encoding to
 * `outSize` bytes. `readError`, when given, is thrown by getImageData, as a tainted canvas does.
 * @param {{ width?: number, height?: number, alpha?: number, outSize?: number, readError?: Error, decodeFails?: boolean, encodeFails?: boolean }} [opts]
 */
function canvasEnv({ width = 300, height = 600, alpha = 255, outSize = 10, readError, decodeFails = false, encodeFails = false } = {}) {
  const log = {
    closed: false,
    /** @type {number[]} */ size: [],
    /** @type {unknown[]} */ encoded: [],
    /** @type {number[][]} */ reads: [],
    /** @type {unknown[][]} */ fills: [],
    /** @type {string[]} */ composite: [],
  };
  const env = /** @type {any} */ ({
    createImageBitmap: async () => {
      if (decodeFails) throw new Error('cannot decode');
      return { width, height, close: () => (log.closed = true) };
    },
    OffscreenCanvas: class {
      /** @param {number} w @param {number} h */
      constructor(w, h) {
        log.size = [w, h];
      }
      getContext() {
        return {
          drawImage() {},
          /** @param {number} x @param {number} y @param {number} w @param {number} h */
          getImageData(x, y, w, h) {
            if (readError) throw readError;
            log.reads.push([x, y, w, h]);
            const data = new Uint8ClampedArray(w * h * 4).fill(255);
            for (let i = 3; i < data.length; i += 4) data[i] = alpha;
            return { data };
          },
          set globalCompositeOperation(/** @type {string} */ v) {
            log.composite.push(v);
          },
          fillStyle: '',
          /** @param {unknown[]} args */
          fillRect(...args) {
            log.fills.push([this.fillStyle, ...args]);
          },
        };
      }
      /** @param {unknown} opts */
      async convertToBlob(opts) {
        log.encoded.push(opts);
        if (encodeFails) throw new Error('cannot encode');
        return new Blob([new Uint8Array(outSize)], { type: 'image/jpeg' });
      }
    },
  });
  return { env, log };
}

/** @param {string} type @param {number} [size] */
const original = (type, size = 1000) => new Blob([new Uint8Array(size)], { type });

/** @param {string} message @param {string} name */
const namedError = (message, name) => Object.assign(new Error(message), { name });

test('REENCODE_TYPES is a subset of open.js RASTER_TYPES, without GIF', () => {
  for (const type of REENCODE_TYPES) assert.ok(RASTER_TYPES.has(type), `${type} is not a raster type`);
  assert.equal(REENCODE_TYPES.has('image/gif'), false);
});

test('GIFs and non-raster types are kept as they are, without decoding', async () => {
  for (const type of ['image/gif', 'image/svg+xml', 'text/html', '']) {
    const { env, log } = canvasEnv();
    assert.equal(await compressOriginal(original(type), env), null);
    assert.deepEqual(log.size, []);
  }
});

test('an opaque PNG is re-encoded as JPEG 0.8 at its own dimensions, scanned in strips, and the bitmap released', async () => {
  const { env, log } = canvasEnv({ width: 300, height: 600 });
  const out = await compressOriginal(original('image/png'), env);
  assert.equal(out?.type, 'image/jpeg');
  assert.equal(out?.size, 10);
  assert.deepEqual(log.size, [300, 600]);
  assert.deepEqual(log.encoded, [{ type: 'image/jpeg', quality: 0.8 }]);
  assert.deepEqual(log.reads, [[0, 0, 300, 256], [0, 256, 300, 256], [0, 512, 300, 88]]);
  assert.equal(log.closed, true);
});

test('a JPEG or BMP is not scanned for alpha', async () => {
  for (const type of ['image/jpeg', 'image/bmp']) {
    const { env, log } = canvasEnv({ alpha: 0 });
    assert.equal((await compressOriginal(original(type), env))?.type, 'image/jpeg');
    assert.deepEqual(log.reads, []);
  }
});

test('an image with real transparency is kept, not encoded', async () => {
  for (const type of ['image/png', 'image/webp', 'image/avif']) {
    const { env, log } = canvasEnv({ alpha: 254 });
    assert.equal(await compressOriginal(original(type), env), null);
    assert.deepEqual(log.encoded, []);
    assert.equal(log.closed, true);
  }
});

test('a re-encode that is not smaller is discarded', async () => {
  for (const outSize of [1000, 2000]) {
    const { env } = canvasEnv({ outSize });
    assert.equal(await compressOriginal(original('image/png', 1000), env), null);
  }
});

test('pixels that cannot be read are flattened onto white, then encoded', async () => {
  const { env, log } = canvasEnv({ readError: namedError('tainted', 'SecurityError'), width: 40, height: 30 });
  assert.equal((await compressOriginal(original('image/png'), env))?.type, 'image/jpeg');
  assert.deepEqual(log.composite, ['destination-over']);
  assert.deepEqual(log.fills, [['#ffffff', 0, 0, 40, 30]]);
});

test('a pixel read failing other than by SecurityError rejects, unflattened, and releases the bitmap', async () => {
  const { env, log } = canvasEnv({ readError: namedError('canvas too large', 'RangeError') });
  await assert.rejects(compressOriginal(original('image/png'), env), /canvas too large/);
  assert.deepEqual(log.fills, []);
  assert.deepEqual(log.encoded, []);
  assert.equal(log.closed, true);
});

test('a type with parameters or in upper case is normalized before it is checked', async () => {
  const { env, log } = canvasEnv({ alpha: 0 });
  assert.equal(await compressOriginal(original('image/PNG; charset=x'), env), null);
  assert.equal(log.reads.length > 0, true);
  const opaque = canvasEnv();
  assert.equal((await compressOriginal(original('image/PNG; charset=x'), opaque.env))?.type, 'image/jpeg');
  const jpeg = canvasEnv({ alpha: 0 });
  assert.equal((await compressOriginal(original(' Image/JPEG ;q=1'), jpeg.env))?.type, 'image/jpeg');
  assert.deepEqual(jpeg.log.reads, []);
});

test('baseType drops parameters and lower-cases', () => {
  assert.equal(baseType('image/PNG; charset=x'), 'image/png');
  assert.equal(baseType(' image/jpeg '), 'image/jpeg');
  assert.equal(baseType(''), '');
});

test('decode and encode failures reject, and an encode failure still releases the bitmap', async () => {
  await assert.rejects(compressOriginal(original('image/png'), canvasEnv({ decodeFails: true }).env), /cannot decode/);
  const { env, log } = canvasEnv({ encodeFails: true });
  await assert.rejects(compressOriginal(original('image/png'), env), /cannot encode/);
  assert.equal(log.closed, true);
  await assert.rejects(compressOriginal(original('image/png'), {}), /cannot re-encode/);
});

test('a canvas with no 2d context rejects, and still releases the bitmap', async () => {
  let closed = false;
  const env = /** @type {any} */ ({
    createImageBitmap: async () => ({ width: 10, height: 10, close: () => (closed = true) }),
    OffscreenCanvas: class {
      getContext() {
        return null;
      }
    },
  });
  await assert.rejects(compressOriginal(original('image/png'), env), /no 2d canvas context/);
  assert.equal(closed, true);
});
