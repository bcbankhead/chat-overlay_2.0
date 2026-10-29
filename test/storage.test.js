import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_VERSION, openDb } from '../src/core/db.js';
import { createHistory } from '../src/core/history.js';
import { PENDING_TTL_MS } from '../src/core/reconcile.js';
import { DEFAULTS, createSettings } from '../src/core/settings.js';

let n = 0;
const fresh = () => openDb({ name: `test-${++n}` });

/** Read one stored message directly, as the store holds it. */
const stored = (db, id) =>
  new Promise((resolve, reject) => {
    const req = db.transaction('messages').objectStore('messages').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const msg = (over) => ({
  id: '1',
  roomID: '1',
  mTime: '100',
  user: 'alice',
  toUser: '',
  kind: 'public',
  avatar: 'a.gif',
  color: '#000',
  size: '12px',
  family: 'verdana',
  text: 'hi',
  ircFlag: '0',
  lineBreakFlag: '0',
  receivedAt: 1,
  ...over,
});

test('opens at version 2 with every store and index', async () => {
  const db = await fresh();
  assert.equal(db.version, DB_VERSION);
  assert.equal(DB_VERSION, 2);
  assert.deepEqual([...db.objectStoreNames].sort(), ['images', 'messages', 'settings', 'tags']);
  const t = db.transaction(['messages', 'images', 'tags'], 'readonly');
  const messages = t.objectStore('messages');
  assert.equal(messages.keyPath, 'id');
  assert.deepEqual([...messages.indexNames].sort(), [
    'mTime',
    'receivedAt',
    'roomID',
    'roomID_receivedAt',
    'user',
  ]);
  assert.deepEqual(messages.index('roomID_receivedAt').keyPath, ['roomID', 'receivedAt']);
  assert.deepEqual([...t.objectStore('images').indexNames].sort(), ['hash', 'receivedAt', 'user']);
  assert.deepEqual([...t.objectStore('tags').indexNames].sort(), ['imageId', 'sourceMessageId']);
  db.close();
});

/** @param {IDBRequest | IDBTransaction} r */
const settled = (r) =>
  new Promise((resolve, reject) => {
    if ('oncomplete' in r) {
      r.oncomplete = () => resolve(undefined);
      r.onerror = () => reject(r.error);
    } else {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }
  });

test('a version 1 database upgrades to version 2 with its records intact and a hash index', async () => {
  const name = `test-v1-${++n}`;
  // The version 1 schema, as TDF-0009.1 created it.
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    const v1 = open.result;
    const messages = v1.createObjectStore('messages', { keyPath: 'id' });
    for (const i of ['roomID', 'mTime', 'user', 'receivedAt']) messages.createIndex(i, i);
    messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
    v1.createObjectStore('settings', { keyPath: 'key' });
    const images = v1.createObjectStore('images', { keyPath: 'id' });
    images.createIndex('user', 'user');
    images.createIndex('receivedAt', 'receivedAt');
    const tags = v1.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
    tags.createIndex('imageId', 'imageId');
    tags.createIndex('sourceMessageId', 'sourceMessageId');
  };
  const v1 = /** @type {IDBDatabase} */ (await settled(open));
  const w = v1.transaction(['messages', 'settings', 'images', 'tags'], 'readwrite');
  w.objectStore('messages').put(msg({ id: 'm1' }));
  w.objectStore('settings').put({ key: 'theme', value: 'dark' });
  w.objectStore('images').put({ id: 'img1', user: 'alice', receivedAt: 1, favorite: true });
  w.objectStore('tags').put({ imageId: 'img1', tag: ':h', sourceMessageId: 'm1' });
  await settled(w);
  v1.close();

  const db = await openDb({ name });
  assert.equal(db.version, 2);
  const t = db.transaction(['messages', 'settings', 'images', 'tags'], 'readonly');
  const images = t.objectStore('images');
  assert.deepEqual([...images.indexNames].sort(), ['hash', 'receivedAt', 'user']);
  assert.equal((await settled(t.objectStore('messages').get('m1'))).text, 'hi');
  assert.equal((await settled(t.objectStore('settings').get('theme'))).value, 'dark');
  assert.equal((await settled(images.get('img1'))).favorite, true);
  assert.equal((await settled(t.objectStore('tags').getAll())).length, 1);
  // A record from before the upgrade has no hash, so the index does not hold it.
  assert.equal(await settled(images.index('hash').count()), 0);
  db.close();
});

test('put upserts on the server id', async () => {
  const h = createHistory(await fresh());
  await h.put(msg({ text: 'first' }));
  await h.put(msg({ text: 'again' }));
  const all = await h.recent('1');
  assert.equal(all.length, 1);
  assert.equal(all[0].text, 'again');
});

test('recent returns the room only, oldest first, limited', async () => {
  const h = createHistory(await fresh());
  for (let i = 1; i <= 5; i++) await h.put(msg({ id: `s${i}`, receivedAt: i }));
  await h.put(msg({ id: 'other', roomID: '2', receivedAt: 10 }));
  assert.deepEqual(
    (await h.recent('1', 3)).map((r) => r.id),
    ['s3', 's4', 's5'],
  );
  assert.deepEqual(
    (await h.recent('2')).map((r) => r.id),
    ['other'],
  );
});

test('a pending echo is swapped for its server copy', async () => {
  const db = await fresh();
  const h = createHistory(db);
  await h.addPending(msg({ id: 'local-5-0', mTime: '', receivedAt: 5 }));
  assert.equal((await stored(db, 'local-5-0')).confirm, 'pending');
  await h.confirmPending('local-5-0', msg({ id: '77', mTime: '200', receivedAt: 5 }));
  assert.equal(await stored(db, 'local-5-0'), undefined);
  assert.equal((await stored(db, '77')).confirm, undefined);
  assert.deepEqual(
    (await h.recent('1')).map((r) => r.id),
    ['77'],
  );
});

test('unconfirmed after 60 s: markUnconfirmed and expirePending', async () => {
  const db = await fresh();
  const h = createHistory(db);
  const now = 1_000_000;
  await h.addPending(msg({ id: 'local-old', receivedAt: now - PENDING_TTL_MS - 1 }));
  await h.addPending(msg({ id: 'local-new', receivedAt: now - 1000 }));
  const { expired, pending } = await h.expirePending('1', now);
  assert.deepEqual(expired, ['local-old']);
  // A pending record still within its wait is handed back for the new page to adopt.
  assert.deepEqual(
    pending.map((r) => r.id),
    ['local-new'],
  );
  assert.equal((await stored(db, 'local-old')).confirm, 'unconfirmed');
  assert.equal((await stored(db, 'local-new')).confirm, 'pending');
  assert.equal(await h.markUnconfirmed('local-new'), true);
  assert.equal((await stored(db, 'local-new')).confirm, 'unconfirmed');
  await h.put(msg({ id: 'server' }));
  assert.equal(await h.markUnconfirmed('server'), false);
});

test('deleteByMTime removes only the room\'s earliest-received record with that mTime', async () => {
  const h = createHistory(await fresh());
  // Ids sort opposite to receipt, so the choice is by receivedAt, not key order.
  await h.put(msg({ id: 'z', mTime: '100', receivedAt: 1 }));
  await h.put(msg({ id: 'b', mTime: '100', receivedAt: 2 }));
  await h.put(msg({ id: 'c', mTime: '101', receivedAt: 3 }));
  await h.put(msg({ id: 'd', mTime: '100', roomID: '2' }));
  assert.deepEqual(await h.deleteByMTime('1', '100'), ['z']);
  assert.deepEqual(
    (await h.recent('1')).map((r) => r.id),
    ['b', 'c'],
  );
  assert.deepEqual(await h.deleteByMTime('1', '999'), []);
  assert.deepEqual(
    (await h.recent('2')).map((r) => r.id),
    ['d'],
  );
});

test('settings return the contract defaults for absent keys', async () => {
  const s = createSettings(await fresh());
  assert.equal(await s.get('historyEnabled'), true);
  assert.equal(await s.get('retentionDays'), 30);
  assert.equal(await s.get('galleryLimitMB'), null);
  assert.equal(await s.get('storeImagesOffline'), false);
  assert.equal(await s.get('includeMyImages'), false);
  assert.equal(await s.get('likeEmoji'), ':h');
  assert.equal(await s.get('likeIntervalSeconds'), 15);
  assert.equal(await s.get('theme'), null);
  await s.set('theme', 'dark');
  assert.equal(await s.get('theme'), 'dark');
  await assert.rejects(s.set('nope', 1), /unknown setting/);
  assert.ok(Object.isFrozen(DEFAULTS));
});
