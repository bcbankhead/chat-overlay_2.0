import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_VERSION, SUPERSEDED, openDb } from '../src/core/db.js';
import { createHistory } from '../src/core/history.js';
import { PENDING_TTL_MS } from '../src/core/reconcile.js';
import { DEFAULTS, createSettings, onSettingChange } from '../src/core/settings.js';

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

test('opens at version 4 with every store and index', async () => {
  const db = await fresh();
  assert.equal(db.version, DB_VERSION);
  assert.equal(DB_VERSION, 4);
  assert.deepEqual([...db.objectStoreNames].sort(), ['avatars', 'images', 'messages', 'settings', 'tags']);
  assert.equal(db.transaction('avatars').objectStore('avatars').keyPath, 'name');
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

/**
 * The version 1 schema, as TDF-0009.1 created it.
 * @param {string} name
 */
const openV1 = (name) => {
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
  return /** @type {Promise<IDBDatabase>} */ (settled(open));
};

test('a version 1 database upgrades to the current version with its records intact and a hash index', async () => {
  const name = `test-v1-${++n}`;
  const v1 = await openV1(name);
  const w = v1.transaction(['messages', 'settings', 'images', 'tags'], 'readwrite');
  w.objectStore('messages').put(msg({ id: 'm1' }));
  w.objectStore('messages').put(msg({ id: 'w1', toUser: '_', kind: 'whisper' }));
  w.objectStore('settings').put({ key: 'theme', value: 'dark' });
  w.objectStore('images').put({ id: 'img1', user: 'alice', receivedAt: 1, favorite: true });
  w.objectStore('tags').put({ imageId: 'img1', tag: ':h', sourceMessageId: 'm1' });
  await settled(w);
  v1.close();

  const db = await openDb({ name });
  assert.equal(db.version, DB_VERSION);
  const t = db.transaction(['messages', 'settings', 'images', 'tags'], 'readonly');
  const images = t.objectStore('images');
  assert.deepEqual([...images.indexNames].sort(), ['hash', 'receivedAt', 'user']);
  assert.equal((await settled(t.objectStore('messages').get('m1'))).text, 'hi');
  assert.equal((await settled(t.objectStore('messages').get('w1'))).kind, 'public');
  assert.equal((await settled(t.objectStore('settings').get('theme'))).value, 'dark');
  assert.equal((await settled(images.get('img1'))).favorite, true);
  assert.equal((await settled(t.objectStore('tags').getAll())).length, 1);
  // A record from before the upgrade has no hash, so the index does not hold it.
  assert.equal(await settled(images.index('hash').count()), 0);
  db.close();
});

test('a version 2 database upgrades to the current version, reclassifying placeholder whispers as public', async () => {
  const name = `test-v2-${++n}`;
  // The version 2 schema: version 1 plus the images hash index (TDF-0009.13).
  const open = indexedDB.open(name, 2);
  open.onupgradeneeded = () => {
    const v2 = open.result;
    const messages = v2.createObjectStore('messages', { keyPath: 'id' });
    for (const i of ['roomID', 'mTime', 'user', 'receivedAt']) messages.createIndex(i, i);
    messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
    v2.createObjectStore('settings', { keyPath: 'key' });
    const images = v2.createObjectStore('images', { keyPath: 'id' });
    for (const i of ['user', 'receivedAt', 'hash']) images.createIndex(i, i);
    const tags = v2.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
    tags.createIndex('imageId', 'imageId');
    tags.createIndex('sourceMessageId', 'sourceMessageId');
  };
  const v2 = /** @type {IDBDatabase} */ (await settled(open));
  const w = v2.transaction('messages', 'readwrite');
  const seed = [
    msg({ id: 'underscore', toUser: '_', kind: 'whisper' }),
    msg({ id: 'empty', toUser: '', kind: 'whisper' }),
    msg({ id: 'named', toUser: 'bob', kind: 'whisper' }),
    msg({ id: 'echo', toUser: '', kind: 'whisper', ircFlag: '1', text: ' &#187; bob: psst' }),
    msg({ id: 'public', toUser: '', kind: 'public' }),
    msg({ id: 'entry', toUser: '_', kind: 'entry', avatar: '1' }),
  ];
  for (const record of seed) w.objectStore('messages').put(record);
  await settled(w);
  v2.close();

  const db = await openDb({ name });
  assert.equal(db.version, DB_VERSION);
  const kinds = Object.fromEntries(
    (await settled(db.transaction('messages').objectStore('messages').getAll())).map((r) => [r.id, r.kind]),
  );
  assert.deepEqual(kinds, {
    underscore: 'public',
    empty: 'public',
    named: 'whisper',
    echo: 'whisper',
    public: 'public',
    entry: 'entry',
  });
  assert.equal((await stored(db, 'underscore')).text, 'hi');
  db.close();
});

test('a version 3 database upgrades to version 4, adding the avatars store and keeping every record', async () => {
  const name = `test-v3-${++n}`;
  // The version 3 schema: the same stores and indexes as version 2 (TDF-0012 migrated data only).
  const open = indexedDB.open(name, 3);
  open.onupgradeneeded = () => {
    const v3 = open.result;
    const messages = v3.createObjectStore('messages', { keyPath: 'id' });
    for (const i of ['roomID', 'mTime', 'user', 'receivedAt']) messages.createIndex(i, i);
    messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
    v3.createObjectStore('settings', { keyPath: 'key' });
    const images = v3.createObjectStore('images', { keyPath: 'id' });
    for (const i of ['user', 'receivedAt', 'hash']) images.createIndex(i, i);
    const tags = v3.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
    tags.createIndex('imageId', 'imageId');
    tags.createIndex('sourceMessageId', 'sourceMessageId');
  };
  const v3 = /** @type {IDBDatabase} */ (await settled(open));
  const w = v3.transaction(['messages', 'settings', 'images', 'tags'], 'readwrite');
  w.objectStore('messages').put(msg({ id: 'm', kind: 'whisper', toUser: '_' }));
  w.objectStore('settings').put({ key: 'theme', value: 'dark' });
  w.objectStore('images').put({ id: 'i', user: 'bob', receivedAt: 1, hash: 'h' });
  w.objectStore('tags').put({ imageId: 'i', sourceMessageId: 'm', tag: 'x' });
  await settled(w);
  v3.close();

  const db = await openDb({ name });
  assert.equal(db.version, 4);
  assert.ok(db.objectStoreNames.contains('avatars'));
  const r = db.transaction(['messages', 'settings', 'images', 'tags']);
  // Version 4 migrates no data: the version 3 rewrite is not run again.
  assert.equal((await settled(r.objectStore('messages').get('m'))).kind, 'whisper');
  assert.equal((await settled(r.objectStore('settings').get('theme'))).value, 'dark');
  assert.equal((await settled(r.objectStore('images').get('i'))).hash, 'h');
  assert.equal((await settled(r.objectStore('tags').getAll())).length, 1);
  db.close();
});

test('an open connection closes itself when a later version opens, so the bump is not blocked', async () => {
  const name = `test-bump-${++n}`;
  const db = await openDb({ name });
  const next = indexedDB.open(name, DB_VERSION + 1);
  let blocked = false;
  next.onblocked = () => {
    blocked = true;
  };
  const bumped = /** @type {IDBDatabase} */ (await settled(next));
  assert.equal(blocked, false);
  assert.equal(bumped.version, DB_VERSION + 1);
  bumped.close();
  db.close();
});

test('onVersionChange is called once, after the connection has closed', async () => {
  const name = `test-bump-notify-${++n}`;
  let calls = 0;
  let closed = false;
  const db = await openDb({
    name,
    onVersionChange: () => {
      calls += 1;
      try {
        db.transaction('messages');
      } catch (err) {
        closed = err.name === 'InvalidStateError';
      }
    },
  });
  const bumped = /** @type {IDBDatabase} */ (await settled(indexedDB.open(name, DB_VERSION + 1)));
  assert.equal(calls, 1);
  assert.equal(closed, true);
  bumped.close();
  const again = /** @type {IDBDatabase} */ (await settled(indexedDB.open(name, DB_VERSION + 2)));
  assert.equal(calls, 1);
  again.close();
});

test('a blocked open keeps waiting and resolves once the blocker closes', async () => {
  const name = `test-wait-${++n}`;
  // An older build's connection, which does not close itself on versionchange.
  const v1 = await openV1(name);
  let settledYet = false;
  const opening = openDb({ name }).then((db) => {
    settledYet = true;
    return db;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settledYet, false);
  v1.close();
  const db = await opening;
  assert.equal(db.version, DB_VERSION);
  db.close();
});

test('onBlocked is called once when a blocked open begins waiting, and the open still resolves', async () => {
  const name = `test-onblocked-${++n}`;
  const v1 = await openV1(name);
  let calls = 0;
  const opening = openDb({ name, onBlocked: () => (calls += 1) });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  v1.close();
  const db = await opening;
  assert.equal(db.version, DB_VERSION);
  assert.equal(calls, 1);
  db.close();
});

test('an open that is not blocked never calls onBlocked', async () => {
  let calls = 0;
  const db = await openDb({ name: `test-unblocked-${++n}`, onBlocked: () => (calls += 1) });
  assert.equal(calls, 0);
  db.close();
});

test('a connection closed by a later version fails every later write with one explanation', async () => {
  const name = `test-superseded-${++n}`;
  const db = await openDb({ name });
  const h = createHistory(db);
  const bumped = /** @type {IDBDatabase} */ (await settled(indexedDB.open(name, DB_VERSION + 1)));
  const errors = [];
  for (const id of ['a', 'b', 'c']) await h.put(msg({ id })).catch((err) => errors.push(err.message));
  assert.equal(errors.length, 3);
  assert.deepEqual(new Set(errors), new Set([SUPERSEDED]));
  await assert.rejects(createSettings(db).get('theme'), { message: SUPERSEDED });
  bumped.close();
});

test('a stored whisper with no text survives the upgrade', async () => {
  const name = `test-textless-${++n}`;
  const open = indexedDB.open(name, 2);
  open.onupgradeneeded = () => {
    const v2 = open.result;
    const messages = v2.createObjectStore('messages', { keyPath: 'id' });
    for (const i of ['roomID', 'mTime', 'user', 'receivedAt']) messages.createIndex(i, i);
    messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
    v2.createObjectStore('settings', { keyPath: 'key' });
    const images = v2.createObjectStore('images', { keyPath: 'id' });
    for (const i of ['user', 'receivedAt', 'hash']) images.createIndex(i, i);
    const tags = v2.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
    tags.createIndex('imageId', 'imageId');
    tags.createIndex('sourceMessageId', 'sourceMessageId');
  };
  const v2 = /** @type {IDBDatabase} */ (await settled(open));
  const { text: _, ...textless } = msg({ id: 'textless', kind: 'whisper', ircFlag: '1' });
  const w = v2.transaction('messages', 'readwrite');
  w.objectStore('messages').put(textless);
  await settled(w);
  v2.close();

  const db = await openDb({ name });
  assert.equal(db.version, DB_VERSION);
  const record = await stored(db, 'textless');
  assert.equal(record.kind, 'public');
  assert.equal('text' in record, false);
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

test('get returns the stored record by id, or undefined', async () => {
  const h = createHistory(await fresh());
  await h.put(msg({ id: 's1', text: 'hi' }));
  assert.equal((await h.get('s1'))?.text, 'hi');
  assert.equal(await h.get('missing'), undefined);
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
  // Another room's pending record, and records already settled, are not this room's scan.
  await h.addPending(msg({ id: 'local-room2', roomID: '2', receivedAt: now - PENDING_TTL_MS - 1 }));
  await h.put(msg({ id: 'local-gone', confirm: 'unconfirmed', receivedAt: now - PENDING_TTL_MS - 1 }));
  const { expired, pending } = await h.expirePending('1', now);
  assert.deepEqual(expired, ['local-old']);
  // A pending record still within its wait is handed back for the new page to adopt.
  assert.deepEqual(
    pending.map((r) => r.id),
    ['local-new'],
  );
  assert.equal((await stored(db, 'local-old')).confirm, 'unconfirmed');
  assert.equal((await stored(db, 'local-new')).confirm, 'pending');
  assert.equal((await stored(db, 'local-room2')).confirm, 'pending');
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
  assert.equal(await s.get('retentionDays'), 30);
  assert.equal(await s.get('galleryLimitMB'), null);
  assert.equal(await s.get('storeImagesOffline'), false);
  assert.equal(await s.get('includeMyImages'), false);
  assert.equal(await s.get('likeIntervalSeconds'), 15);
  assert.equal(await s.get('theme'), null);
  await s.set('theme', 'dark');
  assert.equal(await s.get('theme'), 'dark');
  await assert.rejects(s.set('nope', 1), /unknown setting/);
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.ok(!Object.hasOwn(DEFAULTS, 'historyEnabled') && !Object.hasOwn(DEFAULTS, 'likeEmoji'));
});

test('a committed set is announced to setting-change listeners, through any Settings', async () => {
  const db = await fresh();
  const seen = [];
  const off = onSettingChange((key, value) => seen.push([key, value]));
  await createSettings(db).set('retentionDays', 0);
  await createSettings(db).set('theme', 'light');
  off();
  await createSettings(db).set('theme', 'dark');
  assert.deepEqual(seen, [['retentionDays', 0], ['theme', 'light']]);
});
