import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST_COOLDOWN_MS, POST_UNAVAILABLE, createRepostAction, extensionFor } from './repost.js';

/** @param {Partial<import('./repost.js').RepostItem>} over */
const item = (over = {}) => ({ id: '100000000000001', contentType: 'image/png', broken: false, ...over });

/**
 * @param {{ refuse?: string, whisper?: string, fetchFails?: string, unavailable?: boolean }} [opts]
 */
function setup({ refuse, whisper = '', fetchFails, unavailable = false } = {}) {
  /** @type {{ file: File, toUser: string }[]} */
  const uploads = [];
  /** @type {string[]} */
  const fetched = [];
  let toUser = whisper;
  const action = createRepostAction({
    upload: async (file, to) => {
      uploads.push({ file, toUser: to });
      if (refuse) throw new Error(refuse);
    },
    fetchShare: async (id) => {
      fetched.push(id);
      if (fetchFails) throw new Error(fetchFails);
      return { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), contentType: 'image/jpeg' };
    },
    whisperTo: () => toUser,
    isUnavailable: () => unavailable,
  });
  return { action, uploads, fetched, setWhisper: (/** @type {string} */ u) => (toUser = u) };
}

test('Post is the registry action shape, with a 5 s cooldown', () => {
  const { action } = setup();
  assert.equal(action.id, 'post');
  assert.equal(action.label, 'Post');
  assert.ok(action.icon.startsWith('<svg'));
  assert.equal(action.cooldownMs, POST_COOLDOWN_MS);
  assert.equal(POST_COOLDOWN_MS, 5000);
});

test('a stored original is uploaded as it is, without fetching the share', async () => {
  const g = setup();
  const blob = new Blob([new Uint8Array(4)], { type: 'image/png' });
  await g.action.onSelect(item({ blob }));
  assert.deepEqual(g.fetched, []);
  assert.equal(g.uploads.length, 1);
  const { file, toUser } = g.uploads[0];
  assert.equal(file.name, '100000000000001.png');
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 4);
  assert.equal(toUser, '');
});

test('with nothing stored, the share is fetched and uploaded under its own type', async () => {
  const g = setup();
  await g.action.onSelect(item({ contentType: '' }));
  assert.deepEqual(g.fetched, ['100000000000001']);
  assert.equal(g.uploads[0].file.name, '100000000000001.jpg');
  assert.equal(g.uploads[0].file.type, 'image/jpeg');
  assert.equal(g.uploads[0].file.size, 3);
});

test('while whispering, the upload goes to the whispered user; otherwise to the room', async () => {
  const g = setup({ whisper: 'bob' });
  await g.action.onSelect(item({ blob: new Blob([new Uint8Array(1)], { type: 'image/png' }) }));
  g.setWhisper('');
  await g.action.onSelect(item({ blob: new Blob([new Uint8Array(1)], { type: 'image/png' }) }));
  assert.deepEqual(g.uploads.map((u) => u.toUser), ['bob', '']);
});

test('the whisper target is read at the click, before the share is fetched', async () => {
  /** @type {string[]} */
  const to = [];
  let whisper = 'bob';
  /** @type {(v: { blob: Blob, contentType: string }) => void} */
  let resolveFetch = () => {};
  const action = createRepostAction({
    upload: async (_file, toUser) => void to.push(toUser),
    fetchShare: () => new Promise((r) => (resolveFetch = r)),
    whisperTo: () => whisper,
    isUnavailable: () => false,
  });
  const done = action.onSelect(item());
  whisper = '';
  resolveFetch({ blob: new Blob([new Uint8Array(1)], { type: 'image/png' }), contentType: 'image/png' });
  await done;
  assert.deepEqual(to, ['bob']);
});

test('a refusal rejects with the upload\'s own reason', async () => {
  const g = setup({ refuse: 'Upload failed: you are signed out' });
  await assert.rejects(g.action.onSelect(item({ blob: new Blob([new Uint8Array(1)], { type: 'image/png' }) })), {
    message: 'Upload failed: you are signed out',
  });
});

test('a share that no longer loads rejects without uploading', async () => {
  const g = setup({ fetchFails: 'HTTP 404' });
  await assert.rejects(g.action.onSelect(item()), { message: 'HTTP 404' });
  assert.deepEqual(g.uploads, []);
});

test('an unavailable image disables Post with its reason, and is never uploaded', async () => {
  const off = setup({ unavailable: true });
  assert.equal(off.action.disabled(item({ broken: true })), POST_UNAVAILABLE);
  assert.equal(POST_UNAVAILABLE, 'Image unavailable from server');
  await assert.rejects(off.action.onSelect(item({ broken: true })));
  assert.deepEqual(off.uploads, []);
  assert.deepEqual(off.fetched, []);
  assert.equal(setup().action.disabled(item()), null);
});

test('extensionFor names a file from its type', () => {
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('image/PNG; charset=binary'), 'png');
  assert.equal(extensionFor('image/svg+xml'), 'svg');
  assert.equal(extensionFor('image/webp'), 'webp');
  assert.equal(extensionFor(''), 'bin');
});
