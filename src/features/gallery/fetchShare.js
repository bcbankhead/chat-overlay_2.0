// One fetch of a share's full image, for capture: same-origin with the session
// cookie, bounded by a timeout so one stalled request cannot hold the capture queue, and
// refused unless the answer is an image (the plugin answers some refusals 200 with text,
// "no access"). A refusal throws with its reason, which the caller keeps on the record.

import { shareUrl } from './shareParse.js';

/** How long one share fetch may take before it counts as failed. */
export const SHARE_TIMEOUT_MS = 30_000;

/**
 * @param {string} id
 * @param {{ base: string, fetch: typeof globalThis.fetch, timeoutMs?: number }} deps
 * @returns {Promise<{ blob: Blob, contentType: string }>}
 */
export async function fetchShare(id, { base, fetch, timeoutMs = SHARE_TIMEOUT_MS }) {
  /** @type {Response} */
  let res;
  try {
    res = await fetch(shareUrl(id, base), { credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = /** @type {{ name?: string }} */ (err)?.name;
    if (name === 'TimeoutError') throw new Error(`no answer within ${timeoutMs} ms`);
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  // Blob.type is '' when unknown, never null, so `||` and not `??`.
  const contentType = res.headers.get('content-type') || blob.type || '';
  if (!/^image\//i.test(contentType)) throw new Error(`not an image: ${contentType || 'no content type'}`);
  return { blob, contentType };
}
