import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repost from './repost.js';
import { POST_UNAVAILABLE, createRepostAction, extensionFor } from './repost.js';
import { createRepostLedger } from './reposted.js';

/** @param {Partial<import('./repost.js').RepostItem>} over */
const item = (over = {}) => ({ id: '100000000000001', contentType: 'image/png', broken: false, ...over });

/** A stand-in hash: the bytes' size and first byte, enough to tell the test blobs apart. */
const fakeHash = async (/** @type {Blob} */ blob) => `h${blob.size}:${new Uint8Array(await blob.arrayBuffer())[0] ?? ''}`;

/**
 * @param {{ refuse?: string, fetchFails?: string, unavailable?: boolean, hashFails?: boolean }} [opts]
 */
function setup({ refuse, fetchFails, unavailable = false, hashFails = false } = {}) {
  const ledger = createRepostLedger();
  /** @type {unknown[]} */
  const errors = [];
  /** @type {File[]} */
  const staged = [];
  /** @type {string[]} */
  const fetched = [];
  /** @type {string[]} */
  const events = [];
  /** @type {(() => void)[]} */
  const discards = [];
  const action = createRepostAction({
    stage: (file, onDiscard) => {
      staged.push(file);
      events.push('stage');
      if (!refuse) discards.push(onDiscard);
      return refuse ?? null;
    },
    fetchShare: async (id) => {
      fetched.push(id);
      if (fetchFails) throw new Error(fetchFails);
      return { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), contentType: 'image/jpeg' };
    },
    isUnavailable: () => unavailable,
    closeGallery: () => void events.push('close'),
    galleryView: () => view.current,
    hash: async (blob) => {
      if (hashFails) throw new Error('no subtle crypto');
      return fakeHash(blob);
    },
    ledger,
    report: (err) => void errors.push(err),
  });
  /** @type {{ current: unknown }} */
  const view = { current: {} };
  return { action, staged, fetched, events, view, ledger, errors, discards };
}

const png = () => new Blob([new Uint8Array(4)], { type: 'image/png' });

test('Re-post is the registry action shape: a text label, no icon, no cooldown', () => {
  const { action } = setup();
  assert.equal(action.id, 'post');
  assert.equal(action.label, 'Re-post');
  assert.equal('icon' in action, false);
  assert.equal('cooldownMs' in action, false);
  assert.equal('POST_COOLDOWN_MS' in repost, false);
});

test('a stored original is staged as it is, without fetching the share, then the gallery closes', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  assert.deepEqual(g.fetched, []);
  assert.equal(g.staged.length, 1);
  const file = g.staged[0];
  assert.equal(file.name, '100000000000001.png');
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 4);
  assert.deepEqual(g.events, ['stage', 'close']);
});

test('with nothing stored, the share is fetched and staged under its own type', async () => {
  const g = setup();
  await g.action.onSelect(item({ contentType: '' }));
  assert.deepEqual(g.fetched, ['100000000000001']);
  assert.equal(g.staged[0].name, '100000000000001.jpg');
  assert.equal(g.staged[0].type, 'image/jpeg');
  assert.equal(g.staged[0].size, 3);
});

test('a repeat click stages the image again', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  await g.action.onSelect(item({ blob: png() }));
  assert.equal(g.staged.length, 2);
  assert.deepEqual(g.events, ['stage', 'close', 'stage', 'close']);
});

test('a refusal rejects with the composer\'s own reason and leaves the gallery open', async () => {
  const g = setup({ refuse: 'A file is still uploading' });
  await assert.rejects(g.action.onSelect(item({ blob: png() })), { message: 'A file is still uploading' });
  assert.deepEqual(g.events, ['stage']);
});

test('a share that no longer loads rejects without staging or closing', async () => {
  const g = setup({ fetchFails: 'HTTP 404' });
  await assert.rejects(g.action.onSelect(item()), { message: 'HTTP 404' });
  assert.deepEqual(g.staged, []);
  assert.deepEqual(g.events, []);
});

test('a share fetched after the flyout closed, or closed and opened again, is not staged', async () => {
  for (const reopen of [false, true]) {
    const g = setup();
    const pending = g.action.onSelect(item());
    g.view.current = reopen ? {} : null;
    await pending;
    assert.deepEqual(g.fetched, ['100000000000001']);
    assert.deepEqual(g.staged, []);
    assert.deepEqual(g.events, []);
  }
});

test('an unavailable image disables Re-post with its reason, and is never staged', async () => {
  const off = setup({ unavailable: true });
  assert.equal(off.action.disabled(item({ broken: true })), POST_UNAVAILABLE);
  assert.equal(POST_UNAVAILABLE, 'Image unavailable from server');
  await assert.rejects(off.action.onSelect(item({ broken: true })));
  assert.deepEqual(off.staged, []);
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

test('the hash of the exact bytes staged is registered with the source id before the hand-off', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  const sent = await fakeHash(g.staged[0]);
  assert.equal(g.ledger.take(sent), '100000000000001');
  assert.equal(g.ledger.take(sent), null);
  // The fetched path registers the fetched bytes.
  const f = setup();
  await f.action.onSelect(item());
  assert.equal(f.ledger.take(await fakeHash(f.staged[0])), '100000000000001');
});

test('a hash failure is reported and the Re-post still goes ahead, unregistered', async () => {
  const g = setup({ hashFails: true });
  await g.action.onSelect(item({ blob: png() }));
  assert.deepEqual(g.events, ['stage', 'close']);
  assert.equal(g.errors.length, 1);
  assert.match(String(/** @type {Error} */ (g.errors[0]).message), /re-post of image 100000000000001 not registered: no subtle crypto/);
  assert.equal(g.ledger.take(await fakeHash(g.staged[0])), null);
});

test('nothing is registered when the flyout closed mid-fetch, or the hand-off is refused', async () => {
  const g = setup();
  const pending = g.action.onSelect(item());
  g.view.current = null;
  await pending;
  assert.equal(g.ledger.take(await fakeHash(new Blob([new Uint8Array([1, 2, 3])]))), null);
  const r = setup({ refuse: 'A file is still uploading' });
  await assert.rejects(r.action.onSelect(item({ blob: png() })));
  assert.equal(r.ledger.take(await fakeHash(png())), null);
});

test('a staged Re-post discarded unposted withdraws its registration, once per discard', async () => {
  const g = setup();
  await g.action.onSelect(item({ blob: png() }));
  await g.action.onSelect(item({ blob: png() }));
  const sent = await fakeHash(g.staged[0]);
  // The first is replaced by the second: one registration is withdrawn, the second's stays.
  g.discards[0]();
  assert.equal(g.ledger.take(sent), '100000000000001');
  assert.equal(g.ledger.take(sent), null);
  // Removed with ×: nothing is left for a later share of the same bytes.
  const r = setup();
  await r.action.onSelect(item({ blob: png() }));
  r.discards[0]();
  assert.equal(r.ledger.take(await fakeHash(r.staged[0])), null);
  // An unregistered Re-post's discard takes nothing.
  const u = setup({ hashFails: true });
  await u.action.onSelect(item({ blob: png() }));
  u.ledger.register(await fakeHash(png()), 'other');
  u.discards[0]();
  assert.equal(u.ledger.take(await fakeHash(png())), 'other');
});