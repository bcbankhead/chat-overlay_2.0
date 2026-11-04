import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPOSER_NOT_READY } from '../composer/api.js';
import * as repost from './repost.js';
import { POST_UNAVAILABLE, createRepostAction, extensionFor } from './repost.js';
import { createRepostLedger } from './reposted.js';

/** @param {Partial<import('./repost.js').RepostItem>} over */
const item = (over = {}) => ({ id: '100000000000001', contentType: 'image/png', broken: false, ...over });

/** A stand-in hash: the bytes' size and first byte, enough to tell the test blobs apart. */
const fakeHash = async (/** @type {Blob} */ blob) => `h${blob.size}:${new Uint8Array(await blob.arrayBuffer())[0] ?? ''}`;

/**
 * @param {{ refuse?: string, fetchFails?: string, unavailable?: boolean, whisper?: string | null, hashFails?: boolean }} [opts]
 */
function setup({ refuse, fetchFails, unavailable = false, whisper = '', hashFails = false } = {}) {
  const ledger = createRepostLedger();
  /** @type {unknown[]} */
  const errors = [];
  /** @type {{ file: File, toUser: string }[]} */
  const uploaded = [];
  /** @type {string[]} */
  const fetched = [];
  /** @type {string[]} */
  const events = [];
  /** @type {{ current: string | null }} */
  const target = { current: whisper };
  /** @type {(() => void) | null} */
  let releaseFetch = null;
  const gate = { hold: false };
  const action = createRepostAction({
    upload: async (file, toUser) => {
      uploaded.push({ file, toUser });
      events.push('upload');
      if (refuse) throw new Error(refuse);
    },
    whisperTo: () => {
      events.push('whisperTo');
      return target.current;
    },
    fetchShare: async (id) => {
      fetched.push(id);
      events.push('fetch');
      if (gate.hold) await new Promise((r) => (releaseFetch = () => r(undefined)));
      if (fetchFails) throw new Error(fetchFails);
      return { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), contentType: 'image/jpeg' };
    },
    isUnavailable: () => unavailable,
    hash: async (blob) => {
      if (hashFails) throw new Error('no subtle crypto');
      return fakeHash(blob);
    },
    ledger,
    report: (err) => void errors.push(err),
  });
  return { action, uploaded, fetched, events, target, gate, ledger, errors, release: () => releaseFetch?.() };
}

const png = () => new Blob([new Uint8Array(4)], { type: 'image/png' });

test('Re-post is the registry action shape: a text label, no icon, a 5-second cooldown', () => {
  const { action } = setup();
  assert.equal(action.id, 'post');
  assert.equal(action.label, 'Re-post');
  assert.equal('icon' in action, false);
  assert.equal(repost.POST_COOLDOWN_MS, 5000);
  assert.equal(action.cooldownMs, 5000);
});

test('a stored original is uploaded to the room as it is, without fetching the share', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  assert.deepEqual(g.fetched, []);
  assert.equal(g.uploaded.length, 1);
  const { file, toUser } = g.uploaded[0];
  assert.equal(toUser, '', 'to the room');
  assert.equal(file.name, '100000000000001.png');
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 4);
  assert.deepEqual(g.events, ['whisperTo', 'upload'], 'no gallery close: nothing else happens');
});

test('with nothing stored, the share is fetched and uploaded under its own type', async () => {
  const g = setup();
  await g.action.onSelect(item({ contentType: '' }));
  assert.deepEqual(g.fetched, ['100000000000001']);
  assert.equal(g.uploaded[0].file.name, '100000000000001.jpg');
  assert.equal(g.uploaded[0].file.type, 'image/jpeg');
  assert.equal(g.uploaded[0].file.size, 3);
});

test('while whispering, the image goes privately to the whispered user', async () => {
  const g = setup({ whisper: 'Bob' });
  await g.action.onSelect(item({ blob: png() }));
  assert.equal(g.uploaded[0].toUser, 'Bob');
});

test('the whisper target is read at the click, before the fetch: a change mid-fetch does not redirect it', async () => {
  for (const [before, after] of [['Bob', ''], ['', 'Bob'], ['Bob', 'Carol']]) {
    const g = setup({ whisper: before });
    g.gate.hold = true;
    const pending = g.action.onSelect(item());
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(g.events, ['whisperTo', 'fetch']);
    g.target.current = after;
    g.release();
    await pending;
    assert.equal(g.uploaded.length, 1);
    assert.equal(g.uploaded[0].toUser, before);
  }
});

test('while the composer is not ready, Re-post is refused at the click, before any fetch or hash', async () => {
  const g = setup({ whisper: null });
  await assert.rejects(g.action.onSelect(item()), { message: COMPOSER_NOT_READY });
  assert.deepEqual(g.events, ['whisperTo'], 'nothing fetched or uploaded');
  assert.deepEqual(g.fetched, []);
  assert.deepEqual(g.uploaded, []);
  assert.deepEqual(g.errors, []);
  // Not ready at the click stays refused even if the composer would be ready by the upload.
  const s = setup({ whisper: null });
  const pending = s.action.onSelect(item({ blob: png() }));
  s.target.current = 'Bob';
  await assert.rejects(pending, { message: COMPOSER_NOT_READY });
  assert.deepEqual(s.uploaded, []);
});

test('a repeat call uploads the image again (the cooldown is view.js\'s)', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  await g.action.onSelect(item({ blob: png() }));
  assert.equal(g.uploaded.length, 2);
});

test('a failed upload rejects with its reason', async () => {
  const g = setup({ refuse: 'Upload failed: signed out' });
  await assert.rejects(g.action.onSelect(item({ blob: png() })), { message: 'Upload failed: signed out' });
  assert.equal(g.uploaded.length, 1);
});

test('a share that no longer loads rejects without uploading', async () => {
  const g = setup({ fetchFails: 'HTTP 404' });
  await assert.rejects(g.action.onSelect(item()), { message: 'HTTP 404' });
  assert.deepEqual(g.uploaded, []);
});

test('an unavailable image disables Re-post with its reason, and is never uploaded', async () => {
  const off = setup({ unavailable: true });
  assert.equal(off.action.disabled(item({ broken: true })), POST_UNAVAILABLE);
  assert.equal(POST_UNAVAILABLE, 'Image unavailable from server');
  await assert.rejects(off.action.onSelect(item({ broken: true })));
  assert.deepEqual(off.uploaded, []);
  assert.deepEqual(off.fetched, []);
  assert.deepEqual(off.events, []);
  assert.equal(setup().action.disabled(item()), null);
});

test('extensionFor names a file from its type', () => {
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('image/PNG; charset=binary'), 'png');
  assert.equal(extensionFor('image/svg+xml'), 'svg');
  assert.equal(extensionFor('image/webp'), 'webp');
  assert.equal(extensionFor(''), 'bin');
});

test('the hash of the exact bytes uploaded is registered with the source id before the upload (TDF-0063)', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  const sent = await fakeHash(g.uploaded[0].file);
  assert.equal(g.ledger.take(sent), '100000000000001');
  assert.equal(g.ledger.take(sent), null);
  // The fetched path registers the fetched bytes.
  const f = setup();
  await f.action.onSelect(item());
  assert.equal(f.ledger.take(await fakeHash(f.uploaded[0].file)), '100000000000001');
});

test('the registration is in place while the upload runs, so a share echoed before it resolves is recognised', async () => {
  const ledger = createRepostLedger();
  /** @type {string | null} */
  let seen = null;
  const action = createRepostAction({
    upload: async (file) => {
      seen = ledger.take(await fakeHash(file));
    },
    whisperTo: () => '',
    fetchShare: async () => {
      throw new Error('unused');
    },
    isUnavailable: () => false,
    hash: fakeHash,
    ledger,
    report: () => {},
  });
  await action.onSelect(item({ blob: png() }));
  assert.equal(seen, '100000000000001');
});

test('a hash failure is reported and the Re-post still uploads, unregistered', async () => {
  const g = setup({ hashFails: true });
  await g.action.onSelect(item({ blob: png() }));
  assert.equal(g.uploaded.length, 1);
  assert.equal(g.errors.length, 1);
  assert.match(String(/** @type {Error} */ (g.errors[0]).message), /re-post of image 100000000000001 not registered: no subtle crypto/);
  assert.equal(g.ledger.take(await fakeHash(g.uploaded[0].file)), null);
});

test('a rejected upload withdraws its one registration and leaves the others of those bytes', async () => {
  const r = setup({ refuse: 'A file is still uploading' });
  r.ledger.register(await fakeHash(png()), 'other');
  await assert.rejects(r.action.onSelect(item({ blob: png() })), /A file is still uploading/);
  // Entries are counted per hash: one withdrawal consumes one, so one of the two remains.
  assert.notEqual(r.ledger.take(await fakeHash(png())), null);
  assert.equal(r.ledger.take(await fakeHash(png())), null);
  // A fetch that fails registers nothing.
  const f = setup({ fetchFails: 'gone' });
  await assert.rejects(f.action.onSelect(item()));
  assert.equal(f.ledger.take(await fakeHash(new Blob([new Uint8Array([1, 2, 3])]))), null);
});

test('re-posting one tile twice registers twice; each share takes one', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  await g.action.onSelect(item({ blob: png() }));
  const sent = await fakeHash(g.uploaded[0].file);
  assert.equal(g.ledger.take(sent), '100000000000001');
  assert.equal(g.ledger.take(sent), '100000000000001');
  assert.equal(g.ledger.take(sent), null);
});
