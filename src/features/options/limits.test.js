import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { createLimits } from './limits.js';
import { DAY_MS, MB_BYTES } from './selectors.js';

const NOW = 100 * DAY_MS;
let n = 0;

/** @param {IDBDatabase} db @param {string} store @param {object[]} rows */
const seed = (db, store, rows) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    for (const row of rows) t.objectStore(store).put(row);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });

/** @param {IDBDatabase} db @param {string} store */
const all = (db, store) =>
  new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const msg = (id, ageDays) => ({ id, roomID: '1', mTime: id, user: 'a', receivedAt: NOW - ageDays * DAY_MS });

async function setup({ gallery = fakeGallery([]) } = {}) {
  const db = await openDb({ name: `limits-${++n}` });
  await seed(db, 'messages', [msg('old', 3), msg('day', 1.5), msg('new', 0.5)]);
  await seed(db, 'tags', [
    { sourceMessageId: 'old', imageId: 'i-old' },
    { sourceMessageId: 'new' },
    { imageId: 'i-old' },
    { imageId: 'i-new' },
  ]);
  const { document: doc } = new Window();
  doc.body.innerHTML =
    '<div id="tdf-chat"><div class="tdf-list">' +
    ['old', 'day', 'new'].map((id) => `<div class="tdf-msg" data-id="${id}"></div>`).join('') +
    '</div></div>';
  const limits = createLimits({ db, doc: /** @type {any} */ (doc), gallery, now: () => NOW });
  return { db, doc, limits };
}

/** Stands in for TDF-0009.5's store: removes the listed ids when over any limit. */
function fakeGallery(removes) {
  const calls = [];
  return {
    calls,
    async previewLimit(bytes) {
      calls.push(['preview', bytes]);
      return { ids: removes, count: removes.length, bytes: removes.length * 10 };
    },
    async enforceLimit(bytes) {
      calls.push(['enforce', bytes]);
      return removes;
    },
  };
}

const rows = (doc) => [...doc.querySelectorAll('.tdf-msg')].map((el) => el.dataset.id);

test('previewHistory counts without deleting', async () => {
  const { db, limits } = await setup();
  assert.equal(await limits.previewHistory(1), 2);
  assert.equal(await limits.previewHistory(2), 1);
  assert.equal(await limits.previewHistory(0), 3);
  assert.equal(await limits.previewHistory(null), 0);
  assert.equal((await all(db, 'messages')).length, 3);
});

test('pruneHistory deletes older lines, their tags and their rows; newer records stay', async () => {
  const { db, doc, limits } = await setup();
  assert.deepEqual(await limits.pruneHistory(1), ['old', 'day']);
  assert.deepEqual((await all(db, 'messages')).map((m) => m.id), ['new']);
  const tags = await all(db, 'tags');
  assert.deepEqual(
    tags.map((t) => t.sourceMessageId ?? t.imageId),
    ['new', 'i-old', 'i-new'],
  );
  assert.deepEqual(rows(doc), ['new']);
});

test('pruneHistory(0) deletes every line; null deletes none', async () => {
  const { db, doc, limits } = await setup();
  assert.deepEqual(await limits.pruneHistory(null), []);
  assert.equal((await all(db, 'messages')).length, 3);
  assert.equal((await limits.pruneHistory(0)).length, 3);
  assert.deepEqual(await all(db, 'messages'), []);
  assert.deepEqual(rows(doc), []);
});

test('pruneGallery calls enforceLimit in bytes and deletes the removed images\' tags', async () => {
  const gallery = fakeGallery(['i-old']);
  const { db, limits } = await setup({ gallery });
  assert.deepEqual(await limits.pruneGallery(2), ['i-old']);
  assert.deepEqual(gallery.calls, [['enforce', 2 * MB_BYTES]]);
  const tags = await all(db, 'tags');
  assert.deepEqual(tags.map((t) => t.sourceMessageId ?? t.imageId), ['new', 'i-new']);
});

test('no gallery limit calls nothing', async () => {
  const gallery = fakeGallery(['i-old']);
  const { limits } = await setup({ gallery });
  assert.equal(await limits.previewGallery(null), null);
  assert.deepEqual(await limits.pruneGallery(null), []);
  assert.deepEqual(gallery.calls, []);
  assert.deepEqual(await limits.previewGallery(5), { ids: ['i-old'], count: 1, bytes: 10 });
  assert.deepEqual(gallery.calls, [['preview', 5 * MB_BYTES]]);
});
