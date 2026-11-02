// Deleting stored chat history lines, shared by the core's load-time bound and the Options
// feature's limits (features/options/limits.js). Every deletion runs in one transaction over the
// `messages` store and is then announced through onDeleted, so an open view drops the rows and
// tagging re-derives without them; the server-history block state no line carries any more is
// then forgotten. No deletion here touches images or tags.

import { createBlockState } from './blockState.js';
import { STORES, done } from './db.js';
import { describeError } from './errors.js';
import { emitDeleted } from './events.js';
import { storageLines } from './retention.js';

/** @param {IDBDatabase} db */
export function createHistoryDelete(db) {
  const blockState = createBlockState(db);

  /**
   * Walk the cursor `open` makes over the messages store and delete each line `remove` picks, in
   * one transaction; then announce them, so they leave the open view and their tags, and forget
   * the block state no line carries any more (every block's when `all`).
   * @param {(store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>} open
   * @param {(record: any) => boolean} remove  read once per line, in cursor order
   * @param {boolean} all  every line goes
   * @returns {Promise<string[]>} the ids deleted
   */
  const deleteMatching = async (open, remove, all) => {
    const t = db.transaction(STORES.messages, 'readwrite');
    /** @type {string[]} */
    const ids = [];
    /** @type {Set<string>} server-history blocks a deleted line belonged to */
    const touched = new Set();
    await new Promise((resolve, reject) => {
      const req = open(t.objectStore(STORES.messages));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(undefined);
        if (remove(cursor.value)) {
          ids.push(/** @type {string} */ (cursor.primaryKey));
          const block = cursor.value?.backlogBlock;
          if (block) touched.add(block);
          cursor.delete();
        }
        cursor.continue();
      };
    });
    await done(t);
    if (ids.length) emitDeleted(ids);
    try {
      await forgetBlocks(all ? null : touched);
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

  /**
   * Delete the lines in `range` of `indexName` (every line when null) in one transaction; then
   * announce them.
   * @param {string | null} indexName
   * @param {IDBKeyRange | null} range
   * @returns {Promise<string[]>} the ids deleted
   */
  const deleteWhere = (indexName, range) =>
    deleteMatching(
      (store) => (indexName === null ? store : store.index(indexName)).openCursor(range),
      () => true,
      range === null,
    );

  return {
    deleteWhere,

    /**
     * Delete the stored lines the Chat history setting `count` does not keep, in one
     * transaction: every line of each room past its newest STORAGE_LINES by orderKey (own and
     * pending lines count), or every line when it is off (0). Then announce them, so they leave
     * the open view and their tags.
     * @param {import('./retention.js').HistoryCount} count
     * @returns {Promise<string[]>} the ids deleted
     */
    pruneHistory(count) {
      const keep = storageLines(count);
      if (keep === 0) return deleteWhere(null, null);
      /** @type {Map<string, number>} lines seen so far per room, newest first */
      const seen = new Map();
      return deleteMatching(
        (store) => store.index('roomID_orderKey').openCursor(null, 'prev'),
        (record) => {
          const n = (seen.get(record.roomID) ?? 0) + 1;
          seen.set(record.roomID, n);
          return n > keep;
        },
        false,
      );
    },
  };
}
