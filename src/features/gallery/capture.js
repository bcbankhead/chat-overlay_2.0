// Live capture: every share id in an inbound message (core's onInbound, live records only)
// is fetched once, on a serial queue, and stored with its thumbnail. The full image is kept
// only with `storeImagesOffline` on. A failed fetch stores the record broken, with its reason
// and without a thumbnail; the same id shared again retries it, so a passing network fault
// does not break an image for good. No backfill: images are captured only while the script runs.

import { fetchShare } from './fetchShare.js';
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
 */

/**
 * Start capturing. Records arriving before the database opens wait on the queue.
 * @param {CaptureDeps} deps
 */
export function startCapture({ ready, onInbound, fetch, makeThumb, base, report, timeoutMs }) {
  /** @type {Set<string>} ids queued or being fetched */
  const queued = new Set();
  /** @type {Promise<void>} */
  let queue = Promise.resolve();

  /**
   * @param {string} id
   * @param {import('../../core/history.js').MessageRecord} message
   */
  async function captureOne(id, message) {
    const { store, settings } = await ready;
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
      record.thumb = await makeThumb(blob);
    } catch (err) {
      // Kept without a thumbnail: Save still works, the tile shows a placeholder.
      report(new Error(`gallery: no thumbnail for image ${id}: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (await settings.get('storeImagesOffline')) record.blob = blob;
    record.bytes = (record.blob?.size ?? 0) + (record.thumb?.size ?? 0);
    // A retry keeps the first capture's message and favourite, and takes what this fetch made.
    if (existing) {
      const { contentType: type, thumb, blob: kept, bytes } = record;
      await store.repair(id, { contentType: type, thumb, bytes, ...(kept ? { blob: kept } : {}) });
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
