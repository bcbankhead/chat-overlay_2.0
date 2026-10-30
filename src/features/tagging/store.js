// The `tags` store, kept as a derivation of the room's stored messages: every change
// re-derives the room's tags and replaces its rows, so purging history and re-deriving cannot
// disagree. Messages that arrive before the first rebuild finishes are held, then merged.
// A like from someone else that arrives live is announced (onLike), so the view can animate it;
// nothing replayed by a rebuild, or held before the first one, is.

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
  /** @type {MessageRecord[] | null} inbound held until the first rebuild; null once loaded */
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
     * Re-derive the room from every stored message. Runs at startup, and after a reaction
     * fails, since its echo is then marked unconfirmed with no inbound event.
     * @returns {Promise<void>}
     */
    async rebuildRoom() {
      // Inbound during the read is held, or the read's older snapshot would drop it.
      early ??= [];
      const stored = await history.recent(roomID, Infinity);
      messages = stored;
      for (const record of early ?? []) upsert(record);
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
      if (early) {
        early.push(record);
        return Promise.resolve();
      }
      upsert(record);
      const next = deriveTags(messages, me, codes);
      // Most messages are neither images nor reactions: no rewrite, no re-render for those.
      if (sameTags(next, tags)) return Promise.resolve();
      const liked = new Set(tags.map((t) => likeKey(t.imageId, t.sender)));
      tags = next;
      changed();
      /** @type {Set<string>} */
      const announced = new Set();
      for (const t of next) {
        const key = likeKey(t.imageId, t.sender);
        if (t.sender === me || t.sourceMessageId !== record.id || liked.has(key) || announced.has(key)) continue;
        announced.add(key);
        for (const fn of likeListeners) fn(t.imageId, t.sender);
      }
      return persist(tags, false);
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
