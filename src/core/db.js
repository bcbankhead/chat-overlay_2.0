// The one IndexedDB database (TDF-0009 Shared Contract). Every store and index is created
// here; no slice bumps the version without amending the contract. Version 1 created every
// store; version 2 (TDF-0009.13) adds the images `hash` index, with no data migration:
// records captured before it carry no hash, and the index skips them.

export const DB_NAME = 'tdf-chat-2';
export const DB_VERSION = 2;

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
 * Open (creating on first use) the database.
 * @param {{ indexedDB?: IDBFactory, name?: string }} [options]
 * @returns {Promise<IDBDatabase>}
 */
export function openDb({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) createSchema(req.result);
      else if (event.oldVersion < 2) req.transaction?.objectStore(STORES.images).createIndex('hash', 'hash');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`${name} is blocked by another open connection`));
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
