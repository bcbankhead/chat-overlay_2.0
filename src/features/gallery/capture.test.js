import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { openDb } from '../../core/db.js';
import { createSettings } from '../../core/settings.js';
import { startCapture } from './capture.js';
import { createImageStore } from './store.js';

const ID = '123456789012345';
const SHARE = (id) =>
  `[[br]][[a href="plugins/share/view.php?id=${id}" target="_blank"]][[img src="plugins/share/view.php?id=${id}"]][[/a]]`;

let n = 0;
const settle = () => new Promise((r) => setTimeout(r, 30));
/** @param {import('./store.js').ImageStore} store @param {string} id */
const get = async (store, id) => (await store.list()).find((r) => r.id === id);

/**
 * @param {{ ok?: boolean, type?: string, offline?: boolean, thumbFails?: boolean, ready?: Promise<any>,
 *   hang?: boolean, timeoutMs?: number }} [opts]
 */
async function harness({ ok = true, type = 'image/jpeg', offline = false, thumbFails = false, ready, hang = false, timeoutMs } = {}) {
  const state = { ok, hang, type };
  const db = await openDb({ name: `gallery-capture-${++n}` });
  const store = createImageStore(db);
  const settings = createSettings(db);
  if (offline) await settings.set('storeImagesOffline', true);
  /** @type {Set<(r: any) => void>} */
  const listeners = new Set();
  /** @type {string[]} */
  const fetched = [];
  /** @type {unknown[]} */
  const errors = [];
  startCapture({
    ready: ready ?? Promise.resolve({ store, settings }),
    onInbound: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fetch: async (url, init) => {
      fetched.push(String(url));
      if (state.hang) {
        // Never answers: only the timeout's signal ends it.
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
      }
      if (!state.ok) return new Response('gone', { status: 404 });
      return new Response(new Blob([new Uint8Array(5000)], { type: state.type }), {
        headers: { 'content-type': state.type },
      });
    },
    makeThumb: async () => {
      if (thumbFails) throw new Error('cannot decode');
      return new Blob([new Uint8Array(300)], { type: 'image/webp' });
    },
    base: () => 'https://dollforum.com/forum/chat/index.php',
    report: (err) => errors.push(err),
    timeoutMs,
  });
  /** @param {Partial<import('../../core/history.js').MessageRecord>} over */
  const deliver = (over) => {
    const record = { id: '1', roomID: '1', mTime: '100', user: 'alice', receivedAt: 1, text: '', ...over };
    for (const fn of listeners) fn(record);
  };
  return { store, deliver, fetched, errors, state };
}

test('the same share id twice, in one message and across two, yields one entry and one fetch', async () => {
  const h = await harness();
  h.deliver({ id: '1', text: SHARE(ID) + SHARE(ID) });
  h.deliver({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  h.deliver({ id: '3', text: SHARE(ID), receivedAt: 3 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].messageId, '1');
  assert.deepEqual(h.fetched, ['https://dollforum.com/forum/chat/plugins/share/view.php?id=123456789012345']);
  assert.deepEqual(h.errors, []);
});

test('with Store images offline off, only metadata and the thumbnail are kept', async () => {
  const h = await harness();
  h.deliver({ text: SHARE(ID) });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.blob, undefined);
  assert.equal(row?.thumb?.size, 300);
  assert.equal(row?.bytes, 300);
  assert.equal(row?.contentType, 'image/jpeg');
  assert.equal(row?.favorite, false);
  assert.equal(row?.broken, false);
  assert.equal(row?.user, 'alice');
});

test('with Store images offline on, the full image is kept too', async () => {
  const h = await harness({ offline: true });
  h.deliver({ text: SHARE(ID) });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.blob?.size, 5000);
  assert.equal(row?.bytes, 5300);
});

test('a failed fetch, or a non-image answer, is stored broken without a thumbnail', async () => {
  for (const opts of [{ ok: false }, { type: 'text/html' }]) {
    const h = await harness(opts);
    h.deliver({ text: SHARE(ID) });
    await settle();
    const row = await get(h.store, ID);
    assert.equal(row?.broken, true);
    assert.equal(row?.thumb, null);
    assert.equal(row?.bytes, 0);
    assert.equal(row?.contentType, '');
    assert.equal(row?.brokenReason, opts.ok === false ? 'HTTP 404' : 'not an image: text/html');
  }
});

test('a share that never answers times out, is stored broken, and does not hold the queue', async () => {
  const h = await harness({ hang: true, timeoutMs: 20 });
  h.deliver({ text: SHARE(ID) });
  h.deliver({ id: '2', text: SHARE('999999999999999'), receivedAt: 2 });
  await new Promise((r) => setTimeout(r, 5));
  h.state.hang = false;
  await new Promise((r) => setTimeout(r, 100));
  const first = await get(h.store, ID);
  assert.equal(first?.broken, true);
  assert.equal(first?.brokenReason, 'no answer within 20 ms');
  const second = await get(h.store, '999999999999999');
  assert.equal(second?.broken, false);
  assert.deepEqual(h.errors, []);
});

test('a broken image shared again is retried, and repaired in place when it loads', async () => {
  const h = await harness({ ok: false });
  h.deliver({ id: '1', text: SHARE(ID) });
  await settle();
  assert.equal((await get(h.store, ID))?.broken, true);
  await h.store.setFavorite(ID, true);
  h.state.ok = true;
  h.deliver({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].broken, false);
  assert.equal(rows[0].brokenReason, undefined);
  assert.equal(rows[0].messageId, '1', 'the first capture is kept');
  assert.equal(rows[0].favorite, true);
  assert.equal(rows[0].thumb?.size, 300);
  assert.equal(rows[0].bytes, 300);
  assert.equal(rows[0].contentType, 'image/jpeg');
  assert.equal(h.fetched.length, 2);
});

test('a retry that fails again keeps the one record and updates its reason', async () => {
  const h = await harness({ type: 'text/html' });
  h.deliver({ id: '1', text: SHARE(ID) });
  await settle();
  h.state.ok = false;
  h.deliver({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brokenReason, 'HTTP 404');
});

test('messages without a share are ignored', async () => {
  const h = await harness();
  h.deliver({ text: 'hello [[b]]world[[/b]]' });
  await settle();
  assert.deepEqual(h.fetched, []);
  assert.equal((await h.store.list()).length, 0);
});

test('a thumbnail that cannot be made keeps the image, without one, and reports why', async () => {
  const h = await harness({ thumbFails: true });
  h.deliver({ text: SHARE(ID) });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.broken, false);
  assert.equal(row?.thumb, null);
  assert.equal(row?.bytes, 0);
  assert.equal(h.errors.length, 1);
  assert.match(String(/** @type {Error} */ (h.errors[0]).message), /no thumbnail for image 123456789012345: cannot decode/);
});

test('a database that never opens reports the failure for every queued share', async () => {
  const failed = Promise.reject(new Error('IndexedDB disabled'));
  failed.catch(() => {});
  const h = await harness({ ready: failed });
  h.deliver({ text: SHARE(ID) + SHARE('999999999999999') });
  await settle();
  assert.deepEqual(h.errors.map((e) => /** @type {Error} */ (e).message), ['IndexedDB disabled', 'IndexedDB disabled']);
  assert.deepEqual(h.fetched, []);
});
