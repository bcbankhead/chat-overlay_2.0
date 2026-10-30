// The content hash capture dedups on (TDF-0009.13): SHA-256 of an image's fetched bytes, as
// lowercase hex. Byte-identical only; a resized or re-encoded copy hashes differently.

/**
 * @param {Blob} blob
 * @param {SubtleCrypto} [subtle]
 * @returns {Promise<string>}
 */
export async function sha256Hex(blob, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
