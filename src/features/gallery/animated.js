// Animation detection for stored-original compression (TDF-0064). A canvas re-encode keeps one
// frame, and static and animated WebP, PNG and AVIF share a MIME type, so the decision reads the
// container header instead: WebP's VP8X animation flag, PNG's acTL chunk before IDAT, AVIF's
// `avis` brand. A recognised container whose header ends before that answer is reached counts as
// possibly animated, so an uncertain image is kept as fetched rather than flattened. GIF bytes
// count as possibly animated whatever MIME type they arrive under, since a GIF served as
// image/png or image/webp would otherwise pass the type check and be decoded to its first frame.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** VP8X flags bit marking an animated WebP. */
const WEBP_ANIMATION_FLAG = 0x02;

/** Offset of the VP8X flags byte: RIFF header (12) + chunk fourcc (4) + chunk size (4). */
const VP8X_FLAGS_AT = 20;

/**
 * The four bytes at `at` as ASCII, or null when they run past the end.
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {string | null}
 */
function fourcc(bytes, at) {
  if (at + 4 > bytes.length) return null;
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * The big-endian unsigned 32-bit integer at `at`; the caller checks the bounds.
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {number}
 */
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

/**
 * A WebP header's answer: the first chunk decides it.
 * @param {Uint8Array} bytes  starting `RIFF....WEBP`
 * @returns {boolean}
 */
function webp(bytes) {
  const chunk = fourcc(bytes, 12);
  if (chunk === null) return true;
  if (chunk !== 'VP8X') return false;
  if (bytes.length <= VP8X_FLAGS_AT) return true;
  return (bytes[VP8X_FLAGS_AT] & WEBP_ANIMATION_FLAG) !== 0;
}

/**
 * A PNG header's answer: an acTL chunk before the first IDAT marks an APNG.
 * @param {Uint8Array} bytes  starting with the PNG signature
 * @returns {boolean}
 */
function png(bytes) {
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const type = fourcc(bytes, at + 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    // length + type + data + CRC
    at += 12 + u32(bytes, at);
  }
  return true;
}

/**
 * An ISO BMFF `ftyp` box's answer: `avis` as the major or a compatible brand marks an image
 * sequence.
 * @param {Uint8Array} bytes  with `ftyp` at offset 4
 * @returns {boolean}
 */
function avif(bytes) {
  let size = u32(bytes, 0);
  let header = 8;
  if (size === 0) return true;
  if (size === 1) {
    if (bytes.length < 16) return true;
    if (u32(bytes, 8) !== 0) return true;
    size = u32(bytes, 12);
    header = 16;
  }
  const end = Math.min(size, bytes.length);
  if (fourcc(bytes, header) === 'avis') return true;
  // major brand (4) + minor version (4), then compatible brands to the end of the box
  for (let at = header + 8; at + 4 <= end; at += 4) if (fourcc(bytes, at) === 'avis') return true;
  return size > bytes.length;
}

/**
 * Whether an image's leading bytes show, or cannot rule out, more than one frame. True for an
 * animated WebP, an APNG, an AVIF image sequence, or any of those containers cut off before the
 * header gives its answer, and any GIF; false for their static forms and for anything else.
 * @param {Uint8Array} bytes  the start of the file; need not be all of it
 * @returns {boolean}
 */
export function mayBeAnimated(bytes) {
  if (fourcc(bytes, 0) === 'RIFF' && fourcc(bytes, 8) === 'WEBP') return webp(bytes);
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return png(bytes);
  if (bytes.length >= 8 && fourcc(bytes, 4) === 'ftyp') return avif(bytes);
  if (fourcc(bytes, 0) === 'GIF8') return true;
  return false;
}
