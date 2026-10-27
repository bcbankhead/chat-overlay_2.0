// The only reader and writer of the `settings` store (TDF-0009 Shared Contract).
// An absent key returns its default.

import { STORES, done, request } from './db.js';

export const DEFAULTS = Object.freeze({
  historyEnabled: true,
  retentionDays: /** @type {number | null} */ (null),
  storeImagesOffline: false,
  likeEmoji: ':h',
  likeIntervalSeconds: 15,
  theme: /** @type {'auto' | 'light' | 'dark'} */ ('auto'),
});

/** @typedef {keyof typeof DEFAULTS} SettingKey */

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
    },
  };
}

/** @typedef {ReturnType<typeof createSettings>} Settings */
