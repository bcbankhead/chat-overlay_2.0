// The Storage limits, applied: chat history pruned by age over the `messages` receivedAt index,
// and the gallery kept under its size by TDF-0009.5's store. Pruned lines are announced through
// core's onDeleted, so the open view drops their rows and tagging, the tags store's only
// writer, re-derives without them. Runs on load and on commit only.

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
      const t = db.transaction(STORES.messages, 'readwrite');
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
      await done(t);
      if (ids.length) emitDeleted(ids);
      return ids;
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
