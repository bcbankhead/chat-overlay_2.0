// Live capture: every share id in an inbound message (core's onInbound, live records only)
// is fetched once, on a serial queue, and stored with its thumbnail. The full image is kept
// only with `storeImagesOffline` on. A failed fetch stores the record broken, with its reason
// and without a thumbnail; the same id shared again retries it, so a passing network fault
// does not break an image for good. No backfill: images are captured only while the script runs.
// Bytes already stored under another share id are not stored again (TDF-0009.13), and the
// signed-in user's own shares are skipped unless `includeMyImages` is on.

import { fetchShare } from './fetchShare.js';
import { sha256Hex } from './hash.js';
import { extractShareIds } from './shareParse.js';

/**
 * @typedef {object} CaptureDeps
 * @property {Promise<{ store: import('./store.js').ImageStore, settings: import('../../core/settings.js').Settings }>} ready
 * @property {(listener: (record: import('../../core/history.js').MessageRecord) => void) => () => void} onInbound
 * @property {typeof globalThis.fetch} fetch
 * @property {(blob: Blob) => Promise<Blob>} makeThumb
 * @property {() => string} base      the chat page's address, to derive share URLs from
 * @property {(err: unknown) => void} report
 * @property {number} [timeoutMs]    per share fetch; fetchShare's default when absent
 * @property {() => string} self      the signed-in user, in the engine's raw form; '' when unknown
 * @property {(blob: Blob) => Promise<string>} [hash]  content hash; sha256Hex when absent
 */

/**
 * Start capturing. Records arriving before the database opens wait on the queue.
 * @param {CaptureDeps} deps
 */
export function startCapture({ ready, onInbound, fetch, makeThumb, base, report, timeoutMs, self, hash = sha256Hex }) {
  /** @type {Set<string>} ids queued or being fetched */
  const queued = new Set();
  /** @type {Map<string, string>} ids skipped as a duplicate of another id's bytes, to their hash */
  const duplicates = new Map();
  /** @type {Promise<void>} */
  let queue = Promise.resolve();

  /**
   * @param {string} id
   * @param {import('../../core/history.js').MessageRecord} message
   */
  async function captureOne(id, message) {
    const { store, settings } = await ready;
    // Read per share, so a toggle applies from the next share; own images stored before stay.
    const me = self();
    if (me !== '' && message.user === me && !(await settings.get('includeMyImages'))) return;
    // A known duplicate is not fetched again while the bytes it duplicates are still stored.
    const known = duplicates.get(id);
    if (known !== undefined) {
      if (await store.findByHash(known)) return;
      duplicates.delete(id);
    }
    const existing = await store.get(id);
    if (existing && !existing.broken) return;
    /** @type {import('./store.js').ImageRecord} */
    const record = {
      id,
      messageId: message.id,
      user: message.user,
      mTime: message.mTime,
      roomID: message.roomID,
      receivedAt: message.receivedAt,
      contentType: '',
      thumb: null,
      bytes: 0,
      favorite: false,
      broken: false,
    };
    /** @type {{ blob: Blob, contentType: string }} */
    let fetched;
    try {
      fetched = await fetchShare(id, { base: base(), fetch, timeoutMs });
    } catch (err) {
      // Not an error to report: the image is stored broken, and its tile shows why.
      const reason = err instanceof Error ? err.message : String(err);
      if (existing) await store.markBroken(id, reason);
      else await store.put({ ...record, broken: true, brokenReason: reason });
      return;
    }
    const { blob, contentType } = fetched;
    record.contentType = contentType;
    try {
      record.hash = await hash(blob);
    } catch (err) {
      // Stored without a hash, so not deduped; capture is never blocked by it.
      report(new Error(`gallery: no hash for image ${id}: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (record.hash !== undefined) {
      const same = await store.findByHash(record.hash);
      if (same && same.id !== id) {
        // The same bytes under another share id. A new one is skipped; a broken retry is
        // removed as the duplicate, unless it is a favourite, which is never deleted.
        if (!existing) {
          duplicates.set(id, record.hash);
          return;
        }
        if (!existing.favorite) {
          await store.remove(id);
          duplicates.set(id, record.hash);
          return;
        }
      }
    }
    try {
      record.thumb = await makeThumb(blob);
    } catch (err) {
      // Kept without a thumbnail: Save still works, the tile shows a placeholder.
      report(new Error(`gallery: no thumbnail for image ${id}: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (await settings.get('storeImagesOffline')) record.blob = blob;
    record.bytes = (record.blob?.size ?? 0) + (record.thumb?.size ?? 0);
    // A retry keeps the first capture's message and favourite, and takes what this fetch made.
    if (existing) {
      const { contentType: type, thumb, blob: kept, bytes, hash: sum } = record;
      await store.repair(id, {
        contentType: type,
        thumb,
        bytes,
        ...(kept ? { blob: kept } : {}),
        ...(sum !== undefined ? { hash: sum } : {}),
      });
    } else await store.put(record);
  }

  onInbound((message) => {
    for (const id of extractShareIds(message.text)) {
      if (queued.has(id)) continue;
      queued.add(id);
      queue = queue
        .then(() => captureOne(id, message))
        .catch(report)
        .finally(() => queued.delete(id));
    }
  });
}
