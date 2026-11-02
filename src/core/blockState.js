// Each server-history block's collapsed state (TDF-0033.2): one `settings` row, keyed
// `serverHistoryBlocks`, holding `{ [blockId]: collapsed }`. It is not a member setting, so it
// is not in settings.js DEFAULTS; this module reads and writes the row itself. Every write is a
// read-modify-write in one transaction, so two tabs toggling different blocks keep both.

import { STORES, done, request } from './db.js';

export const BLOCK_STATE_KEY = 'serverHistoryBlocks';

/** @typedef {Record<string, boolean>} BlockStates true = collapsed */

/** @param {IDBDatabase} db */
export function createBlockState(db) {
  /**
   * Rewrite the map in one readwrite transaction.
   * @param {(states: BlockStates) => BlockStates} change
   */
  const update = async (change) => {
    const t = db.transaction(STORES.settings, 'readwrite');
    const store = t.objectStore(STORES.settings);
    const req = store.get(BLOCK_STATE_KEY);
    req.onsuccess = () => {
      const current = /** @type {BlockStates} */ (req.result?.value ?? {});
      store.put({ key: BLOCK_STATE_KEY, value: change({ ...current }) });
    };
    await done(t);
  };

  return {
    /** @returns {Promise<BlockStates>} every stored block's state */
    async load() {
      const t = db.transaction(STORES.settings, 'readonly');
      const row = await request(t.objectStore(STORES.settings).get(BLOCK_STATE_KEY));
      return { ...(row?.value ?? {}) };
    },

    /**
     * @param {string} id
     * @param {boolean} collapsed
     */
    async set(id, collapsed) {
      await update((states) => ({ ...states, [id]: collapsed }));
    },

    /**
     * Forget these blocks: their last stored record was deleted.
     * @param {Iterable<string>} ids
     */
    async prune(ids) {
      const gone = new Set(ids);
      if (!gone.size) return;
      await update((states) => Object.fromEntries(Object.entries(states).filter(([id]) => !gone.has(id))));
    },

    /** Forget every block: Clear history deleted every record. */
    async clear() {
      const t = db.transaction(STORES.settings, 'readwrite');
      t.objectStore(STORES.settings).delete(BLOCK_STATE_KEY);
      await done(t);
    },
  };
}

/** @typedef {ReturnType<typeof createBlockState>} BlockState */
