// Forum profile pictures for users with no chat avatar (TDF-0013). One lookup per user: the
// answer, a picture or none, is kept in IndexedDB's `avatars` store for a day, so a user is
// fetched at most once a day however many messages they send. A failed lookup is kept for
// this page load only, so the next load tries again. A caller that knows the forum user id
// passes it (the rail, the flyout); otherwise the profile is looked up by name.

import { STORES, done, request } from './db.js';
import { parseProfileAvatar, profileUrlFor } from './forumAvatar.js';

/** How long a stored answer is used before the profile is fetched again. */
export const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
/** Profile fetches in flight at once. */
export const MAX_CONCURRENT = 2;

/**
 * @typedef {object} AvatarResolver
 * @property {(name: string, userID?: string) => Promise<string | null>} resolve
 *   the forum picture URL for a decoded user name, or null for none or a failed lookup
 * @property {(name: string) => string | null | undefined} peek
 *   the answer `resolve` has already settled on for this page load, or undefined if none yet
 */

/** A lookup that failed the expected way: offline, an error status, a page that is not a profile. */
export class AvatarLookupFailed extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AvatarLookupFailed';
  }
}

/** @param {unknown} err */
const isClosing = (err) => /** @type {{ name?: unknown } | null} */ (err)?.name === 'InvalidStateError';

/**
 * @param {{
 *   win: Window & { profileUrl?: unknown },
 *   db: IDBDatabase,
 *   now?: () => number,
 *   fetch?: typeof globalThis.fetch,
 *   report?: (err: unknown) => void,
 * }} deps `report` receives failures other than an expected failed lookup
 * @returns {AvatarResolver}
 */
export function createAvatarResolver({
  win,
  db,
  now = Date.now,
  fetch = win.fetch.bind(win),
  report = (err) => console.error('Avatars:', err),
}) {
  /** @type {Map<string, Promise<string | null>>} one answer per name for this page load */
  const known = new Map();
  /** @type {Map<string, string | null>} the answers in `known` that have settled */
  const settled = new Map();
  /** @type {(() => void)[]} */
  const queue = [];
  let running = 0;

  /**
   * Run `job` once a fetch slot is free.
   * @template T
   * @param {() => Promise<T>} job
   * @returns {Promise<T>}
   */
  function limited(job) {
    return new Promise((resolve, reject) => {
      const start = () => {
        running += 1;
        job()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            queue.shift()?.();
          });
      };
      if (running < MAX_CONCURRENT) start();
      else queue.push(start);
    });
  }

  /** @param {string} name */
  async function stored(name) {
    try {
      const record = await request(db.transaction(STORES.avatars).objectStore(STORES.avatars).get(name));
      return record && now() - record.at < AVATAR_TTL_MS ? record : undefined;
    } catch (err) {
      // Expected when the database is closing; harmless, the profile is fetched instead.
      if (!isClosing(err)) report(err);
      return undefined;
    }
  }

  /**
   * @param {string} name
   * @param {string | null} url
   */
  async function store(name, url) {
    try {
      const tx = db.transaction(STORES.avatars, 'readwrite');
      tx.objectStore(STORES.avatars).put({ name, url, at: now() });
      await done(tx);
    } catch (err) {
      // Expected when the database is closing; the answer is still used for this page load.
      if (!isClosing(err)) report(err);
    }
  }

  /**
   * @param {string} name
   * @param {string} userID
   * @returns {Promise<string | null>}
   */
  async function lookup(name, userID) {
    const hit = await stored(name);
    if (hit) return hit.url;
    const page = profileUrlFor(win.profileUrl, win.location.href, { userID, name });
    if (!page) return null;
    const url = await limited(async () => {
      /** @type {Response} */
      let res;
      /** @type {string} */
      let html;
      try {
        res = await fetch(page, { credentials: 'same-origin' });
        if (!res.ok) throw new AvatarLookupFailed(`profile fetch answered ${res.status}`);
        html = await res.text();
      } catch (err) {
        if (err instanceof AvatarLookupFailed) throw err;
        throw new AvatarLookupFailed('the profile could not be fetched', err);
      }
      const doc = new win.DOMParser().parseFromString(html, 'text/html');
      return parseProfileAvatar(doc, res.url || page);
    });
    if (url === undefined) throw new AvatarLookupFailed('the profile page was not recognised');
    await store(name, url);
    return url;
  }

  return {
    resolve(name, userID = '') {
      let answer = known.get(name);
      if (!answer) {
        // Expected and harmless: a profile that will not load or parse (offline, signed out,
        // no such user) leaves the initials tile showing, which is the designed fallback
        // (TDF-0013). It answers null for the rest of this page load and is never stored.
        // Anything else is a fault, reported, and still leaves the tile.
        answer = lookup(name, userID)
          .catch((err) => {
            if (!(err instanceof AvatarLookupFailed)) report(err);
            return null;
          })
          .then((url) => {
            settled.set(name, url);
            return url;
          });
        known.set(name, answer);
      }
      return answer;
    },
    peek(name) {
      return settled.get(name);
    },
  };
}
