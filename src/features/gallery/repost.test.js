import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repost from './repost.js';
import { POST_UNAVAILABLE, createRepostAction, extensionFor } from './repost.js';

/** @param {Partial<import('./repost.js').RepostItem>} over */
const item = (over = {}) => ({ id: '100000000000001', contentType: 'image/png', broken: false, ...over });

/**
 * @param {{ refuse?: string, fetchFails?: string, unavailable?: boolean }} [opts]
 */
function setup({ refuse, fetchFails, unavailable = false } = {}) {
  /** @type {File[]} */
  const staged = [];
  /** @type {string[]} */
  const fetched = [];
  /** @type {string[]} */
  const events = [];
  const action = createRepostAction({
    stage: (file) => {
      staged.push(file);
      events.push('stage');
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
  });
  /** @type {{ current: unknown }} */
  const view = { current: {} };
  return { action, staged, fetched, events, view };
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
