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
  assert.deepEqual(await store.previewLimit(150), { ids: ['old', 'new'], count: 2, bytes: 200 });
  assert.deepEqual(await store.enforceLimit(250), ['old']);
  assert.deepEqual(await store.enforceLimit(0), ['new']);
  assert.deepEqual(await store.enforceLimit(0), []);
  assert.deepEqual((await store.list()).map((r) => r.id), ['fav']);
});

test('stats split originals and thumbnails and count favourites', async () => {
  const store = await fresh();
  await store.put(image({ id: 'a', favorite: true }));
  await store.put(image({ id: 'b' }));
  const totals = await store.stats();
  assert.deepEqual(totals, { count: 2, originals: 0, thumbs: 0, favorites: 1 });
});

test('markBroken flags the record, and every write notifies', async () => {
  const store = await fresh();
  let changes = 0;
  const off = onImagesChange(() => changes++);
  await store.put(image({ id: 'a' }));
  await store.markBroken('a');
  await store.markBroken('missing');
  off();
  assert.equal((await get(store, 'a'))?.broken, true);
  assert.equal(changes, 2);
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
