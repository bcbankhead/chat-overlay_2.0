// The only reader and writer of the `settings` store (TDF-0009 Shared Contract).
// An absent key returns its default. Every committed write is announced to `onSettingChange`
// listeners, so core follows a value a feature's own connection wrote.

import { STORES, done, request } from './db.js';

export const DEFAULTS = Object.freeze({
  // Chat history kept, in days; 0 keeps none. A stored legacy null keeps everything.
  retentionDays: /** @type {number | null} */ (30),
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
  // Whether a shared image or a gallery tile opens in the in-chat media popover (TDF-0035)
  // rather than a new tab.
  useMediaQuickview: true,
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
      return row === undefined ? DEFAULTS[key] : row.value;
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
