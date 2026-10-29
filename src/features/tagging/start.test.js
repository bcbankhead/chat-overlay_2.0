import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { emitInbound } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { SMILIE_CODES_FIXTURE as CODES } from './reactions.js';
import { startTagging } from './start.js';

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

test('an own message spaces the next reaction; a failed send re-derives from stored messages', async (t) => {
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

  // The earlier reaction's send failed meanwhile; the refused one triggers a re-derive.
  await history.markUnconfirmed('local-1');
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
