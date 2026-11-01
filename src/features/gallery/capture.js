// Live capture (TDF-0015): an image you like (core's onLiked) is saved with the record of the
// message that shared it, read from history, or with the liked row's own sender and time when
// history has none (retention off, or pruned); your own shares are saved as they arrive (core's
// onInbound, live records only) while `includeMyImages` is on. Other members' shares are not
// saved until you like them. Each share id is fetched once, on a serial queue, and stored with
// its thumbnail. The full image is kept only with `storeImagesOffline` on. A failed fetch
// stores the record broken, with its reason and without a thumbnail; it is retried when anyone
// shares the same id again, when a failed like is retried, or when you share it again with
// `includeMyImages` on, so a passing network fault does not break an image for good. Images
// are captured only while the script runs, and past likes are not replayed.
// Bytes already stored under another share id are not stored again (TDF-0009.13).
// With `compressStoredImages` on too, the kept copy is the fetched one re-encoded as a smaller
// JPEG when that is smaller (TDF-0036); the hash stays the fetched bytes'. `backfill` applies
// the same to originals stored before, one per task on the same queue.

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
 * @property {(blob: Blob) => Promise<Blob | null>} [compress]  a smaller re-encode of a stored
 *   original, or null to keep it (reencode.js); absent, originals are stored as fetched
 */

/**
 * Start capturing. Records arriving before the database opens wait on the queue.
 * @param {CaptureDeps} deps
 * @returns {{ backfill: () => Promise<void> }}
 */
export function startCapture({ ready, onInbound, onLiked, getMessage, roomID, fetch, makeThumb, base, report, timeoutMs, self, hash = sha256Hex, compress }) {
  /** @type {Set<string>} ids queued or being fetched */
  const queued = new Set();
  /** @type {Map<string, string>} ids skipped as a duplicate of another id's bytes, to their hash */
  const duplicates = new Map();
  /** @type {Promise<void>} */
  let queue = Promise.resolve();
  /** Whether a backfill is running, from listing to its last task, so a second call does not run alongside. */
  let backfilling = false;

  /**
   * The copy of `blob` to store: a smaller re-encode, or `blob` itself when compression keeps it
   * or fails (reported). Either way the decision is made, so the record is `compressChecked`.
   * @param {string} id
   * @param {Blob} blob
   * @returns {Promise<Blob>}
   */
  async function compressed(id, blob) {
    if (!compress) return blob;
    try {
      return (await compress(blob)) ?? blob;
    } catch (err) {
      report(new Error(`gallery: image ${id} kept uncompressed: ${err instanceof Error ? err.message : String(err)}`));
      return blob;
    }
  }

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
    if (await settings.get('storeImagesOffline')) {
      record.blob = blob;
      if (compress && (await settings.get('compressStoredImages'))) {
        record.blob = await compressed(id, blob);
        if (record.blob !== blob) record.contentType = record.blob.type;
        record.compressChecked = true;
      }
    }
    record.bytes = (record.blob?.size ?? 0) + (record.thumb?.size ?? 0);
    // A retry keeps the first capture's message and favourite, and takes what this fetch made.
    if (existing) {
      const { contentType: type, thumb, blob: kept, bytes, hash: sum, compressChecked: checked } = record;
      await store.repair(id, {
        contentType: type,
        thumb,
        bytes,
        ...(kept ? { blob: kept } : {}),
        ...(sum !== undefined ? { hash: sum } : {}),
        ...(checked ? { compressChecked: true } : {}),
      });
    } else await store.put(record);
  }

  /**
   * Queue one share id, unless it is already queued or being fetched.
   * @param {string} id
   * @param {() => Promise<void>} run
   * @returns {boolean} whether it was queued
   */
  function enqueue(id, run) {
    if (queued.has(id)) return false;
    queued.add(id);
    queue = queue
      .then(run)
      .catch(report)
      .finally(() => queued.delete(id));
    return true;
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

  /**
   * Decide one stored original's compression, unless the setting went off since it was queued
   * or the record changed: gone, broken, without a blob, or already decided.
   * @param {string} id
   * @returns {Promise<boolean>} false when the setting is off, so the backfill stops
   */
  async function compressStored(id) {
    const { store, settings } = await ready;
    if (!(await settings.get('compressStoredImages'))) return false;
    const row = await store.get(id);
    if (!row?.blob || row.broken || row.compressChecked) return true;
    const blob = await compressed(id, row.blob);
    await store.recompress(
      id,
      row.blob.size,
      blob === row.blob
        ? { compressChecked: true }
        : { blob, bytes: blob.size + (row.thumb?.size ?? 0), contentType: blob.type, compressChecked: true },
    );
    return true;
  }

  /**
   * Compress every stored original whose compression is undecided, one task at a time: the
   * next id is queued only when the one before finishes, so a live capture queued meanwhile
   * runs first. The run stops when the setting goes off, and a call during a run does nothing.
   * A record decided by a reload's earlier pass is not listed again.
   */
  async function backfill() {
    if (!compress || backfilling) return;
    backfilling = true;
    /** @type {string[]} */
    let ids;
    try {
      const { store } = await ready;
      ids = await store.pendingCompression();
    } catch (err) {
      backfilling = false;
      throw err;
    }
    /** @param {number} i */
    const next = (i) => {
      for (; i < ids.length; i++) {
        const id = ids[i];
        const at = i;
        const queuedNow = enqueue(`compress:${id}`, async () => {
          let more = true;
          try {
            more = await compressStored(id);
          } finally {
            if (more) next(at + 1);
            else backfilling = false;
          }
        });
        if (queuedNow) return;
      }
      backfilling = false;
    };
    next(0);
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

  return { backfill };
}
