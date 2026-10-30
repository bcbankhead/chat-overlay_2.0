import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { emitInbound } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { FALLBACK_TOKEN_BG, nativeChatBackground, reporter, startTagging } from './start.js';

const A = '100000000111111';
const settle = () => new Promise((r) => setTimeout(r, 50));

test('start wires inbound messages to the heart, and a pick and a right-click to the engine', async () => {
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
  assert.deepEqual([...doc.querySelectorAll('.tdf-rx-heart')].map((c) => c.textContent), ['♥1']);

  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  pickers[0].onPick(':L');
  await settle();
  // happy-dom computes no background for the chat, so the fallback colour hides the token.
  assert.deepEqual(sent, [`:L [[span style=color:${FALLBACK_TOKEN_BG}]]^111111[[/span]]`]);
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
  // Reduced motion: no floating hearts, so the only held timers are the queue's.
  win.matchMedia = () => ({ matches: true });
  win.sendReq = { readyState: 4, status: 200, addEventListener: () => {} };
  const hearts = () =>
    [...doc.querySelectorAll('.tdf-rx-heart')].map((c) => `${c.textContent}${c.classList.contains('tdf-rx-failed') ? ' failed' : ''}`);
  return { win, doc, held, hearts };
}

/** @param {string} id @param {string} user @param {string} text @param {number} at @param {object} [over] */
const record = (id, user, text, at, over = {}) =>
  /** @type {any} */ ({ id, roomID: '1', mTime: String(at), user, toUser: '', kind: 'public', text, receivedAt: at, ...over });

test('an own message spaces the next reaction; a failed send re-derives from stored messages', async (t) => {
  const { win, doc, held, hearts } = chatPage();
  const B = '100000000222222';
  doc.querySelector('.tdf-list').insertAdjacentHTML(
    'beforeend',
    `<div class="tdf-msg tdf-kind-public" data-id="2"><span class="tdf-body"><a href="plugins/share/view.php?id=${B}"><img class="tdf-posted" src="plugins/share/view.php?id=${B}"></a></span></div>`,
  );
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.put(record('2', 'alice', `[[img src="plugins/share/view.php?id=${B}"]]`, 2));
  await history.addPending(record('local-1', 'me', ':h ^222222', 3, { mTime: '' }));
  /** @type {any[]} */
  const pickers = [];
  await startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: (o) => (pickers.push(o), () => {}) });
  await settle();
  assert.deepEqual(hearts(), ['♥1']);

  // Your own message just now: the reaction waits the whole interval after it.
  emitInbound(record('local-2', 'me', 'hello', 4, { mTime: '' }));
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
  assert.deepEqual(hearts(), ['♥1 failed']);
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
  const { win, doc, hearts } = chatPage();
  win.mySmilies = [':h', '', 5, null];
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.put(record('2', 'bob', '', 2));
  await history.put(record('3', 'carol', `[[img src="plugins/share/view.php?id=${A}"]]`, 3));
  await history.put(record('4', 'dave', ':h', 4));
  await startTagging({ win, doc, css: '', indexedDB, openSmileyPicker: () => () => {} });
  await settle();
  assert.deepEqual(hearts(), ['♥1']);
});

test('the token colour is the native chat background: #chatContainer, else an opaque ancestor short of .body', () => {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  doc.body.innerHTML = '<div class="body" style="background-color: #fbfbff"><div id="wrap"><div id="chatContainer"></div></div></div>';
  const chat = doc.getElementById('chatContainer');
  const wrap = doc.getElementById('wrap');
  assert.equal(nativeChatBackground(doc, win), FALLBACK_TOKEN_BG, 'transparent up to the themed .body');
  wrap.style.backgroundColor = 'rgb(238, 238, 238)';
  assert.equal(nativeChatBackground(doc, win), '#eeeeee');
  chat.style.backgroundColor = '#abc';
  assert.equal(nativeChatBackground(doc, win), '#aabbcc');
  chat.remove();
  assert.equal(nativeChatBackground(doc, win), FALLBACK_TOKEN_BG, 'no chat container');
});

test('a right-click likes through the engine with the hidden token', async () => {
  const { win, doc } = chatPage();
  /** @type {string[]} */
  const sent = [];
  win.addMessage = (/** @type {string} */ input) => (sent.push(doc.getElementById(input).value), undefined);
  await startTagging({ win, doc, css: '', indexedDB: new IDBFactory(), openSmileyPicker: () => () => {} });
  await settle();
  const event = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  doc.querySelector('img.tdf-posted').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await settle();
  assert.deepEqual(sent, [`:h [[span style=color:${FALLBACK_TOKEN_BG}]]^111111[[/span]]`]);
});

test('the fallback token colour gives its reason', () => {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  /** @type {string[]} */
  const reasons = [];
  const onFallback = (/** @type {string} */ r) => reasons.push(r);
  doc.body.innerHTML = '<div class="body"><div id="chatContainer"></div></div>';
  assert.equal(nativeChatBackground(doc, win, onFallback), FALLBACK_TOKEN_BG);
  doc.getElementById('chatContainer').style.backgroundColor = '#abc';
  assert.equal(nativeChatBackground(doc, win, onFallback), '#aabbcc');
  doc.body.innerHTML = '';
  assert.equal(nativeChatBackground(doc, win, onFallback), FALLBACK_TOKEN_BG);
  assert.deepEqual(reasons, [
    'the chat background is transparent up to .body',
    'the native chat (#chatContainer) is missing',
  ]);
});

/**
 * Right-clicks two images, so two likes take their token colour.
 * @param {(doc: Document) => void} arrange
 */
async function likeTwice(arrange) {
  const { win, doc } = chatPage();
  const B = '100000000222222';
  doc.querySelector('.tdf-list').insertAdjacentHTML(
    'beforeend',
    `<div class="tdf-msg tdf-kind-public" data-id="2"><span class="tdf-body"><a href="plugins/share/view.php?id=${B}"><img class="tdf-posted" src="plugins/share/view.php?id=${B}"></a></span></div>`,
  );
  arrange(doc);
  win.addMessage = () => undefined;
  const logged = console.error;
  /** @type {unknown[]} */
  const logs = [];
  console.error = (/** @type {unknown} */ m) => logs.push(m);
  try {
    await startTagging({ win, doc, css: '', indexedDB: new IDBFactory(), openSmileyPicker: () => () => {} });
    await settle();
    for (const img of doc.querySelectorAll('img.tdf-posted')) {
      img.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    }
    await settle();
  } finally {
    console.error = logged;
  }
  return { logs, notices: [...doc.querySelectorAll('.tdf-notice')].map((n) => n.textContent) };
}

test('a like hidden in the fallback colour is reported once, with its reason', async () => {
  const { logs, notices } = await likeTwice(() => {});
  const text = `Image reactions: likes hide their token in ${FALLBACK_TOKEN_BG}, which may show: the native chat (#chatContainer) is missing`;
  assert.deepEqual(logs, [text]);
  assert.deepEqual(notices, [text]);
});

test('a readable chat background reports nothing', async () => {
  const { logs, notices } = await likeTwice((doc) =>
    doc.body.insertAdjacentHTML('beforeend', '<div id="chatContainer" style="background-color: #eeeeee"></div>'),
  );
  assert.deepEqual(logs, []);
  assert.deepEqual(notices, []);
});
