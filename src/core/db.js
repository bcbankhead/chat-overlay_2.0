// The one IndexedDB database (TDF-0009 Shared Contract). Every store and index is created
// here; no slice bumps the version without amending the contract. Version 1 created every
// store; version 2 (TDF-0009.13) adds the images `hash` index, with no data migration:
// records captured before it carry no hash, and the index skips them. Version 3 (TDF-0012)
// reclassifies stored messages: a `whisper` record whose only whisper signal was the `_`
// placeholder toUser is rewritten `public`. Nothing is deleted.

import { MAIN_DIV, isWhisper } from './parse.js';

export const DB_NAME = 'tdf-chat-2';
export const DB_VERSION = 3;

export const STORES = Object.freeze({
  messages: 'messages',
  settings: 'settings',
  images: 'images',
  tags: 'tags',
});

/** @param {IDBDatabase} db */
function createSchema(db) {
  const messages = db.createObjectStore(STORES.messages, { keyPath: 'id' });
  messages.createIndex('roomID', 'roomID');
  messages.createIndex('mTime', 'mTime');
  messages.createIndex('user', 'user');
  messages.createIndex('receivedAt', 'receivedAt');
  messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);

  db.createObjectStore(STORES.settings, { keyPath: 'key' });

  const images = db.createObjectStore(STORES.images, { keyPath: 'id' });
  images.createIndex('user', 'user');
  images.createIndex('receivedAt', 'receivedAt');
  images.createIndex('hash', 'hash');

  const tags = db.createObjectStore(STORES.tags, { keyPath: 'id', autoIncrement: true });
  tags.createIndex('imageId', 'imageId');
  tags.createIndex('sourceMessageId', 'sourceMessageId');
}

/**
 * Rewrite stored whispers the narrowed rule no longer counts as whispers (version 3). Only
 * `whisper` records are touched: the rule only narrowed. MAIN_DIV is assumed because the
 * old toUser branch already required it.
 * @param {IDBObjectStore} messages
 */
function reclassifyWhispers(messages) {
  const cursorReq = messages.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const record = cursor.value;
    if (record.kind === 'whisper' && !isWhisper({ targetDiv: MAIN_DIV, toUser: record.toUser, body: record })) {
      cursor.update({ ...record, kind: 'public' });
    }
    cursor.continue();
  };
}

/**
 * Open (creating on first use) the database. The connection closes itself when a newer
 * version asks to upgrade, and `onVersionChange` is then called once, after the close, as
 * every later use of the connection fails. An open blocked by an older connection waits for
 * it to close.
 * @param {{ indexedDB?: IDBFactory, name?: string, onVersionChange?: () => void }} [options]
 * @returns {Promise<IDBDatabase>}
 */
export function openDb({ indexedDB = globalThis.indexedDB, name = DB_NAME, onVersionChange } = {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    let blocked = false;
    req.onupgradeneeded = (event) => {
      const { oldVersion } = event;
      // A fresh database gets the current schema and has nothing to migrate.
      if (oldVersion < 1) {
        createSchema(req.result);
        return;
      }
      const tx = req.transaction;
      if (!tx) return;
      if (oldVersion < 2) tx.objectStore(STORES.images).createIndex('hash', 'hash');
      if (oldVersion < 3) reclassifyWhispers(tx.objectStore(STORES.messages));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        onVersionChange?.();
      };
      resolve(db);
    };
    req.onerror = () => {
      const reason = req.error ?? new Error(`${name} failed to open`);
      reject(
        blocked
          ? new Error(`${name} was blocked by another open connection: ${reason}`, { cause: reason })
          : reason,
      );
    };
    req.onblocked = () => {
      blocked = true;
    };
  });
}

/**
 * Promise wrapper for an IDBRequest.
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Resolves when a transaction commits.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}
