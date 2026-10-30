import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { openDb } from '../../core/db.js';
import { FavoriteProtectedError, createImageStore, onImagesChange } from './store.js';

let n = 0;
/** @param {import('./store.js').ImageStore} store @param {string} id */
const get = async (store, id) => (await store.list()).find((r) => r.id === id);
const fresh = async () => createImageStore(await openDb({ name: `gallery-store-${++n}` }));

/** @param {Partial<import('./store.js').ImageRecord>} over */
const image = (over = {}) => ({
  id: '100000000000001',
  messageId: '1',
  user: 'alice',
  mTime: '100',
  roomID: '1',
  receivedAt: 1,
  contentType: 'image/png',
  thumb: null,
  bytes: 100,
  favorite: false,
  broken: false,
  ...over,
});

test('a favourite is refused by remove, inside the store, and stays stored', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', favorite: true }));
  await assert.rejects(store.remove('a'), FavoriteProtectedError);
  assert.equal(await store.has('a'), true);
  await store.setFavorite('a', false);
  await store.remove('a');
  assert.equal(await store.has('a'), false);
});

test('put keeps the first capture of an id', async () => {
  const store = await fresh();
  assert.equal(await store.put(image({ id: 'a' })), true);
  await store.setFavorite('a', true);
  assert.equal(await store.put(image({ id: 'a', user: 'bob' })), false);
  const row = await get(store, 'a');
  assert.equal(row?.user, 'alice');
  assert.equal(row?.favorite, true);
});

test('list is newest first; listByUser filters to the sender', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', receivedAt: 1 }));
  await store.put(image({ id: 'b', receivedAt: 3, user: 'bob' }));
  await store.put(image({ id: 'c', receivedAt: 2 }));
  assert.deepEqual((await store.list()).map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual((await store.listByUser('alice')).map((r) => r.id), ['c', 'a']);
});

test('the size limit never deletes a favourite; enforceLimit resolves to the removed ids', async () => {
  const store = await fresh();
  await store.put(image({ id: 'fav', receivedAt: 1, favorite: true }));
  await store.put(image({ id: 'old', receivedAt: 2 }));
  await store.put(image({ id: 'new', receivedAt: 3 }));
  assert.deepEqual((await store.usage(150)).preview, { ids: ['old', 'new'], count: 2, bytes: 200 });
  assert.deepEqual(await store.enforceLimit(250), ['old']);
  assert.deepEqual(await store.enforceLimit(0), ['new']);
  assert.deepEqual(await store.enforceLimit(0), []);
  assert.deepEqual((await store.list()).map((r) => r.id), ['fav']);
});

test('stats split originals and thumbnails and count favourites', async () => {
  const store = await fresh();
  const bytes = (/** @type {number} */ size) => new Blob([new Uint8Array(size)]);
  await store.put(image({ id: 'a', favorite: true, blob: bytes(1000), thumb: bytes(30) }));
  await store.put(image({ id: 'b', thumb: bytes(20) }));
  await store.put(image({ id: 'c' }));
  const totals = await store.stats();
  assert.deepEqual(totals, { count: 3, originals: 1000, thumbs: 50, favorites: 1 });
});

test('usage reads size on disk and the limit preview together, in one read', async () => {
  const db = await openDb({ name: `gallery-store-${++n}` });
  const store = createImageStore(db);
  const bytes = (/** @type {number} */ size) => new Blob([new Uint8Array(size)]);
  await store.put(image({ id: 'old', receivedAt: 1, blob: bytes(1000), thumb: bytes(30) }));
  await store.put(image({ id: 'new', receivedAt: 2, thumb: bytes(20) }));
  const proto = Object.getPrototypeOf(db.transaction('images', 'readonly').objectStore('images'));
  const getAll = proto.getAll;
  let reads = 0;
  proto.getAll = function (...args) {
    reads += 1;
    return getAll.apply(this, args);
  };
  try {
    assert.deepEqual(await store.usage(150), { used: 1050, preview: { ids: ['old'], count: 1, bytes: 100 } });
    assert.deepEqual(await store.usage(null), { used: 1050, preview: null });
  } finally {
    proto.getAll = getAll;
  }
  assert.equal(reads, 2);
});

test('markBroken flags the record, and every write notifies', async () => {
  const store = await fresh();
  let changes = 0;
  const off = onImagesChange(() => changes++);
  await store.put(image({ id: 'a' }));
  await store.markBroken('a', 'HTTP 404');
  await store.markBroken('missing', 'HTTP 404');
  off();
  assert.equal((await get(store, 'a'))?.broken, true);
  assert.equal((await get(store, 'a'))?.brokenReason, 'HTTP 404');
  assert.equal(changes, 2);
});

test('repair clears the broken state and its reason, merges new fields, and keeps a favourite', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', broken: true, brokenReason: 'HTTP 503', favorite: true, thumb: null, bytes: 0 }));
  const thumb = new Blob([new Uint8Array(40)]);
  await store.repair('a', { thumb, bytes: 40, contentType: 'image/jpeg' });
  await store.repair('missing');
  const row = await store.get('a');
  assert.equal(row?.broken, false);
  assert.equal('brokenReason' in (row ?? {}), false);
  assert.equal(row?.favorite, true);
  assert.equal(row?.thumb?.size, 40);
  assert.equal(row?.bytes, 40);
  assert.equal(row?.contentType, 'image/jpeg');
  assert.equal(await store.get('missing'), undefined);
});

test('removing an id that is not stored changes nothing and does not notify', async () => {
  const store = await fresh();
  let changes = 0;
  const off = onImagesChange(() => changes++);
  await store.remove('missing');
  await store.setFavorite('missing', true);
  off();
  assert.equal(changes, 0);
  assert.equal((await store.list()).length, 0);
});

test('a failing change listener is recorded for the flyout, and the others still run', async () => {
  const { listGalleryErrors, clearGalleryErrors } = await import('./errors.js');
  const store = await fresh();
  const logged = console.error;
  console.error = () => {};
  let ran = false;
  const offBad = onImagesChange(() => {
    throw new Error('listener broke');
  });
  const offGood = onImagesChange(() => {
    ran = true;
  });
  try {
    await store.put(image({ id: 'a' }));
  } finally {
    offBad();
    offGood();
    console.error = logged;
  }
  assert.equal(ran, true);
  assert.deepEqual(listGalleryErrors(), ['listener broke']);
  clearGalleryErrors();
});

test('put refuses bytes already stored under another id; findByHash finds them', async () => {
  const store = await fresh();
  assert.equal(await store.put(image({ id: 'a', hash: 'h1' })), true);
  assert.equal(await store.put(image({ id: 'b', hash: 'h1' })), false);
  assert.equal(await store.put(image({ id: 'c', hash: 'h2' })), true);
  // A record without a hash (broken, or a failed hash) never collides.
  assert.equal(await store.put(image({ id: 'd' })), true);
  assert.equal(await store.put(image({ id: 'e' })), true);
  assert.deepEqual((await store.list()).map((r) => r.id).sort(), ['a', 'c', 'd', 'e']);
  assert.equal((await store.findByHash('h1'))?.id, 'a');
  assert.equal(await store.findByHash('none'), undefined);
});

test('markBroken drops the hash, so the same bytes under a new id are stored', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', hash: 'h1' }));
  await store.markBroken('a', 'HTTP 404');
  assert.equal('hash' in ((await store.get('a')) ?? {}), false);
  assert.equal(await store.findByHash('h1'), undefined);
  assert.equal(await store.put(image({ id: 'b', hash: 'h1' })), true);
});

test('repair stores the hash a retry computed', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', broken: true, brokenReason: 'HTTP 404' }));
  await store.repair('a', { hash: 'h1' });
  assert.equal((await store.findByHash('h1'))?.id, 'a');
});
