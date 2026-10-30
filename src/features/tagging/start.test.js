import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { STORES, openDb, request } from '../../core/db.js';
import { emitConfirmChange, emitInbound } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { createLimits } from '../options/limits.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { reporter, startTagging } from './start.js';

const A = '100000000111111';
const settle = () => new Promise((r) => setTimeout(r, 50));

test('start wires inbound messages to chips and a pick to the engine', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  Object.assign(win, { roomID: '1', userName: 'me', mySmilies: [...CODES], mySmiliesImg: [] });
  doc.body.innerHTML =
    '<textarea id="optionsBar"></textarea><input id="whisperID">' +
    '<div id="tdf-chat"><div class="tdf-list"></div></div>';
  /** @type {string[]} */
  const sent = [];
  win.sendReq = { readyState: 4, status: 200, addEventListener: (/** @type {string} */ _t, /** @type {() => void} */ fn) => setTimeout(fn, 1) };
  win.addMessage = (/** @type {string} */ input) => {
    sent.push(doc.getElementById(input).value);
    return undefined;
  };
  /** @type {any[]} */
  const pickers = [];

  const ready = startTagging({
    win,
    doc,
    css: '/* tagging */',
    indexedDB: new IDBFactory(),
    openSmileyPicker: (options) => (pickers.push(options), () => {}),
  });
  assert.equal(doc.getElementById('tdf-tagging-style')?.textContent, '/* tagging */');

  /** @param {string} id @param {string} user @param {string} text @param {number} at */
  const inbound = (id, user, text, at) =>
    emitInbound(/** @type {any} */ ({ id, roomID: '1', mTime: String(at), user, kind: 'public', text, receivedAt: at }));
  // Before the database is open: held, not lost.
  inbound('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1);
  await ready;
  inbound('2', 'bob', ':h', 2);
  doc.querySelector('.tdf-list').innerHTML =
    `<div class="tdf-msg tdf-kind-public" data-id="1"><span class="tdf-body"><a href="plugins/share/view.php?id=${A}"><img class="tdf-posted" src="plugins/share/view.php?id=${A}"></a></span></div>`;
  await settle();
  assert.deepEqual([...doc.querySelectorAll('.tdf-rx-chip')].map((c) => c.textContent), ['1']);

  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  pickers[0].onPick(':L');
  await settle();
  assert.deepEqual(sent, [':L ^111111']);
});

/** A chat page whose engine timers are held: zero-delay ones run, the rest wait to be run. */
function chatPage() {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  Object.assign(win, { roomID: '1', userName: 'me', mySmilies: [...CODES], mySmiliesImg: [] });
  doc.body.innerHTML =
    '<textarea id="optionsBar"></textarea><input id="whisperID">' +
    `<div id="tdf-chat"><div class="tdf-list"><div class="tdf-msg tdf-kind-public" data-id="1"><span class="tdf-body"><a href="plugins/share/view.php?id=${A}"><img class="tdf-posted" src="plugins/share/view.php?id=${A}"></a></span></div></div></div>`;
  /** @type {{ ms: number, fn: () => void }[]} */
  const held = [];
  win.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
    if (ms <= 0) return setTimeout(fn, 0);
    held.push({ ms, fn });
    return held.length;
  };
  win.clearTimeout = () => {};
  win.sendReq = { readyState: 4, status: 200, addEventListener: () => {} };
  const chips = () =>
    [...doc.querySelectorAll('.tdf-rx-chip')].map((c) => `${c.dataset.code} ${c.textContent}${c.classList.contains('tdf-rx-failed') ? ' failed' : ''}`);
  return { win, doc, held, chips };
}

/** @param {string} id @param {string} user @param {string} text @param {number} at @param {object} [over] */
const record = (id, user, text, at, over = {}) =>
  /** @type {any} */ ({ id, roomID: '1', mTime: String(at), user, toUser: '', kind: 'public', text, receivedAt: at, ...over });

test('an own message spaces the next reaction; an echo core marks unconfirmed stops counting', async (t) => {
  const { win, doc, held, chips } = chatPage();
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.addPending(record('local-1', 'me', ':h ^111111', 2, { mTime: '' }));
  /** @type {any[]} */
  const pickers = [];
  await startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: (o) => (pickers.push(o), () => {}) });
  await settle();
  assert.deepEqual(chips(), [':h 1']);

  // Your own message just now: the reaction waits the whole interval after it.
  emitInbound(record('local-2', 'me', 'hello', 3, { mTime: '' }));
  win.addMessage = () => false;
  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  pickers[0].onPick(':L');
  assert.equal(held.length, 1);
  assert.ok(held[0].ms > 14_000 && held[0].ms <= 15_000, String(held[0].ms));

  // The earlier reaction's send failed meanwhile: core marks it and announces the change.
  await history.markUnconfirmed('local-1');
  emitConfirmChange({ roomID: '1', ids: ['local-1'], confirm: 'unconfirmed' });
  const later = Date.now() + 20_000;
  t.mock.method(Date, 'now', () => later);
  held.shift()?.fn();
  await settle();
  assert.deepEqual(chips(), [':L 1 failed']);
});

test('a failure to start is shown in the message list', async () => {
  const { win, doc } = chatPage();
  const indexedDB = /** @type {any} */ ({
    open: () => {
      throw new Error('storage is disabled');
    },
  });
  const logged = console.error;
  console.error = () => {};
  try {
    await assert.rejects(startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: () => () => {} }));
  } finally {
    console.error = logged;
  }
  assert.equal(doc.querySelector('.tdf-notice')?.textContent, 'Image reactions: storage is disabled');
});

test('a failure before the view mounts is held until the list appears, and each text shows once', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  const logged = console.error;
  /** @type {unknown[]} */
  const logs = [];
  console.error = (/** @type {unknown} */ m) => logs.push(m);
  try {
    const fail = reporter(doc, win);
    fail(new Error('early'));
    fail(new Error('early'));
    assert.equal(doc.querySelector('.tdf-notice'), null);
    doc.body.innerHTML = '<div id="tdf-chat"><div class="tdf-list"></div></div>';
    await settle();
    fail(new Error('early'));
    fail(new Error('later'));
    assert.deepEqual(
      [...doc.querySelectorAll('.tdf-notice')].map((n) => n.textContent),
      ['Image reactions: early', 'Image reactions: later'],
    );
    assert.equal(logs.length, 4, 'every failure is still logged');
  } finally {
    console.error = logged;
  }
});

test('non-string or empty entries in mySmilies are not reaction codes', async () => {
  const { win, doc, chips } = chatPage();
  win.mySmilies = [':h', '', 5, null];
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.put(record('2', 'bob', '', 2));
  await history.put(record('3', 'carol', `[[img src="plugins/share/view.php?id=${A}"]]`, 3));
  await history.put(record('4', 'dave', ':h', 4));
  await startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: () => () => {} });
  await settle();
  assert.deepEqual(chips(), [':h 1']);
});

test('a pending echo core expires while the first rebuild reads stops counting', async () => {
  const { win, doc, chips } = chatPage();
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.addPending(record('local-1', 'me', ':h ^111111', 2, { mTime: '' }));
  const started = startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: () => () => {} });
  // As bootstrap does: expirePending commits, then the change is announced, whichever of the
  // two the tagging read sees first.
  await history.markUnconfirmed('local-1');
  emitConfirmChange({ roomID: '1', ids: ['local-1'], confirm: 'unconfirmed' });
  await started;
  await settle();
  assert.deepEqual(chips(), []);
});

test('a Storage limit prune is not undone by the next reaction change', async () => {
  const { win, doc, chips } = chatPage();
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  const history = createHistory(db);
  const now = Date.now();
  const day = 86_400_000;
  // Two posts of the image: the first, and bob's like of it, are past the limit.
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1, { receivedAt: now - 4 * day }));
  await history.put(record('2', 'bob', ':h', 2, { receivedAt: now - 3 * day }));
  await history.put(record('3', 'dave', `[[img src="plugins/share/view.php?id=${A}"]]`, 3, { receivedAt: now - 1000 }));
  await startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: () => () => {} });
  await settle();
  assert.deepEqual(chips(), [':h 1']);

  const gallery = { usage: async () => ({ used: 0, preview: null }), enforceLimit: async () => [] };
  assert.deepEqual(await createLimits({ db, gallery }).pruneHistory(2), ['1', '2']);
  await settle();
  assert.deepEqual(chips(), []);
  // A later reaction re-derives and persists the room: bob's pruned :h stays gone.
  emitInbound(record('4', 'carol', ':d', 4, { receivedAt: now }));
  await settle();
  /** @type {Array<{ sender: string }>} */
  const rows = await request(db.transaction(STORES.tags).objectStore(STORES.tags).getAll());
  assert.deepEqual(rows.map((r) => r.sender), ['carol']);
  assert.deepEqual(chips(), [':d 1']);
});
