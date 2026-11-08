// The gallery's access to the `images` store (TDF-0009 Shared Contract). A favourite is
// protected here, inside the deleting transaction, not only by the UI: `remove` refuses one
// and the size limit never selects one. Every write notifies `onImagesChange` listeners, so
// an open gallery follows writes from capture, its own tiles and TDF-0009.4's limit alike.

import { STORES, done, request } from '../../core/db.js';
import { reportGalleryError } from './errors.js';
import { displayOrder, keyBetween, displayKey, planRebalance } from './order.js';
import { overLimit } from './shareParse.js';

/**
 * @typedef {object} ImageRecord
 * @property {string} id            the share id; the URL is derived from it
 * @property {string} messageId     the message it arrived in (provisional `local-…` for an own echo)
 * @property {string} user          sender, as the engine passed it
 * @property {string} mTime         unix seconds, '' for an own pending echo
 * @property {string} roomID
 * @property {number} receivedAt
 * @property {string} contentType   as served, or the stored blob's own type once compression
 *                                  re-encoded it; '' when the image never loaded
 * @property {Blob | null} thumb    128×128 centre crop, made once at capture
 * @property {Blob} [blob]          the full image, only with `storeImagesOffline` on; a smaller
 *                                  JPEG re-encode of it with `compressStoredImages` on
 * @property {number} bytes         stored on disk for this record: blob (if kept) plus thumb
 * @property {boolean} favorite
 * @property {boolean} broken       the server copy failed to load at capture
 * @property {string} [brokenReason] why it failed, shown on the tile's badge
 * @property {string} [hash]        SHA-256 of the fetched bytes, lowercase hex; absent on a
 *                                  broken record, a failed hash, and captures before schema v2
 * @property {boolean} [compressChecked] the stored blob's compression was decided (TDF-0036):
 *                                  re-encoded, kept as smaller, excluded or failed; the
 *                                  backfill never processes it again
 * @property {number} [position]    manual display key (TDF-0060), in receivedAt's units; absent
 *                                  until a member drags the tile. Display order only (order.js):
 *                                  eviction ignores it
 */

/** Refused by `remove` for a favourite. */
export class FavoriteProtectedError extends Error {
  /** @param {string} id */
  constructor(id) {
    super(`image ${id} is a favourite and cannot be deleted`);
    this.name = 'FavoriteProtectedError';
  }
}

/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * Called after every committed write to `images` through any gallery store.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onImagesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      reportGalleryError(err);
    }
  }
}

/** @param {ImageRecord} r */
const originalBytes = (r) => r.blob?.size ?? 0;
/** @param {ImageRecord} r */
const thumbBytes = (r) => r.thumb?.size ?? 0;

/**
 * What a size limit of `limitBytes` would delete from `rows`.
 * @param {ImageRecord[]} rows
 * @param {number} limitBytes
 * @returns {{ ids: string[], count: number, bytes: number }}
 */
function limitPreview(rows, limitBytes) {
  const ids = overLimit(rows, limitBytes);
  const chosen = new Set(ids);
  const bytes = rows.reduce((sum, r) => sum + (chosen.has(r.id) ? r.bytes || 0 : 0), 0);
  return { ids, count: ids.length, bytes };
}

/** @param {IDBDatabase} db */
export function createImageStore(db) {
  /** @param {IDBTransactionMode} mode */
  const tx = (mode) => db.transaction(STORES.images, mode);

  /** @returns {Promise<ImageRecord[]>} */
  const all = () => request(tx('readonly').objectStore(STORES.images).getAll());

  /**
   * One readwrite transaction that reads every record, then deletes what `overLimit` selects.
   * @param {number} limitBytes
   * @returns {Promise<string[]>}
   */
  async function deleteOverLimit(limitBytes) {
    const t = tx('readwrite');
    const store = t.objectStore(STORES.images);
    const rows = /** @type {ImageRecord[]} */ (await request(store.getAll()));
    const ids = overLimit(rows, limitBytes);
    for (const id of ids) store.delete(id);
    await done(t);
    if (ids.length) notify();
    return ids;
  }

  /**
   * Read, change and write one record in one transaction; a missing record is left alone.
   * @param {string} id
   * @param {(r: ImageRecord) => ImageRecord} change
   */
  async function update(id, change) {
    const t = tx('readwrite');
    const store = t.objectStore(STORES.images);
    const row = /** @type {ImageRecord | undefined} */ (await request(store.get(id)));
    if (row) store.put(change(row));
    await done(t);
    if (row) notify();
  }

  return {
    /** @param {string} id */
    async has(id) {
      return (await request(tx('readonly').objectStore(STORES.images).count(id))) > 0;
    },

    /**
     * @param {string} id
     * @returns {Promise<ImageRecord | undefined>}
     */
    get(id) {
      return request(tx('readonly').objectStore(STORES.images).get(id));
    },

    /**
     * The stored image with these bytes, if any.
     * @param {string} hash
     * @returns {Promise<ImageRecord | undefined>}
     */
    findByHash(hash) {
      return request(tx('readonly').objectStore(STORES.images).index('hash').get(hash));
    },

    /**
     * Store a newly captured image. An id already stored is kept as it is, so a repeated
     * share never resets a favourite or replaces the first capture; so are bytes already
     * stored under another id, decided in the same transaction as the add.
     * @param {ImageRecord} record
     * @returns {Promise<boolean>} whether it was added
     */
    async put(record) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.images);
      const exists =
        (await request(store.count(record.id))) > 0 ||
        (record.hash !== undefined && (await request(store.index('hash').count(record.hash))) > 0);
      if (!exists) store.add(record);
      await done(t);
      if (!exists) notify();
      return !exists;
    },

    /** Every image, in display order (order.js): manual positions, else newest first. */
    async list() {
      return displayOrder(await all());
    },

    /**
     * One sender's images, in display order.
     * @param {string} user
     * @returns {Promise<ImageRecord[]>}
     */
    async listByUser(user) {
      const rows = await request(tx('readonly').objectStore(STORES.images).index('user').getAll(user));
      return displayOrder(rows);
    },

    /**
     * @param {string} id
     * @param {boolean} favorite
     */
    setFavorite(id, favorite) {
      return update(id, (r) => ({ ...r, favorite }));
    },

    /**
     * @param {string} id
     * @param {string} reason
     */
    markBroken(id, reason) {
      // A broken record takes no part in dedup, so it drops the hash its bytes once had.
      return update(id, (r) => {
        const { hash: _gone, ...rest } = r;
        return { ...rest, broken: true, brokenReason: reason };
      });
    },

    /**
     * The server copy loaded again: clear the broken state, merging what the new fetch made
     * (a capture retry's thumbnail, for one). A favourite stays a favourite.
     * @param {string} id
     * @param {Partial<Pick<ImageRecord, 'contentType' | 'thumb' | 'blob' | 'bytes' | 'hash' | 'compressChecked'>>} [fields]
     */
    repair(id, fields = {}) {
      return update(id, (r) => {
        const { brokenReason: _gone, ...rest } = r;
        return { ...rest, ...fields, broken: false };
      });
    },

    /**
     * Ids whose stored original has not yet had its compression decided (TDF-0036's backfill):
     * a blob kept, not broken, not `compressChecked`. Read with a cursor, one record at a time.
     * @returns {Promise<string[]>}
     */
    pendingCompression() {
      return new Promise((resolve, reject) => {
        /** @type {string[]} */
        const ids = [];
        const req = tx('readonly').objectStore(STORES.images).openCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(ids);
          const r = /** @type {ImageRecord} */ (cursor.value);
          if (r.blob && !r.broken && !r.compressChecked) ids.push(r.id);
          cursor.continue();
        };
      });
    },

    /**
     * Replace a stored original with its compression's outcome, in one transaction, only while
     * the record still holds a blob of `readSize` bytes: one replaced or dropped since it was
     * read is left alone, as is a missing record. Nothing else changes, a favourite included.
     * @param {string} id
     * @param {number} readSize  the stored blob's size when it was read for compression
     * @param {Partial<Pick<ImageRecord, 'blob' | 'bytes' | 'contentType' | 'compressChecked'>>} fields
     * @returns {Promise<boolean>} whether it was written
     */
    async recompress(id, readSize, fields) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.images);
      const row = /** @type {ImageRecord | undefined} */ (await request(store.get(id)));
      const current = row !== undefined && row.blob !== undefined && row.blob.size === readSize;
      if (row && current) store.put({ ...row, ...fields });
      await done(t);
      if (current) notify();
      return current;
    },

    /**
     * Delete one image permanently. Rejects with FavoriteProtectedError for a favourite,
     * decided inside the same transaction as the delete.
     * @param {string} id
     */
    async remove(id) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.images);
      const row = /** @type {ImageRecord | undefined} */ (await request(store.get(id)));
      if (row?.favorite) {
        t.abort();
        // The abort is ours, and done() rejects on it: nothing to report.
        await done(t).catch(() => {});
        throw new FavoriteProtectedError(id);
      }
      if (row) store.delete(id);
      await done(t);
      if (row) notify();
    },

    /**
     * Move one image between two others in display order (TDF-0060), null for an open end, in
     * one transaction: one write when the neighbours' gap has room (order.js keyBetween), else
     * a respaced run (order.js planRebalance). A missing record is left alone; a missing
     * neighbour is an open end.
     * @param {string} id
     * @param {string | null} aboveId
     * @param {string | null} belowId
     */
    async move(id, aboveId, belowId) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.images);
      /** @param {string | null} key */
      const read = (key) =>
        key === null ? undefined : /** @type {Promise<ImageRecord | undefined>} */ (request(store.get(key)));
      const [row, above, below] = await Promise.all([read(id), read(aboveId), read(belowId)]);
      /** @type {ImageRecord[]} */
      let written = [];
      if (row) {
        const k = keyBetween(above ? displayKey(above) : null, below ? displayKey(below) : null);
        if (k !== null) {
          written = [{ ...row, position: k }];
        } else {
          const rows = /** @type {ImageRecord[]} */ (await request(store.getAll()));
          const byId = new Map(rows.map((r) => [r.id, r]));
          written = planRebalance(rows, id, aboveId, belowId).map((w) => ({
            .../** @type {ImageRecord} */ (byId.get(w.id)),
            position: w.position,
          }));
        }
        for (const r of written) store.put(r);
      }
      await done(t);
      if (written.length) notify();
    },

    /** Count, size on disk split into originals and thumbnails, and favourites. */
    async stats() {
      const rows = await all();
      let originals = 0;
      let thumbs = 0;
      let favorites = 0;
      for (const r of rows) {
        originals += originalBytes(r);
        thumbs += thumbBytes(r);
        if (r.favorite) favorites += 1;
      }
      return { count: rows.length, originals, thumbs, favorites };
    },

    /**
     * The gallery's size on disk (originals plus thumbnails, as `stats` sums them) and what a
     * Gallery size limit of `limitBytes` would delete, null for no limit, from one read: the
     * Settings hint (A2) asks on every keystroke.
     * @param {number | null} limitBytes
     * @returns {Promise<{ used: number, preview: { ids: string[], count: number, bytes: number } | null }>}
     */
    async usage(limitBytes) {
      const rows = await all();
      const used = rows.reduce((sum, r) => sum + originalBytes(r) + thumbBytes(r), 0);
      return { used, preview: limitBytes === null ? null : limitPreview(rows, limitBytes) };
    },

    /**
     * Delete oldest non-favourites until the gallery fits `limitBytes` (A2, A10). Resolves to
     * the removed ids, oldest first. Its reader is TDF-0009.4's Settings flyout (accepted
     * plan, A2), as is usage's.
     * @param {number} limitBytes
     */
    enforceLimit(limitBytes) {
      return deleteOverLimit(limitBytes);
    },
  };
}

/** @typedef {ReturnType<typeof createImageStore>} ImageStore */
