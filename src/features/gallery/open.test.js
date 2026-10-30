import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REVOKE_MS, isUnavailable, openImage, retryImage } from './open.js';

/** @param {Partial<import('./store.js').ImageRecord>} over */
const item = (over = {}) => ({
  id: '123456789012345',
  messageId: '1',
  user: 'Chat User1',
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

const png = () => new Blob(['x'], { type: 'image/png' });
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * A store and fetch that record what open and retry ask of them.
 * @param {{ fails?: string, storeFails?: boolean }} [opts]  fails: the fetch answers that HTTP status
 */
function fakeDeps({ fails, storeFails = false } = {}) {
  /** @type {string[]} */
  const fetched = [];
  /** @type {unknown[][]} */
  const calls = [];
  /** @type {unknown[]} */
  const reported = [];
  const store = /** @type {any} */ ({
    markBroken: async (/** @type {string} */ id, /** @type {string} */ reason) => {
      if (storeFails) throw new Error('store down');
      calls.push(['markBroken', id, reason]);
    },
    repair: async (/** @type {string} */ id) => void calls.push(['repair', id]),
  });
  /** @type {typeof globalThis.fetch} */
  const fetch = async (input) => {
    fetched.push(String(input));
    return fails
      ? new Response('gone', { status: Number(fails) })
      : new Response(png(), { headers: { 'content-type': 'image/png' } });
  };
  return { store, fetch, report: (/** @type {unknown} */ e) => void reported.push(e), fetched, calls, reported };
}

/** @param {{ blocked?: boolean }} [opts] */
function fakeWin({ blocked = false } = {}) {
  /** @type {[string, string][]} */
  const opened = [];
  /** @type {string[]} */
  const revoked = [];
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  const win = /** @type {any} */ ({
    location: { href: 'https://chat.example.com/forum/chat/index.php' },
    URL: { createObjectURL: () => 'blob:original', revokeObjectURL: (/** @type {string} */ u) => void revoked.push(u) },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => timers.push({ fn, ms }),
    open: (/** @type {string} */ url, /** @type {string} */ target) => {
      opened.push([url, target]);
      return blocked ? null : { opener: 'chat' };
    },
  });
  return { win, opened, revoked, timers };
}

test('a stored original opens as an object URL, revoked only once the timer fires', () => {
  const w = fakeWin();
  assert.equal(openImage(item({ blob: png() }), { win: w.win, ...fakeDeps() }), 'opened');
  assert.deepEqual(w.opened, [['blob:original', '_blank']]);
  assert.deepEqual(w.revoked, [], 'revoking at once would leave the tab blank');
  assert.deepEqual(w.timers.map((t) => t.ms), [REVOKE_MS]);
  w.timers[0].fn();
  assert.deepEqual(w.revoked, ['blob:original']);
});

test('without a stored original, the share URL opens with no object URL or revoke timer', () => {
  const w = fakeWin();
  w.win.URL.createObjectURL = () => assert.fail('no object URL without a blob');
  assert.equal(openImage(item(), { win: w.win, ...fakeDeps() }), 'opened');
  assert.deepEqual(w.opened, [['https://chat.example.com/forum/chat/plugins/share/view.php?id=123456789012345', '_blank']]);
  assert.deepEqual(w.timers, []);
});

test('a blocked tab revokes the object URL at once and answers blocked', () => {
  const w = fakeWin({ blocked: true });
  assert.equal(openImage(item({ blob: png() }), { win: w.win, ...fakeDeps() }), 'blocked');
  assert.deepEqual(w.revoked, ['blob:original']);
  assert.deepEqual(w.timers, []);
  assert.equal(openImage(item(), { win: w.win, ...fakeDeps() }), 'blocked', 'the share URL too');
});

test('a broken record with no stored original opens nothing; one that kept its original still opens it', () => {
  const w = fakeWin();
  const gone = item({ broken: true, brokenReason: 'HTTP 404' });
  assert.equal(isUnavailable(gone), true);
  assert.equal(openImage(gone, { win: w.win, ...fakeDeps() }), 'unavailable');
  assert.deepEqual(w.opened, []);

  const kept = item({ broken: true, blob: png() });
  assert.equal(isUnavailable(kept), false);
  assert.equal(isUnavailable(item()), false);
  assert.equal(openImage(kept, { win: w.win, ...fakeDeps() }), 'opened');
  assert.deepEqual(w.opened, [['blob:original', '_blank']]);
});

const SHARE = 'https://chat.example.com/forum/chat/plugins/share/view.php?id=123456789012345';

test('an opened tab is cut off from the chat page', () => {
  const w = fakeWin();
  /** @type {any[]} */
  const tabs = [];
  const open = w.win.open;
  w.win.open = (/** @type {string} */ u, /** @type {string} */ t) => {
    const tab = open(u, t);
    tabs.push(tab);
    return tab;
  };
  openImage(item({ blob: png() }), { win: w.win, ...fakeDeps() });
  openImage(item(), { win: w.win, ...fakeDeps() });
  assert.deepEqual(tabs.map((t) => t.opener), [null, null]);
});

test('a stored SVG (or untyped) original is never opened as an object URL; the share URL is', () => {
  for (const blob of [new Blob(['<svg/>'], { type: 'image/svg+xml' }), new Blob(['x'])]) {
    const w = fakeWin();
    w.win.URL.createObjectURL = () => assert.fail('no object URL for a non-raster original');
    assert.equal(openImage(item({ blob }), { win: w.win, ...fakeDeps() }), 'opened');
    assert.deepEqual(w.opened, [[SHARE, '_blank']]);
  }
  assert.equal(isUnavailable(item({ broken: true, blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })), true);
  assert.equal(isUnavailable(item({ broken: true, blob: new Blob(['x'], { type: 'image/webp' }) })), false);
});

test('a share URL opened is probed in the background: a dead copy is marked broken', async () => {
  const w = fakeWin();
  const d = fakeDeps({ fails: '404' });
  assert.equal(openImage(item(), { win: w.win, ...d }), 'opened', 'answered before the probe settles');
  assert.deepEqual(w.opened, [[SHARE, '_blank']], 'the tab opened first, inside the click');
  await settle();
  assert.deepEqual(d.fetched, [SHARE]);
  assert.deepEqual(d.calls, [['markBroken', '123456789012345', 'HTTP 404']]);
  assert.deepEqual(d.reported, [], 'the tab and the tile show the failure already');
});

test('a background probe that loads changes nothing; a store that cannot record a failure is reported', async () => {
  const w = fakeWin();
  const ok = fakeDeps();
  openImage(item(), { win: w.win, ...ok });
  await settle();
  assert.deepEqual(ok.calls, []);

  const down = fakeDeps({ fails: '503', storeFails: true });
  openImage(item(), { win: w.win, ...down });
  await settle();
  assert.deepEqual(down.reported.map((e) => /** @type {Error} */ (e).message), ['store down']);
});

test('a blocked or stored-original open is not probed', async () => {
  const blocked = fakeDeps();
  openImage(item(), { win: fakeWin({ blocked: true }).win, ...blocked });
  const stored = fakeDeps();
  openImage(item({ blob: png() }), { win: fakeWin().win, ...stored });
  await settle();
  assert.deepEqual([blocked.fetched, stored.fetched], [[], []]);
});

test('a retry that loads repairs the record and opens nothing', async () => {
  const w = fakeWin();
  const d = fakeDeps();
  await retryImage(item({ broken: true, brokenReason: 'HTTP 503' }), { win: w.win, ...d });
  assert.deepEqual(d.fetched, [SHARE]);
  assert.deepEqual(d.calls, [['repair', '123456789012345']]);
  assert.deepEqual(w.opened, [], 'a tab opened after an await would be blocked');
});

test('a retry that fails keeps the record broken with the new reason, and rejects', async () => {
  const w = fakeWin();
  const d = fakeDeps({ fails: '404' });
  await assert.rejects(retryImage(item({ broken: true, brokenReason: 'HTTP 503' }), { win: w.win, ...d }), /still unavailable from server: HTTP 404/);
  assert.deepEqual(d.calls, [['markBroken', '123456789012345', 'HTTP 404']]);
  assert.deepEqual(w.opened, []);
});
