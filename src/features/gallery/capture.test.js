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
 *   hang?: boolean, timeoutMs?: number, self?: string, hashFails?: boolean }} [opts]
 */
async function harness({
  ok = true,
  type = 'image/jpeg',
  offline = false,
  thumbFails = false,
  ready,
  hang = false,
  timeoutMs,
  self = '',
  hashFails = false,
} = {}) {
  /** @type {{ ok: boolean, hang: boolean, type: string, self: string, bytes: Record<string, number> }} */
  const state = { ok, hang, type, self, bytes: {} };
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
      // Every share serves the same 5000 bytes unless state.bytes gives it its own fill.
      const fill = state.bytes[new URL(String(url)).searchParams.get('id') ?? ''] ?? 0;
      return new Response(new Blob([new Uint8Array(5000).fill(fill)], { type: state.type }), {
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
    self: () => state.self,
    ...(hashFails
      ? {
          hash: async () => {
            throw new Error('no subtle crypto');
          },
        }
      : {}),
  });
  /** @param {Partial<import('../../core/history.js').MessageRecord>} over */
  const deliver = (over) => {
    const record = { id: '1', roomID: '1', mTime: '100', user: 'alice', receivedAt: 1, text: '', ...over };
    for (const fn of listeners) fn(record);
  };
  return { store, settings, deliver, fetched, errors, state };
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
  assert.match(String(rows[0].hash), /^[0-9a-f]{64}$/, 'the retry stores the hash');
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

const OTHER = '999999999999999';

test('the same bytes under two share ids yield one entry; different bytes yield two', async () => {
  const h = await harness();
  h.deliver({ id: '1', text: SHARE(ID) });
  h.deliver({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => r.id), [ID]);
  assert.match(String((await get(h.store, ID))?.hash), /^[0-9a-f]{64}$/);
  // The skipped duplicate id, shared again, is not fetched again.
  h.deliver({ id: '3', text: SHARE(OTHER), receivedAt: 3 });
  await settle();
  assert.equal(h.fetched.filter((u) => u.includes(OTHER)).length, 1);
  // Once the bytes it duplicated are gone, the next share of it is fetched and stored.
  await h.store.remove(ID);
  h.deliver({ id: '4', text: SHARE(OTHER), receivedAt: 4 });
  await settle();
  assert.equal(h.fetched.filter((u) => u.includes(OTHER)).length, 2);
  assert.deepEqual((await h.store.list()).map((r) => r.id), [OTHER]);

  const d = await harness();
  d.state.bytes[OTHER] = 7;
  d.deliver({ id: '1', text: SHARE(ID) });
  d.deliver({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await d.store.list()).map((r) => r.id).sort(), [ID, OTHER]);
  assert.deepEqual(d.errors, []);
});

test('with Include my images off, an own share is not fetched or stored; another user\'s still is', async () => {
  const h = await harness({ self: 'me' });
  h.state.bytes[OTHER] = 7;
  h.deliver({ id: '1', user: 'me', text: SHARE(ID) });
  h.deliver({ id: '2', user: 'alice', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => r.id), [OTHER]);
  assert.equal(h.fetched.length, 1);
  assert.match(h.fetched[0], new RegExp(OTHER));
});

test('with Include my images on, an own share is captured, from the next share without a reload', async () => {
  const h = await harness({ self: 'me' });
  h.deliver({ id: '1', user: 'me', text: SHARE(ID) });
  await settle();
  assert.equal((await h.store.list()).length, 0);
  await h.settings.set('includeMyImages', true);
  h.deliver({ id: '2', user: 'me', text: SHARE(ID), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => r.user), ['me']);
});

test('an unknown signed-in user gates nothing', async () => {
  const h = await harness({ self: '' });
  h.deliver({ user: '', text: SHARE(ID) });
  await settle();
  assert.equal((await h.store.list()).length, 1);
});

test('a broken retry whose bytes match another image is removed; a favourite one is repaired', async () => {
  for (const favorite of [false, true]) {
    const h = await harness();
    h.state.ok = false;
    h.deliver({ id: '1', text: SHARE(ID) });
    await settle();
    if (favorite) await h.store.setFavorite(ID, true);
    h.state.ok = true;
    h.deliver({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
    await settle();
    h.deliver({ id: '3', text: SHARE(ID), receivedAt: 3 });
    await settle();
    const rows = await h.store.list();
    if (favorite) {
      assert.deepEqual(rows.map((r) => r.id).sort(), [ID, OTHER].sort());
      assert.equal((await get(h.store, ID))?.broken, false);
    } else {
      assert.deepEqual(rows.map((r) => r.id), [OTHER]);
    }
    assert.deepEqual(h.errors, []);
  }
});

test('a hash that fails is reported, and the image is stored without one', async () => {
  const h = await harness({ hashFails: true });
  h.deliver({ id: '1', text: SHARE(ID) });
  h.deliver({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 2, 'not deduped without a hash');
  assert.equal(rows[0].hash, undefined);
  assert.equal(h.errors.length, 2);
  assert.match(String(/** @type {Error} */ (h.errors[0]).message), /no hash for image .*: no subtle crypto/);
});
