// Live capture (TDF-0015): an image you like (core's onLiked) is saved with the record of the
// message that shared it, read from history, or with the liked row's own sender and time when
// history has none (retention off, or pruned); your own shares are saved as they arrive (core's
// onInbound, live records only) while `includeMyImages` is on. Other members' shares are not
// saved until you like them. Each share id is fetched once, on a serial queue, and stored with
// its thumbnail. The full image is kept only with `storeImagesOffline` on. A failed fetch
// stores the record broken, with its reason and without a thumbnail; it is retried when anyone
// shares the same id again, when a failed like is retried, or when you share it again with
// `includeMyImages` on, so a passing network fault does not break an image for good. No
// backfill: images are captured only while the script runs, and past likes are not replayed.
// Bytes already stored under another share id are not stored again (TDF-0009.13).

import { fetchShare } from './fetchShare.js';
import { sha256Hex } from './hash.js';
import { extractShareIds } from './shareParse.js';

/**
 * @typedef {object} CaptureDeps
 * @property {Promise<{ store: import('./store.js').ImageStore, settings: import('../../core/settings.js').Settings }>} ready
 * @property {(listener: (record: import('../../core/history.js').MessageRecord) => void) => () => void} onInbound
 * @property {(listener: (liked: import('../../core/events.js').Liked) => void) => () => void} onLiked
 * @property {(id: string) => Promise<import('../../core/history.js').MessageRecord | undefined>} getMessage
 * @property {() => string} roomID    the current room, for a liked image whose message is not stored
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
export function startCapture({ ready, onInbound, onLiked, getMessage, roomID, fetch, makeThumb, base, report, timeoutMs, self, hash = sha256Hex }) {
  /** @type {Set<string>} ids queued or being fetched */
  const queued = new Set();
  /** @type {Map<string, string>} ids skipped as a duplicate of another id's bytes, to their hash */
  const duplicates = new Map();
  /** @type {Promise<void>} */
  let queue = Promise.resolve();

  /**
   * @param {string} id
   * @param {Pick<import('../../core/history.js').MessageRecord, 'id' | 'user' | 'mTime' | 'roomID' | 'receivedAt'>} message
   */
  async function captureOne(id, message) {
    const { store, settings } = await ready;
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
      // Kept without a thumbnail: opening still works, the tile shows a placeholder.
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

  /**
   * Queue one share id, unless it is already queued or being fetched.
   * @param {string} id
   * @param {() => Promise<void>} run
   */
  function enqueue(id, run) {
    if (queued.has(id)) return;
    queued.add(id);
    queue = queue
      .then(run)
      .catch(report)
      .finally(() => queued.delete(id));
  }

  /**
   * Retry an id already stored broken; anything else is left alone. Checked off the queue, so
   * a share that is not stored never takes the queued guard from a like of it.
   * @param {string} id
   * @param {import('../../core/history.js').MessageRecord} message
   */
  function retryBroken(id, message) {
    ready.then(
      ({ store }) =>
        store
          .get(id)
          .then((existing) => {
            if (existing?.broken) enqueue(id, () => captureOne(id, message));
          })
          .catch(report),
      // A database that never opens is reported by the queued paths, not again per share here.
      () => {},
    );
  }

  onInbound((message) => {
    const me = self();
    const own = me !== '' && message.user === me;
    for (const id of extractShareIds(message.text)) {
      if (!own) {
        retryBroken(id, message);
        continue;
      }
      enqueue(id, async () => {
        const { settings } = await ready;
        // Read per share, so a toggle applies from the next share; own images stored before stay.
        if (await settings.get('includeMyImages')) await captureOne(id, message);
      });
    }
  });

  onLiked(({ shareId, messageId, user, mTime }) => {
    enqueue(shareId, async () => {
      // History keeps nothing with retention off, and prunes old rows: the row stands in.
      const message =
        (await getMessage(messageId)) ??
        (user !== '' ? { id: messageId, user, mTime, roomID: roomID(), receivedAt: Date.now() } : undefined);
      if (!message) throw new Error(`gallery: liked image ${shareId} not saved: message ${messageId} is not stored and its row has no sender`);
      await captureOne(shareId, message);
    });
  });
}
