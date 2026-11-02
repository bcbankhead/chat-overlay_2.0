import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { openDb } from '../../core/db.js';
import { createSettings } from '../../core/settings.js';
import { startCapture } from './capture.js';
import { createImageStore } from './store.js';
import { extractShareIds } from './shareParse.js';

const ID = '123456789012345';
const SHARE = (id) =>
  `[[br]][[a href="plugins/share/view.php?id=${id}" target="_blank"]][[img src="plugins/share/view.php?id=${id}"]][[/a]]`;

let n = 0;
const settle = () => new Promise((r) => setTimeout(r, 30));
/** @param {import('./store.js').ImageStore} store @param {string} id */
const get = async (store, id) => (await store.list()).find((r) => r.id === id);

/**
 * @param {{ ok?: boolean, type?: string, offline?: boolean, thumbFails?: boolean, ready?: Promise<any>,
 *   hang?: boolean, timeoutMs?: number, self?: string, hashFails?: boolean,
 *   compress?: (blob: Blob) => Promise<Blob | null>, compressOn?: boolean }} [opts]
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
  compress,
  compressOn = false,
} = {}) {
  /** @type {{ ok: boolean, hang: boolean, type: string, self: string, bytes: Record<string, number> }} */
  const state = { ok, hang, type, self, bytes: {} };
  const db = await openDb({ name: `gallery-capture-${++n}` });
  const store = createImageStore(db);
  const settings = createSettings(db);
  if (offline) await settings.set('storeImagesOffline', true);
  if (compressOn) await settings.set('compressStoredImages', true);
  /** @type {Set<(r: any) => void>} */
  const listeners = new Set();
  /** @type {Set<(l: import('../../core/events.js').Liked) => void>} */
  const likers = new Set();
  /** @type {Map<string, any>} the stored messages history.get reads */
  const messages = new Map();
  /** @type {string[]} */
  const fetched = [];
  /** @type {unknown[]} */
  const errors = [];
  const capture = startCapture({
    ready: ready ?? Promise.resolve({ store, settings }),
    onInbound: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onLiked: (fn) => {
      likers.add(fn);
      return () => likers.delete(fn);
    },
    getMessage: async (id) => messages.get(id),
    roomID: () => 'room-1',
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
    base: () => 'https://chat.example.com/forum/chat/index.php',
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
    ...(compress ? { compress } : {}),
  });
  /** @param {Partial<import('../../core/history.js').MessageRecord>} over */
  const deliver = (over) => {
    const record = { id: '1', roomID: '1', mTime: '100', user: 'alice', receivedAt: 1, text: '', ...over };
    messages.set(record.id, record);
    for (const fn of listeners) fn(record);
    return record;
  };
  /**
   * Like an image from its row: the row's own sender and mTime ride along, as the UI sends them.
   * @param {string} shareId @param {string} messageId @param {{ user?: string, mTime?: string }} [row]
   */
  const like = (shareId, messageId, { user = '', mTime = '' } = {}) => {
    for (const fn of likers) fn({ shareId, messageId, user, mTime });
  };
  /**
   * Another member's message arrives and you like every image in it.
   * @param {Partial<import('../../core/history.js').MessageRecord>} over
   */
  const post = (over) => {
    const record = deliver(over);
    for (const shareId of extractShareIds(record.text)) like(shareId, record.id, record);
  };
  return { store, settings, messages, deliver, like, post, fetched, errors, state, backfill: capture.backfill };
}

test('the same share id liked twice, in one message and across two, yields one entry and one fetch', async () => {
  const h = await harness();
  h.post({ id: '1', text: SHARE(ID) + SHARE(ID) });
  h.post({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  h.post({ id: '3', text: SHARE(ID), receivedAt: 3 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].messageId, '1');
  assert.deepEqual(h.fetched, ['https://chat.example.com/forum/chat/plugins/share/view.php?id=123456789012345']);
  assert.deepEqual(h.errors, []);
});

test('with Store images offline off, only metadata and the thumbnail are kept', async () => {
  const h = await harness();
  h.post({ text: SHARE(ID) });
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
  h.post({ text: SHARE(ID) });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.blob?.size, 5000);
  assert.equal(row?.bytes, 5300);
});

test('a failed fetch, or a non-image answer, is stored broken without a thumbnail', async () => {
  for (const opts of [{ ok: false }, { type: 'text/html' }]) {
    const h = await harness(opts);
    h.post({ text: SHARE(ID) });
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
  h.post({ text: SHARE(ID) });
  h.post({ id: '2', text: SHARE('999999999999999'), receivedAt: 2 });
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

test('a broken image whose failed like is retried is fetched again, and repaired in place when it loads', async () => {
  const h = await harness({ ok: false });
  h.post({ id: '1', text: SHARE(ID) });
  await settle();
  assert.equal((await get(h.store, ID))?.broken, true);
  await h.store.setFavorite(ID, true);
  h.state.ok = true;
  h.post({ id: '2', text: SHARE(ID), receivedAt: 2 });
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

test("a failed like's retry that fails again keeps the one record and updates its reason", async () => {
  const h = await harness({ type: 'text/html' });
  h.post({ id: '1', text: SHARE(ID) });
  await settle();
  h.state.ok = false;
  h.post({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].brokenReason, 'HTTP 404');
});

test('messages without a share are ignored', async () => {
  const h = await harness();
  h.post({ text: 'hello [[b]]world[[/b]]' });
  await settle();
  assert.deepEqual(h.fetched, []);
  assert.equal((await h.store.list()).length, 0);
});

test('a thumbnail that cannot be made keeps the image, without one, and reports why', async () => {
  const h = await harness({ thumbFails: true });
  h.post({ text: SHARE(ID) });
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
  h.post({ text: SHARE(ID) + SHARE('999999999999999') });
  await settle();
  assert.deepEqual(h.errors.map((e) => /** @type {Error} */ (e).message), ['IndexedDB disabled', 'IndexedDB disabled']);
  assert.deepEqual(h.fetched, []);
});

const OTHER = '999999999999999';

test('the same bytes under two share ids yield one entry; different bytes yield two', async () => {
  const h = await harness();
  h.post({ id: '1', text: SHARE(ID) });
  h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => r.id), [ID]);
  assert.match(String((await get(h.store, ID))?.hash), /^[0-9a-f]{64}$/);
  // The skipped duplicate id, shared again, is not fetched again.
  h.post({ id: '3', text: SHARE(OTHER), receivedAt: 3 });
  await settle();
  assert.equal(h.fetched.filter((u) => u.includes(OTHER)).length, 1);
  // Once the bytes it duplicated are gone, the next share of it is fetched and stored.
  await h.store.remove(ID);
  h.post({ id: '4', text: SHARE(OTHER), receivedAt: 4 });
  await settle();
  assert.equal(h.fetched.filter((u) => u.includes(OTHER)).length, 2);
  assert.deepEqual((await h.store.list()).map((r) => r.id), [OTHER]);

  const d = await harness();
  d.state.bytes[OTHER] = 7;
  d.post({ id: '1', text: SHARE(ID) });
  d.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await d.store.list()).map((r) => r.id).sort(), [ID, OTHER]);
  assert.deepEqual(d.errors, []);
});

test('another member\'s share is not captured until you like it, then with the sharer\'s record', async () => {
  const h = await harness({ self: 'me' });
  h.deliver({ id: '7', user: 'alice', mTime: '345', roomID: '2', receivedAt: 9, text: SHARE(ID) });
  await settle();
  assert.deepEqual(h.fetched, []);
  assert.equal((await h.store.list()).length, 0);
  h.like(ID, '7');
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { messageId: rows[0].messageId, user: rows[0].user, mTime: rows[0].mTime, roomID: rows[0].roomID, receivedAt: rows[0].receivedAt },
    { messageId: '7', user: 'alice', mTime: '345', roomID: '2', receivedAt: 9 },
  );
  // A second like, or a failed like's retry, of a saved image stores and fetches nothing new.
  h.like(ID, '7');
  await settle();
  assert.equal((await h.store.list()).length, 1);
  assert.equal(h.fetched.length, 1);
  assert.deepEqual(h.errors, []);
});

test('a like whose message is not stored is saved from its row: sender and mTime, the room, the like time', async () => {
  const h = await harness();
  const before = Date.now();
  h.like(ID, '404', { user: 'alice', mTime: '345' });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { messageId: rows[0].messageId, user: rows[0].user, mTime: rows[0].mTime, roomID: rows[0].roomID },
    { messageId: '404', user: 'alice', mTime: '345', roomID: 'room-1' },
  );
  assert.ok(rows[0].receivedAt >= before);
  assert.deepEqual(h.errors, []);
});

test("a stored message is preferred to the liked row's own fields", async () => {
  const h = await harness();
  h.messages.set('7', { id: '7', roomID: '2', mTime: '100', user: 'bob', receivedAt: 9, text: SHARE(ID) });
  h.like(ID, '7', { user: 'alice', mTime: '345' });
  await settle();
  const row = await get(h.store, ID);
  assert.deepEqual({ user: row?.user, mTime: row?.mTime, roomID: row?.roomID, receivedAt: row?.receivedAt }, { user: 'bob', mTime: '100', roomID: '2', receivedAt: 9 });
});

test('a like whose message is not stored and whose row has no sender is reported, and nothing is saved', async () => {
  const h = await harness();
  h.like(ID, '404');
  await settle();
  assert.deepEqual(h.fetched, []);
  assert.equal((await h.store.list()).length, 0);
  assert.deepEqual(h.errors.map((e) => /** @type {Error} */ (e).message), [
    'gallery: liked image 123456789012345 not saved: message 404 is not stored and its row has no sender',
  ]);
});

test('another member sharing a broken image again retries it; an unsaved or whole one is not fetched', async () => {
  const h = await harness({ ok: false, self: 'me' });
  h.post({ id: '1', text: SHARE(ID) });
  await settle();
  assert.equal((await get(h.store, ID))?.broken, true);
  h.state.ok = true;
  h.deliver({ id: '2', user: 'bob', text: SHARE(ID) + SHARE(OTHER), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.deepEqual(rows.map((r) => [r.id, r.broken, r.messageId]), [[ID, false, '1']]);
  assert.equal(h.fetched.length, 2, 'the broken one again, and never the unsaved one');
  h.deliver({ id: '3', user: 'carol', text: SHARE(ID), receivedAt: 3 });
  await settle();
  assert.equal(h.fetched.length, 2, 'a whole image is not fetched again');
  assert.deepEqual(h.errors, []);
});

test('with Include my images off, an own share is not fetched or stored', async () => {
  const h = await harness({ self: 'me' });
  h.deliver({ id: '1', user: 'me', text: SHARE(ID) });
  await settle();
  assert.equal((await h.store.list()).length, 0);
  assert.deepEqual(h.fetched, []);
});

test('with Include my images on, an own share is captured as posted, from the next share without a reload', async () => {
  const h = await harness({ self: 'me' });
  h.deliver({ id: '1', user: 'me', text: SHARE(ID) });
  await settle();
  assert.equal((await h.store.list()).length, 0);
  await h.settings.set('includeMyImages', true);
  h.deliver({ id: '2', user: 'me', text: SHARE(ID), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => [r.user, r.messageId]), [['me', '2']]);
});

test('with the signed-in user unknown, no inbound share is captured, even with Include my images on', async () => {
  const h = await harness({ self: '' });
  await h.settings.set('includeMyImages', true);
  h.deliver({ user: '', text: SHARE(ID) });
  await settle();
  assert.equal((await h.store.list()).length, 0);
});

test('a broken retry whose bytes match another image is removed; a favourite one is repaired', async () => {
  for (const favorite of [false, true]) {
    const h = await harness();
    h.state.ok = false;
    h.post({ id: '1', text: SHARE(ID) });
    await settle();
    if (favorite) await h.store.setFavorite(ID, true);
    h.state.ok = true;
    h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
    await settle();
    h.post({ id: '3', text: SHARE(ID), receivedAt: 3 });
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
  h.post({ id: '1', text: SHARE(ID) });
  h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 2, 'not deduped without a hash');
  assert.equal(rows[0].hash, undefined);
  assert.equal(h.errors.length, 2);
  assert.match(String(/** @type {Error} */ (h.errors[0]).message), /no hash for image .*: no subtle crypto/);
});

/** A compressor that shrinks every original to 1200 bytes of JPEG, recording what it was given. */
const shrinking = () => {
  /** @type {Blob[]} */
  const seen = [];
  /** @param {Blob} blob */
  const compress = async (blob) => {
    seen.push(blob);
    return new Blob([new Uint8Array(1200)], { type: 'image/jpeg' });
  };
  return { seen, compress };
};

test("with Compress stored images on, the smaller re-encode is stored, and the hash is the fetched bytes'", async () => {
  const { seen, compress } = shrinking();
  const h = await harness({ offline: true, compressOn: true, type: 'image/png', compress });
  h.post({ text: SHARE(ID) });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.blob?.size, 1200);
  assert.equal(row?.blob?.type, 'image/jpeg');
  assert.equal(row?.contentType, 'image/jpeg');
  assert.equal(row?.bytes, 1500);
  assert.equal(row?.compressChecked, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].size, 5000, 'given the fetched original');
  const plain = await harness({ type: 'image/png' });
  plain.post({ text: SHARE(ID) });
  await settle();
  assert.equal(row?.hash, (await get(plain.store, ID))?.hash, "the hash is the fetched bytes', not the re-encode's");
  // A re-share of the same image under another id is still recognised as a duplicate.
  h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  assert.deepEqual((await h.store.list()).map((r) => r.id), [ID]);
  assert.deepEqual(h.errors, []);
});

test('a compression that keeps the original, or fails, stores the fetched blob, checked; a failure is reported', async () => {
  for (const fails of [false, true]) {
    const h = await harness({
      offline: true,
      compressOn: true,
      compress: async () => {
        if (fails) throw new Error('cannot encode');
        return null;
      },
    });
    h.post({ text: SHARE(ID) });
    await settle();
    const row = await get(h.store, ID);
    assert.equal(row?.blob?.size, 5000);
    assert.equal(row?.contentType, 'image/jpeg');
    assert.equal(row?.bytes, 5300);
    assert.equal(row?.compressChecked, true);
    assert.deepEqual(
      h.errors.map((e) => /** @type {Error} */ (e).message),
      fails ? ['gallery: image 123456789012345 kept uncompressed: cannot encode'] : [],
    );
  }
});

test('with Compress stored images off, or Store images offline off, nothing is compressed or checked', async () => {
  for (const opts of [{ offline: true }, { compressOn: true }]) {
    const { seen, compress } = shrinking();
    const h = await harness({ ...opts, compress });
    h.post({ text: SHARE(ID) });
    await settle();
    const row = await get(h.store, ID);
    assert.equal(row?.blob?.size, opts.offline ? 5000 : undefined);
    assert.equal(row?.compressChecked, undefined);
    assert.equal(seen.length, 0);
  }
});

test('a broken retry repaired with compression on stores the re-encode, checked', async () => {
  const { compress } = shrinking();
  const h = await harness({ ok: false, offline: true, compressOn: true, compress });
  h.post({ id: '1', text: SHARE(ID) });
  await settle();
  h.state.ok = true;
  h.post({ id: '2', text: SHARE(ID), receivedAt: 2 });
  await settle();
  const row = await get(h.store, ID);
  assert.equal(row?.broken, false);
  assert.equal(row?.blob?.size, 1200);
  assert.equal(row?.compressChecked, true);
});

test('the backfill compresses stored originals in place, keeps favourites, skips decided ones, and stops when switched off', async () => {
  const { seen, compress } = shrinking();
  const h = await harness({ offline: true, compress });
  h.state.bytes[OTHER] = 7;
  h.post({ id: '1', text: SHARE(ID) });
  h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  await settle();
  await h.store.setFavorite(ID, true);
  // Off: the backfill's first task finds the setting off, does nothing, and ends the run.
  await h.backfill();
  await settle();
  assert.equal(seen.length, 0);
  assert.equal((await get(h.store, ID))?.compressChecked, undefined);

  await h.settings.set('compressStoredImages', true);
  await h.backfill();
  await settle();
  const rows = await h.store.list();
  assert.equal(rows.length, 2, 'nothing deleted');
  for (const r of rows) {
    assert.equal(r.blob?.size, 1200);
    assert.equal(r.contentType, 'image/jpeg');
    assert.equal(r.bytes, 1500);
    assert.equal(r.compressChecked, true);
  }
  assert.equal((await get(h.store, ID))?.favorite, true);
  assert.equal(seen.length, 2);
  // A second pass, as after a reload, finds nothing left to do.
  assert.deepEqual(await h.store.pendingCompression(), []);
  await h.backfill();
  await settle();
  assert.equal(seen.length, 2);
  assert.deepEqual(h.errors, []);
});

test('without a compressor the backfill does nothing', async () => {
  const h = await harness({ offline: true, compressOn: true });
  h.post({ text: SHARE(ID) });
  await settle();
  await h.backfill();
  await settle();
  assert.equal((await get(h.store, ID))?.blob?.size, 5000);
  assert.deepEqual(await h.store.pendingCompression(), [ID]);
});

test('a queued backfill task leaves a record that was removed, broken or decided since it was listed', async () => {
  const { seen, compress } = shrinking();
  const h = await harness({ offline: true, compress });
  h.state.bytes[OTHER] = 7;
  const THIRD = '888888888888888';
  h.state.bytes[THIRD] = 9;
  h.post({ id: '1', text: SHARE(ID) });
  h.post({ id: '2', text: SHARE(OTHER), receivedAt: 2 });
  h.post({ id: '3', text: SHARE(THIRD), receivedAt: 3 });
  await settle();
  await h.settings.set('compressStoredImages', true);
  // Change each record after it is listed, before its task runs.
  const list = h.store.pendingCompression.bind(h.store);
  h.store.pendingCompression = async () => {
    const ids = await list();
    await h.store.remove(ID);
    await h.store.markBroken(OTHER, 'gone');
    await h.store.repair(THIRD, { compressChecked: true });
    return ids;
  };
  await h.backfill();
  await settle();
  assert.equal(seen.length, 0);
  assert.equal((await get(h.store, OTHER))?.blob?.size, 5000);
  assert.equal((await get(h.store, THIRD))?.blob?.size, 5000);
});

test('a backfill called while another is listing does not list again', async () => {
  const { compress } = shrinking();
  const h = await harness({ offline: true, compressOn: true, compress });
  h.post({ text: SHARE(ID) });
  await settle();
  let calls = 0;
  const list = h.store.pendingCompression.bind(h.store);
  h.store.pendingCompression = () => {
    calls += 1;
    return list();
  };
  await Promise.all([h.backfill(), h.backfill()]);
  await settle();
  assert.equal(calls, 1);
  await h.backfill();
  assert.equal(calls, 2, 'a later backfill lists again');
});

/**
 * Three originals stored before compression was on, and a compressor whose first call waits
 * until released, logging how many fetches had happened at each call.
 */
async function gatedBackfill() {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((r) => (release = () => r(undefined)));
  /** @type {() => void} */
  let started = () => {};
  const first = new Promise((r) => (started = () => r(undefined)));
  /** @type {number[]} */
  const calls = [];
  /** @type {{ fetched: string[] }} */
  const seen = { fetched: [] };
  const h = await harness({
    offline: true,
    compress: async (blob) => {
      calls.push(seen.fetched.length);
      if (calls.length === 1) {
        started();
        await gate;
      }
      return new Blob([new Uint8Array(blob.size - 1)], { type: 'image/jpeg' });
    },
  });
  seen.fetched = h.fetched;
  const ids = ['111111111111111', '222222222222222', '333333333333333'];
  ids.forEach((id, i) => {
    h.state.bytes[id] = i + 1;
    h.post({ id: String(i + 1), text: SHARE(id), receivedAt: i + 1 });
  });
  await settle();
  await h.settings.set('compressStoredImages', true);
  return { h, ids, calls, first, release };
}

test('a capture queued during a backfill runs before the backfill compresses the next original', async () => {
  const { h, ids, calls, first, release } = await gatedBackfill();
  await h.backfill();
  await first;
  h.post({ id: '9', text: SHARE(ID), receivedAt: 9 });
  release();
  await settle();
  // The first original's compress saw 3 fetches; the new capture's fetch (and its own compress)
  // ran before the remaining two originals were compressed.
  assert.deepEqual(calls, [3, 4, 4, 4]);
  for (const id of [...ids, ID]) assert.equal((await get(h.store, id))?.compressChecked, true);
  assert.deepEqual(h.errors, []);
});

test('a backfill called during a run does not start a second one', async () => {
  const { h, ids, calls, first, release } = await gatedBackfill();
  let listed = 0;
  const list = h.store.pendingCompression.bind(h.store);
  h.store.pendingCompression = () => {
    listed += 1;
    return list();
  };
  await h.backfill();
  await first;
  await h.backfill();
  release();
  await settle();
  assert.equal(listed, 1);
  assert.equal(calls.length, ids.length, 'each original compressed once');
  assert.deepEqual(await h.store.pendingCompression(), []);
  // Once the run has finished, a later backfill lists again.
  await h.backfill();
  assert.equal(listed, 3);
});
