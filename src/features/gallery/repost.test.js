import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as repost from './repost.js';
import { POST_UNAVAILABLE, createRepostAction, extensionFor } from './repost.js';

/** @param {Partial<import('./repost.js').RepostItem>} over */
const item = (over = {}) => ({ id: '100000000000001', contentType: 'image/png', broken: false, ...over });

/**
 * @param {{ refuse?: string, fetchFails?: string, unavailable?: boolean, whisper?: string }} [opts]
 */
function setup({ refuse, fetchFails, unavailable = false, whisper = '' } = {}) {
  /** @type {{ file: File, toUser: string }[]} */
  const uploaded = [];
  /** @type {string[]} */
  const fetched = [];
  /** @type {string[]} */
  const events = [];
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
  });
  return { action, uploaded, fetched, events, target, gate, release: () => releaseFetch?.() };
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
