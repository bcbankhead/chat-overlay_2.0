// The history and gallery limits of Settings, applied: chat history pruned to each room's newest
// STORAGE_LINES lines (all of it with Chat history off) or cleared outright, through core's
// historyDelete.js, which announces each deletion so the open view drops the rows and tagging,
// the tags store's only writer, re-derives without them; and the gallery kept under its size by
// TDF-0009.5's store. No deletion here touches images or tags. Only bootstrap bounds stored
// history, on load, before replay reads; the gallery limit runs on load and on commit; Clear
// history runs when the user confirms it. Hide messages by user is a filter over the
// hiddenSenders setting and deletes nothing here.

import { STORES, request } from '../../core/db.js';
import { createHistoryDelete } from '../../core/historyDelete.js';
import { megabytesToBytes } from './selectors.js';

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
 * @param {{ db: IDBDatabase, gallery: GalleryLimit }} deps
 */
export function createLimits({ db, gallery }) {
  const { deleteWhere } = createHistoryDelete(db);

  return {
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
