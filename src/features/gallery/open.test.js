import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REVOKE_MS, isUnavailable, openImage } from './open.js';

/** @param {Partial<import('./store.js').ImageRecord>} over */
const item = (over = {}) => ({
  id: '123456789012345',
  messageId: '1',
  user: 'Dolly Belle',
  mTime: '1761696000',
  roomID: '1',
  receivedAt: 0,
  contentType: 'image/png',
  thumb: null,
  bytes: 0,
  favorite: false,
  broken: false,
  ...over,
});

/** @param {{ blocked?: boolean }} [opts] */
function fakeWin({ blocked = false } = {}) {
  /** @type {[string, string][]} */
  const opened = [];
  /** @type {string[]} */
  const revoked = [];
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  const win = /** @type {any} */ ({
    location: { href: 'https://dollforum.com/forum/chat/index.php' },
    URL: { createObjectURL: () => 'blob:original', revokeObjectURL: (/** @type {string} */ u) => void revoked.push(u) },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => timers.push({ fn, ms }),
    open: (/** @type {string} */ url, /** @type {string} */ target) => {
      opened.push([url, target]);
      return blocked ? null : {};
    },
  });
  return { win, opened, revoked, timers };
}

test('a stored original opens as an object URL, revoked only once the timer fires', () => {
  const w = fakeWin();
  assert.equal(openImage(item({ blob: new Blob(['x']) }), { win: w.win }), 'opened');
  assert.deepEqual(w.opened, [['blob:original', '_blank']]);
  assert.deepEqual(w.revoked, [], 'revoking at once would leave the tab blank');
  assert.deepEqual(w.timers.map((t) => t.ms), [REVOKE_MS]);
  w.timers[0].fn();
  assert.deepEqual(w.revoked, ['blob:original']);
});

test('without a stored original, the share URL opens and nothing is fetched or created', () => {
  const w = fakeWin();
  w.win.URL.createObjectURL = () => assert.fail('no object URL without a blob');
  assert.equal(openImage(item(), { win: w.win }), 'opened');
  assert.deepEqual(w.opened, [['https://dollforum.com/forum/chat/plugins/share/view.php?id=123456789012345', '_blank']]);
  assert.deepEqual(w.timers, []);
});

test('a blocked tab revokes the object URL at once and answers blocked', () => {
  const w = fakeWin({ blocked: true });
  assert.equal(openImage(item({ blob: new Blob(['x']) }), { win: w.win }), 'blocked');
  assert.deepEqual(w.revoked, ['blob:original']);
  assert.deepEqual(w.timers, []);
  assert.equal(openImage(item(), { win: w.win }), 'blocked', 'the share URL too');
});

test('a broken record with no stored original opens nothing; one that kept its original still opens it', () => {
  const w = fakeWin();
  const gone = item({ broken: true, brokenReason: 'HTTP 404' });
  assert.equal(isUnavailable(gone), true);
  assert.equal(openImage(gone, { win: w.win }), 'unavailable');
  assert.deepEqual(w.opened, []);

  const kept = item({ broken: true, blob: new Blob(['x']) });
  assert.equal(isUnavailable(kept), false);
  assert.equal(isUnavailable(item()), false);
  assert.equal(openImage(kept, { win: w.win }), 'opened');
  assert.deepEqual(w.opened, [['blob:original', '_blank']]);
});
