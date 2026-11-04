// Stored-original compression (TDF-0036): a full image re-encoded as JPEG at its own width and
// height, kept only when smaller than what was fetched. Built as thumb.js is, from
// createImageBitmap and an OffscreenCanvas. A canvas keeps only the first frame, so GIFs are never
// handled, and neither is an animated WebP, APNG or AVIF, detected from its header by animated.js
// (TDF-0064); nor is anything outside REENCODE_TYPES. An image with real transparency is skipped,
// since JPEG has none; one whose pixels cannot be read is flattened onto white instead.

import { mayBeAnimated } from './animated.js';

/** JPEG quality of a re-encoded original; fixed, not a setting. */
const QUALITY = 0.8;

/** Leading bytes read for animation detection; a container not answered within them is kept. */
const HEAD_BYTES = 64 * 1024;

/** Rows read per alpha scan strip, so a large image is not read into one buffer. */
const STRIP_ROWS = 256;

/** Types a stored original may be re-encoded from; a subset of open.js's RASTER_TYPES. */
export const REENCODE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp']);

/** Types that carry no alpha channel, so their pixels are not scanned. */
const OPAQUE_TYPES = new Set(['image/jpeg', 'image/bmp']);

/**
 * A MIME type without its parameters, lower-cased.
 * @param {string} type
 * @returns {string}
 */
export const baseType = (type) => type.split(';')[0].trim().toLowerCase();

/**
 * @typedef {object} ReencodeEnv
 * @property {typeof globalThis.createImageBitmap} [createImageBitmap]
 * @property {typeof globalThis.OffscreenCanvas} [OffscreenCanvas]
 */

/**
 * Whether any pixel of the drawn canvas is not fully opaque.
 * @param {OffscreenCanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function hasAlpha(ctx, width, height) {
  for (let y = 0; y < height; y += STRIP_ROWS) {
    const { data } = ctx.getImageData(0, y, width, Math.min(STRIP_ROWS, height - y));
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  }
  return false;
}

/**
 * The original re-encoded as a smaller JPEG, or null when it is kept as it is: an unhandled
 * type, an image that may be animated, real transparency, or a re-encode that is not smaller.
 * Decode and encode errors reject.
 * @param {Blob} blob  the fetched original
 * @param {ReencodeEnv} [env]
 * @returns {Promise<Blob | null>}
 */
export async function compressOriginal(blob, env = globalThis) {
  const type = baseType(blob.type);
  if (!REENCODE_TYPES.has(type)) return null;
  if (mayBeAnimated(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()))) return null;
  const { createImageBitmap, OffscreenCanvas } = env;
  if (!createImageBitmap || !OffscreenCanvas) throw new Error('this browser cannot re-encode images');
  const bmp = await createImageBitmap(blob);
  try {
    const { width, height } = bmp;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas context');
    ctx.drawImage(bmp, 0, 0);
    if (!OPAQUE_TYPES.has(type)) {
      /** @type {boolean} */
      let alpha;
      try {
        alpha = hasAlpha(ctx, width, height);
      } catch (err) {
        if (!(err instanceof Error && err.name === 'SecurityError')) throw err;
        // Expected where a canvas refuses a pixel read; harmless by design (TDF-0036 plan): the
        // image is flattened onto white, so any transparency is not encoded as black, and an
        // opaque image is unchanged by it.
        alpha = false;
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      if (alpha) return null;
    }
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    return out.size < blob.size ? out : null;
  } finally {
    bmp.close();
  }
}
