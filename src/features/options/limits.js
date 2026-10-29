// The Storage limits, applied: chat history pruned by age over the `messages` receivedAt index,
// the gallery kept under its size by TDF-0009.5's store, and the tags of whatever went
// removed with it. Pruned lines also leave the open view. Runs on load and on commit only.

import { STORES, done, request } from '../../core/db.js';
import { historyCutoff, megabytesToBytes, tagsToDelete } from './selectors.js';

/**
 * The gallery store's size-limit surface (TDF-0009.5, `src/features/gallery/store.js`). It
 * selects what goes — oldest non-favorites first — and refuses favorites in storage.
 * @typedef {object} GalleryLimit
 * @property {(bytes: number) => Promise<{ ids: string[], count: number, bytes: number }>} previewLimit
 * @property {(bytes: number) => Promise<string[]>} enforceLimit  the removed image ids
 */

/**
 * @param {{ db: IDBDatabase, doc: Document, gallery: GalleryLimit, now?: () => number }} deps
 */
export function createLimits({ db, doc, gallery, now = Date.now }) {
  /**
   * Ids of the messages `days` would delete, oldest first.
   * @param {number | null} days
   * @returns {Promise<string[]>}
   */
  async function expired(days) {
    const cutoff = historyCutoff(days, now());
    if (cutoff === null) return [];
    const t = db.transaction(STORES.messages, 'readonly');
    const index = t.objectStore(STORES.messages).index('receivedAt');
    /** @type {string[]} */
    const ids = [];
    await new Promise((resolve, reject) => {
      const req = index.openKeyCursor(IDBKeyRange.upperBound(cutoff, true));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(undefined);
        ids.push(/** @type {string} */ (cursor.primaryKey));
        cursor.continue();
      };
    });
    return ids;
  }

  /**
   * Delete the tags left pointing at removed records, in an open readwrite transaction.
   * @param {IDBTransaction} t
   * @param {string[]} messageIds
   * @param {string[]} imageIds
   */
  async function deleteTags(t, messageIds, imageIds) {
    const store = t.objectStore(STORES.tags);
    const tags = await request(store.getAll());
    for (const id of tagsToDelete(tags, messageIds, imageIds)) store.delete(id);
  }

  /** @param {string[]} ids */
  function removeRows(ids) {
    const gone = new Set(ids);
    for (const el of doc.querySelectorAll('#tdf-chat .tdf-msg[data-id]')) {
      const id = /** @type {HTMLElement} */ (el).dataset.id;
      if (id !== undefined && gone.has(id)) el.remove();
    }
  }

  return {
    /**
     * How many stored lines `days` would delete.
     * @param {number | null} days
     */
    async previewHistory(days) {
      return (await expired(days)).length;
    },

    /**
     * Delete stored lines older than `days`, with their tags, in one transaction; then drop
     * them from the open view.
     * @param {number | null} days
     * @returns {Promise<string[]>} the ids deleted
     */
    async pruneHistory(days) {
      const cutoff = historyCutoff(days, now());
      if (cutoff === null) return [];
      const t = db.transaction([STORES.messages, STORES.tags], 'readwrite');
      const index = t.objectStore(STORES.messages).index('receivedAt');
      /** @type {string[]} */
      const ids = [];
      await new Promise((resolve, reject) => {
        const req = index.openCursor(IDBKeyRange.upperBound(cutoff, true));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(undefined);
          ids.push(/** @type {string} */ (cursor.primaryKey));
          cursor.delete();
          cursor.continue();
        };
      });
      if (ids.length) await deleteTags(t, ids, []);
      await done(t);
      removeRows(ids);
      return ids;
    },

    /**
     * What a limit of `mb` would delete; null when there is no limit.
     * @param {number | null} mb
     */
    async previewGallery(mb) {
      if (mb === null) return null;
      return gallery.previewLimit(megabytesToBytes(mb));
    },

    /**
     * Keep the gallery at or under `mb`, then delete the removed images' tags.
     * @param {number | null} mb
     * @returns {Promise<string[]>} the image ids removed
     */
    async pruneGallery(mb) {
      if (mb === null) return [];
      const ids = await gallery.enforceLimit(megabytesToBytes(mb));
      if (!ids.length) return ids;
      const t = db.transaction(STORES.tags, 'readwrite');
      await deleteTags(t, [], ids);
      await done(t);
      return ids;
    },
  };
}

/** @typedef {ReturnType<typeof createLimits>} Limits */
