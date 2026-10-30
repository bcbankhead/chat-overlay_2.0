// The `tags` store, kept as a derivation of the room's stored messages, and its only writer:
// every change re-derives the room's tags and replaces its rows, so purging history and
// re-deriving cannot disagree. Core's announcements (a message in, messages deleted, a pending
// one unconfirmed) keep the snapshot in step; those that arrive while a rebuild reads are
// held, then applied over the read in order. A like from someone else that arrives live is
// announced (onLike), so the view can animate it; nothing replayed by a rebuild, or held
// during one, is.

import { STORES, done, request } from '../../core/db.js';
import { countLikes, deriveTags } from './infer.js';

/** @typedef {import('../../core/history.js').MessageRecord} MessageRecord */
/** @typedef {import('./infer.js').Tag} Tag */

/**
 * @param {string} imageId
 * @param {string} sender
 */
const likeKey = (imageId, sender) => `${imageId}
${sender}`;

/**
 * @param {Tag[]} a
 * @param {Tag[]} b
 */
const sameTags = (a, b) =>
  a.length === b.length &&
  a.every(
    (t, i) =>
      t.imageId === b[i].imageId &&
      t.code === b[i].code &&
      t.sender === b[i].sender &&
      t.roomID === b[i].roomID &&
      t.sourceMessageId === b[i].sourceMessageId &&
      t.certain === b[i].certain,
  );

/**
 * @param {{
 *   db: IDBDatabase,
 *   history: import('../../core/history.js').History,
 *   roomID: string,
 *   me: string,
 *   codes: readonly string[],
 * }} deps
 */
export function createTagStore({ db, history, roomID, me, codes }) {
  /** @type {MessageRecord[]} */
  let messages = [];
  /** @type {Tag[]} */
  let tags = [];
  /** @type {Array<() => void> | null} snapshot changes held during a rebuild's read; null otherwise */
  let early = [];
  /** @type {Promise<void>} writes, in order */
  let writes = Promise.resolve();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Set<(imageId: string, sender: string) => void>} */
  const likeListeners = new Set();

  const changed = () => {
    for (const fn of listeners) fn();
  };

  /** @param {MessageRecord} record */
  const upsert = (record) => {
    const i = messages.findIndex((m) => m.id === record.id);
    if (i >= 0) messages[i] = record;
    else messages.push(record);
  };

  /** @param {Iterable<string>} ids */
  const drop = (ids) => {
    const gone = new Set(ids);
    messages = messages.filter((m) => !gone.has(m.id));
  };

  /** @param {Iterable<string>} ids */
  const unconfirm = (ids) => {
    const marked = new Set(ids);
    messages = messages.map((m) => (marked.has(m.id) ? { ...m, confirm: /** @type {const} */ ('unconfirmed') } : m));
  };

  /**
   * Re-derive from the snapshot; rewrite and re-render only when the tags changed, unless
   * `prune` asks for a rewrite that also clears other rooms' orphaned rows.
   * @param {boolean} prune
   */
  const rederive = (prune) => {
    const next = deriveTags(messages, me, codes);
    const same = sameTags(next, tags);
    // Most messages are neither images nor reactions: no rewrite, no re-render for those.
    if (same && !prune) return Promise.resolve();
    tags = next;
    if (!same) changed();
    return persist(tags, prune);
  };

  /**
   * Apply a change to the snapshot now, or hold it while a rebuild reads.
   * @param {() => void} change
   * @param {boolean} prune
   */
  const apply = (change, prune) => {
    if (early) {
      early.push(change);
      return Promise.resolve();
    }
    change();
    return rederive(prune);
  };

  /**
   * Replace the room's rows with `next`. With `prune`, also delete other rooms' rows whose
   * source message is gone (A4).
   * @param {Tag[]} next
   * @param {boolean} prune
   */
  const persist = (next, prune) => {
    const write = async () => {
      const t = db.transaction([STORES.tags, STORES.messages], 'readwrite');
      const store = t.objectStore(STORES.tags);
      const sources = t.objectStore(STORES.messages);
      /** @type {Array<Tag & { id: number }>} */
      const rows = await request(store.getAll());
      for (const row of rows) {
        if (row.roomID === roomID) store.delete(row.id);
        else if (prune && (await request(sources.getKey(row.sourceMessageId))) === undefined) store.delete(row.id);
      }
      for (const tag of next) store.add({ ...tag });
      await done(t);
    };
    writes = writes.then(write, write);
    return writes;
  };

  return {
    /**
     * Re-derive the room from every stored message. Runs at startup.
     * @returns {Promise<void>}
     */
    async rebuildRoom() {
      // Changes during the read are held, or the read's older snapshot would undo them.
      early ??= [];
      const stored = await history.recent(roomID, Infinity);
      messages = stored;
      for (const change of early ?? []) change();
      early = null;
      tags = deriveTags(messages, me, codes);
      changed();
      await persist(tags, true);
    },

    /**
     * A stored message arrived (core's onInbound).
     * @param {MessageRecord} record
     * @returns {Promise<void>}
     */
    applyInbound(record) {
      if (record.roomID !== roomID) return Promise.resolve();
      // A held message is replayed by the rebuild, which announces nothing.
      if (early) return apply(() => upsert(record), false);
      const liked = new Set(tags.map((t) => likeKey(t.imageId, t.sender)));
      const written = apply(() => upsert(record), false);
      /** @type {Set<string>} */
      const announced = new Set();
      for (const t of tags) {
        const key = likeKey(t.imageId, t.sender);
        if (t.sender === me || t.sourceMessageId !== record.id || liked.has(key) || announced.has(key)) continue;
        announced.add(key);
        for (const fn of likeListeners) fn(t.imageId, t.sender);
      }
      return written;
    },

    /**
     * Stored messages were deleted, from any room (core's onDeleted): a Storage limit or an
     * admin delete. Rewrites with `prune`, so other rooms' rows left by them go too.
     * @param {string[]} ids
     * @returns {Promise<void>}
     */
    applyDeleted(ids) {
      if (!ids.length) return Promise.resolve();
      return apply(() => drop(ids), true);
    },

    /**
     * Pending messages became unconfirmed (core's onConfirmChange): they count for nothing.
     * @param {import('../../core/events.js').ConfirmChange} change
     * @returns {Promise<void>}
     */
    applyConfirmChange({ roomID: room, ids }) {
      if (room !== roomID) return Promise.resolve();
      return apply(() => unconfirm(ids), false);
    },

    /**
     * The image's likes: distinct senders across every smilie.
     * @param {string} imageId
     */
    likesFor(imageId) {
      return countLikes(tags, imageId);
    },

    /**
     * Someone else's first reaction to an image arrived live (never from a rebuild, for a
     * message held before the first one, or for your own).
     * @param {(imageId: string, sender: string) => void} fn
     * @returns {() => void} unsubscribe
     */
    onLike(fn) {
      likeListeners.add(fn);
      return () => likeListeners.delete(fn);
    },

    /**
     * @param {() => void} fn
     * @returns {() => void} unsubscribe
     */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
