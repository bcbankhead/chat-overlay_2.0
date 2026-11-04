import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mayBeAnimated } from './animated.js';

/** @param {string} s */
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** @param {number} n */
const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** @param {...number[]} parts */
const bytes = (...parts) => Uint8Array.from(parts.flat());

/**
 * A WebP header whose first chunk is `chunk`, with `body` as that chunk's data.
 * @param {string} chunk @param {number[]} body
 */
const webp = (chunk, body) => bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii(chunk), [body.length, 0, 0, 0], body);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * One PNG chunk: length, type, data, a zero CRC.
 * @param {string} type @param {number} [length]
 */
const pngChunk = (type, length = 0) => [...be32(length), ...ascii(type), ...new Array(length).fill(0), 0, 0, 0, 0];

/**
 * An ISO BMFF ftyp box with the given brands.
 * @param {string} major @param {string[]} compatible
 */
const ftyp = (major, compatible) => {
  const size = 16 + 4 * compatible.length;
  return bytes(be32(size), ascii('ftyp'), ascii(major), [0, 0, 0, 0], ...compatible.map(ascii));
};

test('a WebP whose VP8X carries the animation flag is animated', () => {
  assert.equal(mayBeAnimated(webp('VP8X', [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(mayBeAnimated(webp('VP8X', [0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
});

test('a static WebP is not: VP8X without the flag, VP8 and VP8L', () => {
  assert.equal(mayBeAnimated(webp('VP8X', [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  assert.equal(mayBeAnimated(webp('VP8 ', [0, 0, 0, 0])), false);
  assert.equal(mayBeAnimated(webp('VP8L', [0, 0, 0, 0])), false);
});

test('a WebP cut off before its answer is kept as possibly animated', () => {
  assert.equal(mayBeAnimated(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'))), true);
  assert.equal(mayBeAnimated(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii('VP8X'), [10, 0, 0, 0])), true);
});

test('a PNG with acTL before IDAT is animated', () => {
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13), pngChunk('acTL', 8), pngChunk('IDAT', 4))), true);
});

test('a plain PNG reaches IDAT first and is static, even with acTL after it', () => {
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('IEND'))), false);
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('acTL', 8))), false);
});

test('a PNG cut off mid-chunk, or whose pre-IDAT chunks run past the read window, is kept', () => {
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13).slice(0, 10))), true);
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13), be32(70000), ascii('iCCP'), new Array(64).fill(0))), true);
  assert.equal(mayBeAnimated(bytes(PNG_SIG)), true);
});

test('an AVIF with the avis brand, major or compatible, is animated', () => {
  assert.equal(mayBeAnimated(ftyp('avis', ['avif', 'mif1'])), true);
  assert.equal(mayBeAnimated(ftyp('avif', ['mif1', 'avis', 'miaf'])), true);
});

test('an AVIF with only still-image brands is static', () => {
  assert.equal(mayBeAnimated(ftyp('avif', ['mif1', 'miaf'])), false);
});

test('an AVIF ftyp box cut off before its brands end is kept', () => {
  assert.equal(mayBeAnimated(ftyp('avif', ['mif1', 'miaf', 'MA1B']).slice(0, 20)), true);
  assert.equal(mayBeAnimated(bytes(be32(0), ascii('ftyp'), ascii('avif'))), true);
});

test('an AVIF ftyp box with a 64-bit size is read past its larger header', () => {
  const box = (/** @type {string} */ brand) => bytes(be32(1), ascii('ftyp'), be32(0), be32(28), ascii('avif'), [0, 0, 0, 0], ascii(brand));
  assert.equal(mayBeAnimated(box('avis')), true);
  assert.equal(mayBeAnimated(box('mif1')), false);
});

test('an AVIF ftyp box with a 64-bit size it cannot read is kept', () => {
  assert.equal(mayBeAnimated(bytes(be32(1), ascii('ftyp'), be32(0), [0, 0])), true);
  assert.equal(mayBeAnimated(bytes(be32(1), ascii('ftyp'), be32(1), be32(28), ascii('avif'), [0, 0, 0, 0], ascii('mif1'))), true);
});

test('a PNG that reaches IEND before any IDAT is static', () => {
  assert.equal(mayBeAnimated(bytes(PNG_SIG, pngChunk('IHDR', 13), pngChunk('IEND'))), false);
});

test('GIF bytes are kept whatever type they claim', () => {
  assert.equal(mayBeAnimated(bytes(ascii('GIF89a'), new Array(20).fill(0))), true);
  assert.equal(mayBeAnimated(bytes(ascii('GIF87a'), new Array(20).fill(0))), true);
});

test('bytes matching no container are not animated', () => {
  assert.equal(mayBeAnimated(new Uint8Array(0)), false);
  assert.equal(mayBeAnimated(new Uint8Array(1000)), false);
  assert.equal(mayBeAnimated(bytes([0xff, 0xd8, 0xff, 0xe0], new Array(20).fill(0))), false);
  assert.equal(mayBeAnimated(bytes(ascii('BM'), new Array(30).fill(0))), false);
  assert.equal(mayBeAnimated(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WAVE'), ascii('fmt '))), false);
});
