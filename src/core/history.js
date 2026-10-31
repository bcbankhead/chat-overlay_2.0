// The `messages` store: the only chat history (the server keeps none).

import { STORES, done, request } from './db.js';
import { orderKey } from './group.js';
import { isExpired } from './reconcile.js';

/**
 * A stored message (TDF-0009 Shared Contract, `messages`).
 * @typedef {object} MessageRecord
 * @property {string} id            server id, or provisional `local-…` while pending
 * @property {string} roomID
 * @property {string} mTime
 * @property {string} user
 * @property {string} toUser
 * @property {import('./parse.js').MessageKind} kind
 * @property {string} avatar
 * @property {string} color
 * @property {string} size
 * @property {string} family
 * @property {string} text
 * @property {string} ircFlag
 * @property {string} lineBreakFlag
 * @property {number} receivedAt    first seen by any tab; a re-delivery keeps it
 * @property {number} orderKey      replay order (`group.js` orderKey), computed on write
 * @property {number} [orderAt]     a send-confirmed own message's estimated server time (ms),
 *   ordering it while it has no mTime
 * @property {'pending' | 'unconfirmed'} [confirm] absent on server records
 */

export const DEFAULT_REPLAY_LIMIT = 200;

let lastReceivedAt = 0;

/**
 * Strictly increasing receipt time, so records received in the same millisecond keep
 * their arrival order within one order key on the `roomID_orderKey` index.
 * @param {number} [now]
 */
export function nextReceivedAt(now = Date.now()) {
  lastReceivedAt = now > lastReceivedAt ? now : lastReceivedAt + 0.001;
  return lastReceivedAt;
}

/** @param {IDBDatabase} db */
export function createHistory(db) {
  /** @param {IDBTransactionMode} mode */
  const tx = (mode) => db.transaction(STORES.messages, mode);

  return {
    /**
     * The stored record with this id, if any.
     * @param {string} id
     * @returns {Promise<MessageRecord | undefined>}
     */
    async get(id) {
      return request(tx('readonly').objectStore(STORES.messages).get(id));
    },

    /**
     * Upsert on id: a re-delivered server message replaces its earlier copy, keeping that
     * copy's first-seen `receivedAt` (TDF-0031), so another tab's re-store of the server
     * backlog neither reorders replay nor extends retention. Read and write share one
     * transaction, so two tabs' writes cannot interleave between them.
     * @param {MessageRecord} record its `orderKey` is computed here
     */
    async put(record) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.messages);
      const req = store.get(record.id);
      req.onsuccess = () => {
        /** @type {MessageRecord | undefined} */
        const existing = req.result;
        const receivedAt = existing ? existing.receivedAt : record.receivedAt;
        store.put({ ...record, receivedAt, orderKey: orderKey({ mTime: record.mTime, receivedAt }) });
      };
      await done(t);
    },

    /**
     * Store an own message's local echo, before its send settles. With no mTime yet, it
     * orders by its receipt time.
     * @param {MessageRecord} record carries a provisional id
     */
    async addPending(record) {
      const t = tx('readwrite');
      t.objectStore(STORES.messages).put({ ...record, orderKey: orderKey(record), confirm: 'pending' });
      await done(t);
    },

    /**
     * Replace a pending or send-confirmed record with its confirmed form (the same id) or
     * its server copy, in one transaction. The order key is recomputed, so a server copy
     * takes its server mTime's place and a send-confirmed record its `orderAt`.
     * @param {string} pendingId
     * @param {MessageRecord} server
     */
    async confirmPending(pendingId, server) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.messages);
      store.delete(pendingId);
      const { confirm: _drop, ...record } = server;
      store.put({ ...record, orderKey: orderKey(record) });
      await done(t);
    },

    /**
     * Mark a still-pending record unconfirmed. A record already confirmed is left alone.
     * @param {string} id
     * @returns {Promise<boolean>} whether a record was marked
     */
    async markUnconfirmed(id) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.messages);
      /** @type {MessageRecord | undefined} */
      const record = await request(store.get(id));
      let marked = false;
      if (record?.confirm === 'pending') {
        store.put({ ...record, confirm: 'unconfirmed' });
        marked = true;
      }
      await done(t);
      return marked;
    },

    /**
     * Mark every pending record in the room older than the expiry unconfirmed; the rest
     * are still within their wait, for the new page to adopt.
     * @param {string} roomID
     * @param {number} [now]
     * @returns {Promise<{ expired: string[], pending: MessageRecord[] }>} the ids marked,
     *   and the records still pending
     */
    async expirePending(roomID, now = Date.now()) {
      const t = tx('readwrite');
      const index = t.objectStore(STORES.messages).index('roomID');
      /** @type {string[]} */
      const marked = [];
      /** @type {MessageRecord[]} */
      const pending = [];
      await new Promise((resolve, reject) => {
        const req = index.openCursor(IDBKeyRange.only(roomID));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(undefined);
          /** @type {MessageRecord} */
          const record = cursor.value;
          if (record.confirm === 'pending') {
            if (isExpired(record, now)) {
              cursor.update({ ...record, confirm: 'unconfirmed' });
              marked.push(record.id);
            } else {
              pending.push(record);
            }
          }
          cursor.continue();
        };
      });
      await done(t);
      return { expired: marked, pending };
    },

    /**
     * Honour an admin `DELETEMESSAGE_<mTime>`: delete the room's earliest-received record
     * with that mTime. mTime is not unique; the engine removes only the first div with that
     * id (message.js.php removeMessageDiv), so later same-second messages survive.
     * @param {string} roomID
     * @param {string} mTime
     * @returns {Promise<string[]>} the id deleted, or none
     */
    async deleteByMTime(roomID, mTime) {
      const t = tx('readwrite');
      const store = t.objectStore(STORES.messages);
      /** @type {MessageRecord | null} */
      const first = await new Promise((resolve, reject) => {
        /** @type {MessageRecord | null} */
        let earliest = null;
        const req = store.index('mTime').openCursor(IDBKeyRange.only(mTime));
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve(earliest);
          /** @type {MessageRecord} */
          const record = cursor.value;
          if (record.roomID === roomID && (!earliest || record.receivedAt < earliest.receivedAt)) {
            earliest = record;
          }
          cursor.continue();
        };
      });
      if (first) store.delete(first.id);
      await done(t);
      return first ? [first.id] : [];
    },

    /**
     * The room's most recent records by message time, oldest first; messages sharing one
     * mTime second keep their first-seen arrival order.
     * @param {string} roomID
     * @param {number} [limit]
     * @returns {Promise<MessageRecord[]>}
     */
    async recent(roomID, limit = DEFAULT_REPLAY_LIMIT) {
      const t = tx('readonly');
      const index = t.objectStore(STORES.messages).index('roomID_orderKey');
      const range = IDBKeyRange.bound([roomID, -Infinity, -Infinity], [roomID, Infinity, Infinity]);
      /** @type {MessageRecord[]} */
      const out = [];
      await new Promise((resolve, reject) => {
        const req = index.openCursor(range, 'prev');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || out.length >= limit) return resolve(undefined);
          out.push(cursor.value);
          cursor.continue();
        };
      });
      return out.reverse();
    },
  };
}

/** @typedef {ReturnType<typeof createHistory>} History */
