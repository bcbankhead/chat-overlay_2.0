// Forum profile pictures (TDF-0013), looked up for every user shown, a picked chat avatar or
// not, since the forum picture is preferred wherever one exists (TDF-0021). The answer, a picture
// or none, is kept in IndexedDB's `avatars` store however many messages the user sends.
// A stored picture never expires (TDF-0069): the profile page is login-gated, so a member logged
// out of the forum gets no fresh answer, and the last known picture is kept. Once a stored answer
// is `AVATAR_TTL_MS` old, a stored picture is still answered at once and refreshed in the
// background, and a stored 'no picture' is refreshed before answering; only a lookup that
// succeeds writes, so a failed one never replaces what is stored. A failed lookup is kept for
// this page load only, so the next load tries again. At most `MAX_CONCURRENT` (2) profile
// fetches are in flight, refreshes included, and a name is looked up at most once per page load.
// A caller that knows the forum user id passes it (the rail, the flyout); otherwise the profile
// is looked up by name.

import { STORES, done, isClosing, request } from './db.js';
import { parseProfileAvatar, profileUrlFor } from './forumAvatar.js';

/** How old a stored answer is before it is refreshed; it is never discarded for its age. */
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

/** @typedef {{ name: string, url: string | null, at: number }} AvatarRecord */
/** @typedef {AvatarRecord & { stale: boolean }} StoredAnswer */

/** A lookup that failed the expected way: offline, an error status, a page that is not a profile. */
export class AvatarLookupFailed extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AvatarLookupFailed';
  }
}

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

  /**
   * The stored answer for `name`, of any age; `stale` once it is `AVATAR_TTL_MS` old.
   * @param {string} name
   * @returns {Promise<StoredAnswer | undefined>}
   */
  async function stored(name) {
    try {
      /** @type {AvatarRecord | undefined} */
      const record = await request(db.transaction(STORES.avatars).objectStore(STORES.avatars).get(name));
      return record ? { ...record, stale: now() - record.at >= AVATAR_TTL_MS } : undefined;
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
   * Fetch and read one profile page.
   * @param {string} page
   * @returns {Promise<string | null>} the picture URL, or null for a profile with none
   */
  async function fetchProfile(page) {
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
    return url;
  }

  /**
   * The answer for `name`, and the profile page to refresh it from once it has settled, if any.
   * @param {string} name
   * @param {string} userID
   * @returns {Promise<{ url: string | null, refresh: string | null }>}
   */
  async function lookup(name, userID) {
    const hit = await stored(name);
    if (hit && !hit.stale) return { url: hit.url, refresh: null };
    const page = profileUrlFor(win.profileUrl, win.location.href, { userID, name });
    // A stale picture is answered now and refreshed after it settles; a stale 'no picture' is
    // fetched before answering, since a failure answers null either way.
    if (hit?.url) return { url: hit.url, refresh: page };
    if (!page) return { url: null, refresh: null };
    const url = await fetchProfile(page);
    await store(name, url);
    return { url, refresh: null };
  }

  /**
   * Refresh a stale stored picture in the background. Only a successful lookup writes: a new
   * picture replaces it, no picture clears it, and a failed lookup leaves it and its age alone.
   * @param {string} name
   * @param {string} page
   */
  function revalidate(name, page) {
    fetchProfile(page)
      .then(async (url) => {
        settled.set(name, url);
        known.set(name, Promise.resolve(url));
        await store(name, url);
      })
      .catch((err) => {
        // Expected and harmless: a refresh that fails the expected way (signed out of the
        // forum, offline) leaves the stored picture showing, and the next page load tries
        // again. Anything else is a fault, reported.
        if (!(err instanceof AvatarLookupFailed)) report(err);
      });
  }

  return {
    resolve(name, userID = '') {
      let answer = known.get(name);
      if (!answer) {
        // Expected and harmless: a profile that will not load or parse (offline, signed out,
        // no such user) leaves whatever is already showing: the picked chat avatar, or the
        // initials tile when there is none (TDF-0013). It answers null for the rest of this
        // page load and is never stored. Anything else is a fault, reported, and still leaves
        // what is showing. A stale stored picture is refreshed only after this answer settles,
        // so the refresh's answer is the one `peek` and later resolves are left with.
        answer = lookup(name, userID)
          .catch((err) => {
            if (!(err instanceof AvatarLookupFailed)) report(err);
            return { url: null, refresh: null };
          })
          .then(({ url, refresh }) => {
            settled.set(name, url);
            if (refresh) revalidate(name, refresh);
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
