// The Storage section, applied: chat history pruned by age over the `messages` receivedAt index,
// cleared outright, or deleted by sender over the user index; and the gallery kept under its
// size by TDF-0009.5's store. Deleted lines are announced through core's onDeleted, so the open
// view drops their rows and tagging, the tags store's only writer, re-derives without them. No
// deletion here touches images or tags. Limits run on load and on commit; Clear history and
// delete-by-sender run when the user confirms them.

import { STORES, done, request } from '../../core/db.js';
import { emitDeleted } from '../../core/events.js';
import { historyCutoff, megabytesToBytes } from './selectors.js';

/**
 * The gallery store's size-limit surface (TDF-0009.5, `src/features/gallery/store.js`). It
 * selects what goes — oldest non-favorites first — and refuses favorites in storage.
 * @typedef {object} GalleryLimit
 * @property {(bytes: number | null) => Promise<{
 *   used: number,
 *   preview: { ids: string[], count: number, bytes: number } | null,
 * }>} usage  size on disk, and what a limit would delete, in one read
 * @property {(bytes: number) => Promise<string[]>} enforceLimit  the removed image ids
 */

/**
 * @param {{ db: IDBDatabase, gallery: GalleryLimit, now?: () => number }} deps
 */
export function createLimits({ db, gallery, now = Date.now }) {
  /**
   * Delete the lines in `range` of `indexName` (every line when null) in one transaction; then
   * announce them, so they leave the open view and their tags.
   * @param {string | null} indexName
   * @param {IDBKeyRange | null} range
   * @returns {Promise<string[]>} the ids deleted
   */
  const deleteWhere = async (indexName, range) => {
    const t = db.transaction(STORES.messages, 'readwrite');
    const store = t.objectStore(STORES.messages);
    const source = indexName === null ? store : store.index(indexName);
    /** @type {string[]} */
    const ids = [];
    await new Promise((resolve, reject) => {
      const req = source.openCursor(range);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(undefined);
        ids.push(/** @type {string} */ (cursor.primaryKey));
        cursor.delete();
        cursor.continue();
      };
    });
    await done(t);
    if (ids.length) emitDeleted(ids);
    return ids;
  };

  return {
    /**
     * How many stored lines `days` would delete.
     * @param {number | null} days
     */
    async previewHistory(days) {
      const cutoff = historyCutoff(days, now());
      if (cutoff === null) return 0;
      const t = db.transaction(STORES.messages, 'readonly');
      const index = t.objectStore(STORES.messages).index('receivedAt');
      return request(index.count(IDBKeyRange.upperBound(cutoff, true)));
    },

    /**
     * Delete stored lines older than `days` in one transaction; then announce them, so they
     * leave the open view and their tags.
     * @param {number | null} days
     * @returns {Promise<string[]>} the ids deleted
     */
    async pruneHistory(days) {
      const cutoff = historyCutoff(days, now());
      if (cutoff === null) return [];
      return deleteWhere('receivedAt', IDBKeyRange.upperBound(cutoff, true));
    },

    /** How many lines are stored, in every room. */
    async countAll() {
      return request(db.transaction(STORES.messages, 'readonly').objectStore(STORES.messages).count());
    },

    /**
     * Delete every stored line, in every room, in one transaction; then announce them.
     * @returns {Promise<string[]>} the ids deleted
     */
    async clearHistory() {
      return deleteWhere(null, null);
    },

    /**
     * Every sender in stored history, online or not, with their line count, in index order.
     * @returns {Promise<Array<{ user: string, count: number }>>}
     */
    async senders() {
      const index = db.transaction(STORES.messages, 'readonly').objectStore(STORES.messages).index('user');
      /** @type {Array<{ user: string, count: number }>} */
      const out = [];
      await new Promise((resolve, reject) => {
        const req = index.openKeyCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(undefined);
          const user = /** @type {string} */ (cursor.key);
          const last = out[out.length - 1];
          if (last && last.user === user) last.count++;
          else out.push({ user, count: 1 });
          cursor.continue();
        };
      });
      return out;
    },

    /**
     * How many stored lines `user` sent, in every room.
     * @param {string} user  the stored (raw) sender
     */
    async countByUser(user) {
      const index = db.transaction(STORES.messages, 'readonly').objectStore(STORES.messages).index('user');
      return request(index.count(IDBKeyRange.only(user)));
    },

    /**
     * Delete every stored line `user` sent, in every room, in one transaction; then announce them.
     * @param {string} user  the stored (raw) sender
     * @returns {Promise<string[]>} the ids deleted
     */
    async deleteByUser(user) {
      return deleteWhere('user', IDBKeyRange.only(user));
    },

    /**
     * The gallery's size on disk, and what a limit of `mb` would delete (null when there is
     * no limit), from one read.
     * @param {number | null} mb
     */
    async previewGallery(mb) {
      return gallery.usage(mb === null ? null : megabytesToBytes(mb));
    },

    /**
     * Keep the gallery at or under `mb`. Tags stay: they derive from messages, not images.
     * @param {number | null} mb
     * @returns {Promise<string[]>} the image ids removed
     */
    async pruneGallery(mb) {
      if (mb === null) return [];
      return gallery.enforceLimit(megabytesToBytes(mb));
    },
  };
}

/** @typedef {ReturnType<typeof createLimits>} Limits */
