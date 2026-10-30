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
  // Whether the gallery captures the signed-in user's own shares.
  includeMyImages: false,
  // The reaction queue's spacing; an internal tunable, with no Settings control.
  likeIntervalSeconds: 15,
  // The chosen theme; null follows the system until the first toggle.
  theme: /** @type {'light' | 'dark' | null} */ (null),
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
