// The history and gallery limits of Settings, applied: chat history pruned by the fixed storage
// age over the `messages` receivedAt index (all of it with Chat history off) or cleared
// outright; and the gallery kept under its size by TDF-0009.5's store. Deleted lines are announced through core's onDeleted, so the open view drops their rows
// and tagging, the tags store's only writer, re-derives without them. No deletion here touches
// images or tags. Limits run on load and on commit; Clear history runs when the user confirms it.
// Hide messages by user is a filter over the hiddenSenders setting and deletes nothing here.

import { createBlockState } from '../../core/blockState.js';
import { STORES, done, request } from '../../core/db.js';
import { describeError } from '../../core/errors.js';
import { emitDeleted } from '../../core/events.js';
import { megabytesToBytes, storageCutoff } from './selectors.js';

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
  const blockState = createBlockState(db);

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
    /** @type {Set<string>} server-history blocks a deleted line belonged to */
    const touched = new Set();
    await new Promise((resolve, reject) => {
      const req = source.openCursor(range);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(undefined);
        ids.push(/** @type {string} */ (cursor.primaryKey));
        const block = cursor.value?.backlogBlock;
        if (block) touched.add(block);
        cursor.delete();
        cursor.continue();
      };
    });
    await done(t);
    if (ids.length) emitDeleted(ids);
    try {
      await forgetBlocks(range === null ? null : touched);
    } catch (err) {
      // The lines are gone and announced; say so, so the failure is not read as theirs.
      throw new Error(`lines deleted, but their server-history block state was not cleared: ${describeError(err)}`);
    }
    return ids;
  };

  /**
   * Drop the stored collapsed state of blocks with no line left (TDF-0033.2): every block after
   * Clear history (null), else those of `touched` no stored line still carries. A deletion that
   * touched no block line reads nothing more.
   * @param {Set<string> | null} touched
   */
  const forgetBlocks = async (touched) => {
    if (touched === null) return blockState.clear();
    if (!touched.size) return;
    const left = new Set(touched);
    const t = db.transaction(STORES.messages, 'readonly');
    await new Promise((resolve, reject) => {
      const req = t.objectStore(STORES.messages).openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || !left.size) return resolve(undefined);
        const block = cursor.value?.backlogBlock;
        if (block) left.delete(block);
        cursor.continue();
      };
    });
    await blockState.prune(left);
  };

  return {
    /**
     * Delete the stored lines the Chat history setting `count` does not keep, in one
     * transaction: those older than STORAGE_AGE_DAYS, or every line when it is off (0). Then
     * announce them, so they leave the open view and their tags.
     * @param {import('../../core/retention.js').HistoryCount} count
     * @returns {Promise<string[]>} the ids deleted
     */
    async pruneHistory(count) {
      const cutoff = storageCutoff(count, now());
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
