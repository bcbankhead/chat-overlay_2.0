// Live capture: every share id in an inbound message (core's onInbound, live records only)
// is fetched once, on a serial queue, and stored with its thumbnail. The full image is kept
// only with `storeImagesOffline` on. A failed fetch stores the record broken, without a
// thumbnail. No backfill: images are captured only while the script runs.

import { extractShareIds, shareUrl } from './shareParse.js';

/**
 * @typedef {object} CaptureDeps
 * @property {Promise<{ store: import('./store.js').ImageStore, settings: import('../../core/settings.js').Settings }>} ready
 * @property {(listener: (record: import('../../core/history.js').MessageRecord) => void) => () => void} onInbound
 * @property {typeof globalThis.fetch} fetch
 * @property {(blob: Blob) => Promise<Blob>} makeThumb
 * @property {() => string} base      the chat page's address, to derive share URLs from
 * @property {(err: unknown) => void} report
 */

/**
 * Start capturing. Records arriving before the database opens wait on the queue.
 * @param {CaptureDeps} deps
 */
export function startCapture({ ready, onInbound, fetch, makeThumb, base, report }) {
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
    if (await store.has(id)) return;
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
    /** @type {Blob} */
    let blob;
    try {
      const res = await fetch(shareUrl(id, base()), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
      record.contentType = res.headers.get('content-type') ?? blob.type ?? '';
      // The plugin answers some refusals 200 with text ("no access"): not an image.
      if (!/^image\//i.test(record.contentType)) throw new Error(`not an image: ${record.contentType}`);
    } catch {
      // Not an error to report: the image is stored broken, and its tile shows that.
      await store.put({ ...record, broken: true });
      return;
    }
    try {
      record.thumb = await makeThumb(blob);
    } catch (err) {
      // Kept without a thumbnail: Save still works, the tile shows a placeholder.
      report(new Error(`gallery: no thumbnail for image ${id}: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (await settings.get('storeImagesOffline')) record.blob = blob;
    record.bytes = (record.blob?.size ?? 0) + (record.thumb?.size ?? 0);
    await store.put(record);
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
