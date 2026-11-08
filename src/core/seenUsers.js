// Users this member has seen online (TDF-0075), kept in IndexedDB's `seenUsers` store as
// `{ uuID, userID, rawName, at }`, so a Recently online row can open the profile of someone who
// was online before this page load: under profileRef 2 the profile needs the forum userID, which
// entry and exit lines do not carry. The store is read once, at start, after pruning records
// older than `SEEN_TTL_MS` and then all but the newest `SEEN_CAP`; each subscriber is told once
// when it has loaded, or, subscribing after that, once on a microtask. A user is written when new, when their userID or rawName changed, or once
// their stored `at` is `SEEN_REFRESH_MS` old, so a poll that re-renders the rail writes nothing.
// `at` is when they were last seen online, which the age prune reads. A failed read or write is
// reported and leaves the lookup empty: the row's View Profile stays disabled.

import { STORES, done, isClosing, request } from './db.js';

/** How long a user not seen online again is kept. */
export const SEEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many users are kept, the most recently seen. */
export const SEEN_CAP = 500;
/** How old a stored `at` is before seeing the user online again rewrites it. */
export const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

/** @typedef {{ uuID: string, userID: string, rawName: string, at: number }} SeenRecord */
/** @typedef {{ uuID: string, userID: string, rawName: string }} SeenUser */

/**
 * @typedef {object} SeenUsers
 * @property {(uuID: string) => { userID: string, rawName: string } | undefined} get
 *   what an online row last told about this user, from this load or a stored one
 * @property {(user: SeenUser) => void} remember  note a user shown in an online row
 * @property {(fn: () => void) => () => void} subscribe  told once, when the load has finished,
 *   failed or not; subscribed after it finished, told once on a microtask unless unsubscribed
 *   first
 */

/**
 * Which stored records a load keeps and which it deletes: everything older than `ttl`, then all
 * but the newest `cap` of the rest.
 * @param {readonly SeenRecord[]} records
 * @param {number} now
 * @param {number} [ttl]
 * @param {number} [cap]
 * @returns {{ keep: SeenRecord[], drop: string[] }}
 */
export function prunePlan(records, now, ttl = SEEN_TTL_MS, cap = SEEN_CAP) {
  /** @type {string[]} */
  const drop = [];
  /** @type {SeenRecord[]} */
  const fresh = [];
  for (const r of records) {
    if (now - r.at > ttl) drop.push(r.uuID);
    else fresh.push(r);
  }
  fresh.sort((a, b) => b.at - a.at);
  for (const r of fresh.slice(cap)) drop.push(r.uuID);
  return { keep: fresh.slice(0, cap), drop };
}

/**
 * Whether seeing `user` online now should write their record.
 * @param {SeenRecord | undefined} prev  what is held for them
 * @param {SeenUser} user
 * @param {number} now
 * @param {number} [refresh]
 * @returns {boolean}
 */
export function needsWrite(prev, user, now, refresh = SEEN_REFRESH_MS) {
  if (!user.uuID || !user.userID) return false;
  if (!prev) return true;
  if (prev.userID !== user.userID || prev.rawName !== user.rawName) return true;
  return now - prev.at >= refresh;
}

/**
 * @param {{ db: IDBDatabase, now?: () => number, report?: (err: unknown) => void }} deps
 * @returns {SeenUsers}
 */
export function createSeenUsers({ db, now = Date.now, report = (err) => console.error('Seen users:', err) }) {
  /** @type {Map<string, SeenRecord>} */
  const cache = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let finished = false;

  /** @param {() => void} fn */
  function tell(fn) {
    try {
      fn();
    } catch (err) {
      report(err);
    }
  }

  async function load() {
    try {
      const tx = db.transaction(STORES.seenUsers, 'readwrite');
      const store = tx.objectStore(STORES.seenUsers);
      /** @type {SeenRecord[]} */
      const records = await request(store.getAll());
      const { keep, drop } = prunePlan(records, now());
      for (const uuID of drop) store.delete(uuID);
      await done(tx);
      // A user remembered while the load ran is newer than what was stored.
      for (const r of keep) if (!cache.has(r.uuID)) cache.set(r.uuID, r);
    } catch (err) {
      if (!isClosing(err)) report(err);
    }
    finished = true;
    for (const fn of listeners) tell(fn);
  }

  /** @param {SeenRecord} record */
  async function store(record) {
    try {
      const tx = db.transaction(STORES.seenUsers, 'readwrite');
      tx.objectStore(STORES.seenUsers).put(record);
      await done(tx);
    } catch (err) {
      // Kept in memory for this page load either way; not retried, so a broken store is
      // reported once per user rather than once per render.
      if (!isClosing(err)) report(err);
    }
  }

  // After this returns, so a subscriber added at once still hears a load that fails at once.
  void Promise.resolve().then(load);

  return {
    get(uuID) {
      const r = cache.get(uuID);
      return r ? { userID: r.userID, rawName: r.rawName } : undefined;
    },
    remember(user) {
      const at = now();
      if (!needsWrite(cache.get(user.uuID), user, at)) return;
      const record = { uuID: user.uuID, userID: user.userID, rawName: user.rawName, at };
      cache.set(record.uuID, record);
      void store(record);
    },
    subscribe(fn) {
      if (finished) {
        let live = true;
        void Promise.resolve().then(() => {
          if (live) tell(fn);
        });
        return () => {
          live = false;
        };
      }
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
