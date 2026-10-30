// The stored thumbnail (UI design 2026-10-27, Gallery): decoded once at capture, centre
// cropped to a square, drawn at 128×128 and encoded as WebP. A browser that cannot encode
// WebP returns another type, which is stored as returned.

const THUMB_SIZE = 128;
const QUALITY = 0.82;

/**
 * @param {Blob} blob  the full image
 * @param {{ createImageBitmap?: typeof globalThis.createImageBitmap, OffscreenCanvas?: typeof globalThis.OffscreenCanvas }} [env]
 * @returns {Promise<Blob>}
 */
export async function makeThumb(blob, env = globalThis) {
  const { createImageBitmap, OffscreenCanvas } = env;
  if (!createImageBitmap || !OffscreenCanvas) throw new Error('this browser cannot draw thumbnails');
  const bmp = await createImageBitmap(blob);
  try {
    const side = Math.min(bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
  } finally {
    bmp.close();
  }
}
