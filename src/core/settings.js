// The only reader and writer of the `settings` store (TDF-0009 Shared Contract).
// An absent key returns its default. Every committed write is announced to `onSettingChange`
// listeners, so core follows a value a feature's own connection wrote.

import { STORES, done, request } from './db.js';
import { HISTORY_ON, countFromDays, parseHistoryCount } from './retention.js';

/** The retired Chat history (days) key; migrateHistory() turns it into `historyCount`. */
const RETIRED_RETENTION_KEY = 'retentionDays';

export const DEFAULTS = Object.freeze({
  // Chat history (last HISTORY_ON, TDF-0033.5, TDF-0056): HISTORY_ON replays the newest
  // HISTORY_ON lines, 0 keeps and replays none. Read through parseHistoryCount, so nothing else
  // is ever handed on.
  historyCount: /** @type {import('./retention.js').HistoryCount} */ (HISTORY_ON),
  // The gallery's size limit in MB; null is no limit.
  galleryLimitMB: /** @type {number | null} */ (null),
  storeImagesOffline: false,
  // Whether a stored original is re-encoded as a smaller JPEG at its own dimensions (TDF-0036),
  // at capture and by a one-time backfill of those already stored.
  compressStoredImages: false,
  // Whether the gallery captures the signed-in user's own shares.
  includeMyImages: false,
  // The reaction queue's spacing; an internal tunable, with no Settings control.
  likeIntervalSeconds: 15,
  // The chosen theme; null follows the system until the first toggle.
  theme: /** @type {'light' | 'dark' | null} */ (null),
  // Whether server-history blocks arrive collapsed; ticking it collapses the open ones (TDF-0033.3).
  autoCollapseServerHistory: false,
  // Whether a shared image or a gallery tile opens in the in-chat media popover (TDF-0035)
  // rather than a new tab.
  useMediaQuickview: true,
  // The raw senders whose public messages and whispers are hidden (TDF-0082), as the messages
  // store's user index holds them. Never mutated: every write is a new array (toggleHidden).
  hiddenSenders: /** @type {readonly string[]} */ (Object.freeze([])),
});

/** @typedef {keyof typeof DEFAULTS} SettingKey */

/** @type {Set<(key: SettingKey, value: unknown) => void>} */
const listeners = new Set();

/**
 * Called after every committed `set`, through any Settings.
 * @param {(key: SettingKey, value: unknown) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @param {IDBDatabase} db */
export function createSettings(db) {
  return {
    /**
     * @template {SettingKey} K
     * @param {K} key
     * @returns {Promise<(typeof DEFAULTS)[K]>}
     */
    async get(key) {
      const t = db.transaction(STORES.settings, 'readonly');
      const row = await request(t.objectStore(STORES.settings).get(key));
      const value = row === undefined ? DEFAULTS[key] : row.value;
      return key === 'historyCount' ? /** @type {(typeof DEFAULTS)[K]} */ (parseHistoryCount(value)) : value;
    },

    /**
     * Retire a stored Chat history (days) value, once (TDF-0033.5): where `historyCount` is not
     * stored yet it becomes countFromDays(days), then `retentionDays` is deleted. One
     * transaction, so a second caller finds nothing left to do. Announces nothing: it runs
     * before the first read.
     */
    async migrateHistory() {
      const t = db.transaction(STORES.settings, 'readwrite');
      const store = t.objectStore(STORES.settings);
      // Written inside the request callbacks, so the transaction is still active.
      const old = store.get(RETIRED_RETENTION_KEY);
      old.onsuccess = () => {
        if (old.result === undefined) return;
        const current = store.get('historyCount');
        current.onsuccess = () => {
          if (current.result === undefined) store.put({ key: 'historyCount', value: countFromDays(old.result.value) });
          store.delete(RETIRED_RETENTION_KEY);
        };
      };
      await done(t);
    },

    /**
     * @template {SettingKey} K
     * @param {K} key
     * @param {(typeof DEFAULTS)[K]} value
     */
    async set(key, value) {
      if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`unknown setting: ${key}`);
      const t = db.transaction(STORES.settings, 'readwrite');
      t.objectStore(STORES.settings).put({ key, value });
      await done(t);
      for (const fn of listeners) fn(key, value);
    },
  };
}

/** @typedef {ReturnType<typeof createSettings>} Settings */

/**
 * A synchronous view of one setting, for a reader that cannot await: a click handler whose
 * `win.open` must run inside the click. Its default until the stored value is read, then that
 * value, kept current by every later committed `set`. A set heard before the read resolves
 * wins over the read.
 * @template {SettingKey} K
 * @param {Promise<Settings>} ready  its rejection is the caller's to report, as the caller's own
 *   open failure; it leaves the default
 * @param {K} key
 * @param {(err: unknown) => void} onError  the stored value could not be read; the default stays
 * @returns {() => (typeof DEFAULTS)[K]}
 */
export function followSetting(ready, key, onError) {
  /** @type {(typeof DEFAULTS)[K]} */
  let value = DEFAULTS[key];
  let heard = false;
  onSettingChange((changed, next) => {
    if (changed !== key) return;
    value = /** @type {(typeof DEFAULTS)[K]} */ (next);
    heard = true;
  });
  ready.then(
    (settings) =>
      settings.get(key).then((stored) => {
        if (!heard) value = stored;
      }, onError),
    () => {},
  );
  return () => value;
}
