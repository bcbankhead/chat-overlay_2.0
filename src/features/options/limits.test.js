import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { onDeleted } from '../../core/events.js';
import { createView } from '../../core/view.js';
import { createLimits } from './limits.js';
import { MB_BYTES } from './selectors.js';

const NOW = 8_640_000_000;
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

/** A stored line of room 1 at replay position `order` (its orderKey). */
const msg = (id, order) => ({ id, roomID: '1', mTime: id, user: 'a', receivedAt: NOW, orderKey: order });

/** `n` lines of `roomID`, newer than any `msg` below order 10, ids `f<room>-<i>`. */
const fill = (db, n, roomID = '1') =>
  seed(db, 'messages', Array.from({ length: n }, (_, i) => ({ ...msg(`f${roomID}-${i}`, 10 + i), roomID })));

/** @param {import('node:test').TestContext} t */
async function setup(t, { gallery = fakeGallery([]) } = {}) {
  const db = await openDb({ name: `limits-${++n}` });
  // The room's three oldest lines, oldest first; a prune test fills newer lines above them.
  await seed(db, 'messages', [msg('old', 1), msg('day', 2), msg('new', 3)]);
  await seed(db, 'tags', [{ sourceMessageId: 'old', imageId: 'i-old' }, { imageId: 'i-new' }]);
  const limits = createLimits({ db, gallery });
  /** @type {string[][]} */
  const deleted = [];
  t.after(onDeleted((ids) => deleted.push(ids)));
  return { db, limits, deleted };
}

/** Stands in for TDF-0009.5's store: removes the listed ids when over any limit. */
function fakeGallery(removes) {
  const calls = [];
  return {
    calls,
    async usage(bytes) {
      calls.push(['usage', bytes]);
      const preview = bytes === null ? null : { ids: removes, count: removes.length, bytes: removes.length * 10 };
      return { used: 42, preview };
    },
    async enforceLimit(bytes) {
      calls.push(['enforce', bytes]);
      return removes;
    },
  };
}

test('pruneHistory(25) keeps the room’s newest 25 lines by orderKey and deletes and announces the rest; every tag row stays (TDF-0057)', async (t) => {
  const { db, limits, deleted } = await setup(t);
  await fill(db, 24);
  // Newest first, as the walk meets them.
  assert.deepEqual(await limits.pruneHistory(25), ['day', 'old']);
  const left = (await all(db, 'messages')).map((m) => m.id);
  assert.equal(left.length, 25);
  assert.ok(left.includes('new'));
  // Tagging owns the tags store and re-derives on the announcement.
  assert.equal((await all(db, 'tags')).length, 2);
  assert.deepEqual(deleted, [['day', 'old']]);
});

test('pruneHistory keeps a room of exactly 25 lines whole, however old, and announces nothing', async (t) => {
  const { db, limits, deleted } = await setup(t);
  await fill(db, 22);
  assert.deepEqual(await limits.pruneHistory(25), []);
  assert.equal((await all(db, 'messages')).length, 25);
  assert.deepEqual(deleted, []);
});

test('a stored Chat history value past 25 (the old look-back of 100) still keeps 25', async (t) => {
  const { db, limits } = await setup(t);
  await fill(db, 24);
  assert.deepEqual(await limits.pruneHistory(/** @type {any} */ (100)), ['day', 'old']);
});

test('rooms are bounded independently: pruning a busy room leaves a quiet room’s lines', async (t) => {
  const { db, limits } = await setup(t);
  await fill(db, 24);
  // A quiet room whose lines all sort below the busy room's newest 25.
  await seed(db, 'messages', [0, 1, 2].map((i) => ({ ...msg(`q${i}`, i), roomID: '2' })));
  assert.deepEqual(await limits.pruneHistory(25), ['day', 'old']);
  const quiet = (await all(db, 'messages')).filter((m) => m.roomID === '2').map((m) => m.id);
  assert.deepEqual(quiet.sort(), ['q0', 'q1', 'q2']);
});

test('own pending lines count toward the 25', async (t) => {
  const { db, limits } = await setup(t);
  await fill(db, 23);
  await seed(db, 'messages', [{ ...msg('local-1', 1000), confirm: 'pending' }]);
  assert.deepEqual(await limits.pruneHistory(25), ['day', 'old']);
  assert.ok((await all(db, 'messages')).some((m) => m.id === 'local-1'));
});

test('pruneHistory(0), Chat history off, deletes every line in one announcement', async (t) => {
  const { db, limits, deleted } = await setup(t);
  assert.equal((await limits.pruneHistory(0)).length, 3);
  assert.deepEqual(await all(db, 'messages'), []);
  assert.equal(deleted.length, 1);
});

test('pruned lines leave the open view through its own removal: the next row regroups', async (t) => {
  const { db, limits } = await setup(t);
  const win = new Window({ url: 'https://example.test/chat/' });
  const doc = win.document;
  doc.body.innerHTML = '<div id="chatContainer"></div>';
  const view = createView({ doc, win, container: doc.getElementById('chatContainer'), css: '' });
  t.after(onDeleted((ids) => view.removeById(ids)));
  // One sender, close together: one group headed by the oldest.
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  view.replay(
    ['old', 'day', 'new'].map((id, i) => ({
      id, roomID: '1', mTime: String(t0 + i), user: 'a', toUser: '', kind: 'public', text: id,
      ircFlag: '0', lineBreakFlag: '0', receivedAt: i,
    })),
  );
  assert.ok(doc.querySelector('[data-id="new"]').classList.contains('tdf-cont'));
  await fill(db, 24);
  await limits.pruneHistory(25);
  const rows = [...doc.querySelectorAll('#tdf-chat .tdf-msg')];
  assert.deepEqual(rows.map((el) => el.dataset.id), ['new']);
  assert.ok(rows[0].classList.contains('tdf-head'));
  assert.ok(!rows[0].classList.contains('tdf-cont'));
  // The removed rows are unindexed: an admin delete by their mTime finds nothing.
  view.removeByMTime(String(t0));
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 1);
});

test('pruneGallery calls enforceLimit in bytes and leaves the tags store to tagging', async (t) => {
  const gallery = fakeGallery(['i-old']);
  const { db, limits } = await setup(t, { gallery });
  assert.deepEqual(await limits.pruneGallery(2), ['i-old']);
  assert.deepEqual(gallery.calls, [['enforce', 2 * MB_BYTES]]);
  assert.equal((await all(db, 'tags')).length, 2);
});

test('no gallery limit enforces nothing; the preview reads usage once per call', async (t) => {
  const gallery = fakeGallery(['i-old']);
  const { limits } = await setup(t, { gallery });
  assert.deepEqual(await limits.previewGallery(null), { used: 42, preview: null });
  assert.deepEqual(await limits.pruneGallery(null), []);
  assert.deepEqual(gallery.calls, [['usage', null]]);
  assert.deepEqual(await limits.previewGallery(5), { used: 42, preview: { ids: ['i-old'], count: 1, bytes: 10 } });
  assert.deepEqual(gallery.calls, [['usage', null], ['usage', 5 * MB_BYTES]]);
});

/** Lines from three senders across two rooms, an image of each kind, and their tag rows. */
async function seedSenders(db) {
  const line = (id, user, roomID) => ({ id, roomID, mTime: id, user, receivedAt: NOW });
  await seed(db, 'messages', [
    line('b1', 'Big%20Bob', '1'),
    line('b2', 'Big%20Bob', '2'),
    line('c1', 'carol', '1'),
  ]);
  await seed(db, 'images', [
    { id: 'i-fav', user: 'a', receivedAt: NOW, favorite: true },
    { id: 'i-plain', user: 'Big%20Bob', receivedAt: NOW, favorite: false },
  ]);
}

test('countAll counts every room; clearHistory deletes every line and announces each id', async (t) => {
  const { db, limits, deleted } = await setup(t);
  await seedSenders(db);
  assert.equal(await limits.countAll(), 6);
  const ids = await limits.clearHistory();
  assert.deepEqual([...ids].sort(), ['b1', 'b2', 'c1', 'day', 'new', 'old']);
  assert.deepEqual(await all(db, 'messages'), []);
  assert.deepEqual(deleted, [ids]);
  assert.equal(await limits.countAll(), 0);
});

test('clearHistory over no history deletes and announces nothing', async (t) => {
  const { db, limits, deleted } = await setup(t);
  await limits.clearHistory();
  assert.deepEqual(await limits.clearHistory(), []);
  assert.equal(deleted.length, 1);
  assert.deepEqual(await all(db, 'messages'), []);
});

test('senders lists every stored sender with a line count; countByUser counts one across rooms', async (t) => {
  const { db, limits } = await setup(t);
  await seedSenders(db);
  assert.deepEqual(await limits.senders(), [
    { user: 'Big%20Bob', count: 2 },
    { user: 'a', count: 3 },
    { user: 'carol', count: 1 },
  ]);
  assert.equal(await limits.countByUser('Big%20Bob'), 2);
  assert.equal(await limits.countByUser('nobody'), 0);
});

test('deleteByUser deletes only that sender, in every room, and announces their ids', async (t) => {
  const { db, limits, deleted } = await setup(t);
  await seedSenders(db);
  assert.deepEqual((await limits.deleteByUser('Big%20Bob')).sort(), ['b1', 'b2']);
  assert.deepEqual((await all(db, 'messages')).map((m) => m.id).sort(), ['c1', 'day', 'new', 'old']);
  assert.deepEqual(deleted, [['b1', 'b2']]);
  assert.deepEqual(await limits.deleteByUser('nobody'), []);
  assert.equal(deleted.length, 1);
});

test('neither deletion touches the gallery images, their favorites, or the tags store', async (t) => {
  const { db, limits } = await setup(t);
  await seedSenders(db);
  const images = await all(db, 'images');
  await limits.deleteByUser('Big%20Bob');
  await limits.clearHistory();
  assert.deepEqual(await all(db, 'images'), images);
  // Tagging owns the tags store and re-derives on the announcement.
  assert.equal((await all(db, 'tags')).length, 2);
});

test('cleared lines leave the open view through onDeleted', async (t) => {
  const { limits } = await setup(t);
  const win = new Window({ url: 'https://example.test/chat/' });
  const doc = win.document;
  doc.body.innerHTML = '<div id="chatContainer"></div>';
  const view = createView({ doc, win, container: doc.getElementById('chatContainer'), css: '' });
  t.after(onDeleted((ids) => view.removeById(ids)));
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  view.replay(
    ['old', 'day', 'new'].map((id, i) => ({
      id, roomID: '1', mTime: String(t0 + i), user: 'a', toUser: '', kind: 'public', text: id,
      ircFlag: '0', lineBreakFlag: '0', receivedAt: i,
    })),
  );
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 3);
  await limits.clearHistory();
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 0);
});

// TDF-0033.2: a server-history block's stored state goes with its last line.

test("retention deleting a block's last line drops its state; a block with lines left keeps it", async (t) => {
  const { createBlockState } = await import('../../core/blockState.js');
  const { db, limits } = await setup(t);
  await seed(db, 'messages', [
    { ...msg('b-old', 0), backlogBlock: 'gone' },
    { ...msg('k-old', 0), backlogBlock: 'kept' },
    { ...msg('k-new', 100), backlogBlock: 'kept' },
  ]);
  // 27 lines in the room: the prune deletes the two oldest, b-old and k-old.
  await fill(db, 21);
  const state = createBlockState(db);
  await state.set('gone', true);
  await state.set('kept', true);
  await state.set('other', false);
  await limits.pruneHistory(25);
  assert.deepEqual(await state.load(), { kept: true, other: false });
});

test('a deletion touching no block line leaves block state alone', async (t) => {
  const { createBlockState } = await import('../../core/blockState.js');
  const { db, limits } = await setup(t);
  const state = createBlockState(db);
  await state.set('gone', true);
  await fill(db, 24);
  await limits.pruneHistory(25);
  assert.deepEqual(await state.load(), { gone: true });
});

test('delete-by-sender drops the state of a block it emptied', async (t) => {
  const { createBlockState } = await import('../../core/blockState.js');
  const { db, limits } = await setup(t);
  await seed(db, 'messages', [{ ...msg('z1', 4), user: 'zed', backlogBlock: 'zb' }]);
  const state = createBlockState(db);
  await state.set('zb', true);
  await limits.deleteByUser('zed');
  assert.deepEqual(await state.load(), {});
});

test('Clear history clears every block state', async (t) => {
  const { createBlockState } = await import('../../core/blockState.js');
  const { db, limits } = await setup(t);
  const state = createBlockState(db);
  await state.set('a', true);
  await state.set('b', false);
  await limits.clearHistory();
  assert.deepEqual(await state.load(), {});
});
