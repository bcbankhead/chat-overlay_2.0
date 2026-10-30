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
  const ready = startTagging({
    win,
    doc,
    css: '/* tagging */',
    indexedDB: new IDBFactory(),
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

  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await settle();
  // happy-dom computes no background for the chat, so the fallback colour hides the token.
  assert.deepEqual(sent, [`:h [[span style=color:${FALLBACK_TOKEN_BG}]]^111111[[/span]]`]);
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

test('an own message spaces the next reaction; an echo core marks unconfirmed stops counting', async (t) => {
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
  await startTagging({ win, doc, css: '', indexedDB });
  await settle();
  assert.deepEqual(hearts(), ['♥1']);

  // Your own message just now: the reaction waits the whole interval after it.
  emitInbound(record('local-2', 'me', 'hello', 4, { mTime: '' }));
  win.addMessage = () => false;
  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal(held.length, 1);
  assert.ok(held[0].ms > 14_000 && held[0].ms <= 15_000, String(held[0].ms));

  // The earlier reaction's send failed meanwhile: core marks it and announces the change.
  await history.markUnconfirmed('local-1');
  emitConfirmChange({ roomID: '1', ids: ['local-1'], confirm: 'unconfirmed' });
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
    await assert.rejects(startTagging({ win, doc, css: '', indexedDB }));
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
  await startTagging({ win, doc, css: '', indexedDB });
  await settle();
  assert.deepEqual(hearts(), ['♥1']);
});

test('the token colour is the native chat background: #chatContainer, else an opaque ancestor, .body only unthemed', () => {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  doc.body.innerHTML = '<div class="body" style="background-color: #fbfbff"><div id="wrap"><div id="chatContainer"></div></div></div>';
  const chat = doc.getElementById('chatContainer');
  const wrap = doc.getElementById('wrap');
  assert.equal(nativeChatBackground(doc, win), '#fbfbff', '.body, before the theme overrides it');
  doc.head.insertAdjacentHTML('beforeend', '<style id="tdf-chat-style">.body { background-color: #dadae6 !important; }</style>');
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
  await startTagging({ win, doc, css: '', indexedDB: new IDBFactory() });
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
  doc.head.insertAdjacentHTML('beforeend', '<style id="tdf-chat-style"></style>');
  assert.equal(nativeChatBackground(doc, win, onFallback), FALLBACK_TOKEN_BG);
  doc.getElementById('chatContainer').style.backgroundColor = '#abc';
  assert.equal(nativeChatBackground(doc, win, onFallback), '#aabbcc');
  doc.body.innerHTML = '';
  assert.equal(nativeChatBackground(doc, win, onFallback), FALLBACK_TOKEN_BG);
  assert.deepEqual(reasons, [
    'the chat background is transparent',
    'the chat background is transparent up to .body',
    'the native chat (#chatContainer) is missing',
  ]);
});

/**
 * Right-clicks two images, so two likes take their token colour.
 * @param {(doc: Document) => void} arrange
 * @param {(doc: Document) => void} [started]  run once tagging has started
 */
async function likeTwice(arrange, started = () => {}) {
  const { win, doc } = chatPage();
  const B = '100000000222222';
  doc.querySelector('.tdf-list').insertAdjacentHTML(
    'beforeend',
    `<div class="tdf-msg tdf-kind-public" data-id="2"><span class="tdf-body"><a href="plugins/share/view.php?id=${B}"><img class="tdf-posted" src="plugins/share/view.php?id=${B}"></a></span></div>`,
  );
  arrange(doc);
  /** @type {string[]} */
  const sent = [];
  win.addMessage = (/** @type {string} */ input) => (sent.push(doc.getElementById(input).value), undefined);
  const logged = console.error;
  /** @type {unknown[]} */
  const logs = [];
  console.error = (/** @type {unknown} */ m) => logs.push(m);
  try {
    const ready = startTagging({ win, doc, css: '', indexedDB: new IDBFactory() });
    started(doc);
    await ready;
    await settle();
    for (const img of doc.querySelectorAll('img.tdf-posted')) {
      img.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    }
    await settle();
  } finally {
    console.error = logged;
  }
  return { logs, sent, notices: [...doc.querySelectorAll('.tdf-notice')].map((n) => n.textContent) };
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

test("the token colour is .body's native background, read before the view's theme overrides it", async () => {
  const { logs, notices, sent } = await likeTwice((doc) => {
    doc.body.insertAdjacentHTML('beforeend', '<div class="body" style="background-color: #fbfbff"><div id="chatContainer"></div></div>');
  }, (doc) => {
    doc.head.insertAdjacentHTML('beforeend', '<style id="tdf-chat-style">.body { background-color: #dadae6 !important; }</style>');
  });
  assert.deepEqual(sent, [':h [[span style=color:#fbfbff]]^111111[[/span]]']);
  assert.deepEqual(logs, []);
  assert.deepEqual(notices, []);
});

test('a chat background unreadable at start is read again when a like sends', async () => {
  const { logs, sent } = await likeTwice(() => {}, (doc) => {
    doc.body.insertAdjacentHTML('beforeend', '<div id="chatContainer" style="background-color: #eeeeee"></div>');
  });
  assert.deepEqual(sent, [':h [[span style=color:#eeeeee]]^111111[[/span]]']);
  assert.deepEqual(logs, []);
});

test('a like, made or arriving live, floats hearts over the page', async () => {
  const { win, doc } = chatPage();
  win.matchMedia = () => ({ matches: false });
  win.innerWidth = 1024;
  win.innerHeight = 768;
  const rect = { left: 100, top: 200, right: 140, bottom: 220, width: 40, height: 20, x: 100, y: 200 };
  win.Element.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  win.addMessage = () => undefined;
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await startTagging({ win, doc, css: '', indexedDB });
  await settle();
  const floating = () => doc.querySelectorAll('body > .tdf-hearts-float').length;
  doc.querySelector('img.tdf-posted').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.ok(floating() > 0, 'a right-click floats hearts');
  for (const heart of doc.querySelectorAll('.tdf-hearts-float')) heart.remove();
  emitInbound(record('5', 'bob', ':h ^111111', 5, { receivedAt: Date.now() }));
  await settle();
  assert.ok(floating() > 0, 'a live like floats hearts');
});

test('a pending echo core expires while the first rebuild reads stops counting', async () => {
  const { win, doc, hearts } = chatPage();
  const indexedDB = new IDBFactory();
  const history = createHistory(await openDb({ indexedDB }));
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1));
  await history.addPending(record('local-1', 'me', ':h ^111111', 2, { mTime: '' }));
  const started = startTagging({ win, doc, css: '', indexedDB });
  // As bootstrap does: expirePending commits, then the change is announced, whichever of the
  // two the tagging read sees first.
  await history.markUnconfirmed('local-1');
  emitConfirmChange({ roomID: '1', ids: ['local-1'], confirm: 'unconfirmed' });
  await started;
  await settle();
  assert.deepEqual(hearts(), []);
});

test('a Storage limit prune is not undone by the next reaction change', async () => {
  const { win, doc, hearts } = chatPage();
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  const history = createHistory(db);
  const now = Date.now();
  const day = 86_400_000;
  // Two posts of the image: the first, and bob's like of it, are past the limit.
  await history.put(record('1', 'alice', `[[img src="plugins/share/view.php?id=${A}"]]`, 1, { receivedAt: now - 4 * day }));
  await history.put(record('2', 'bob', ':h', 2, { receivedAt: now - 3 * day }));
  await history.put(record('3', 'dave', `[[img src="plugins/share/view.php?id=${A}"]]`, 3, { receivedAt: now - 1000 }));
  await startTagging({ win, doc, css: '', indexedDB });
  await settle();
  assert.deepEqual(hearts(), ['♥1']);

  const gallery = { usage: async () => ({ used: 0, preview: null }), enforceLimit: async () => [] };
  assert.deepEqual(await createLimits({ db, gallery }).pruneHistory(2), ['1', '2']);
  await settle();
  assert.deepEqual(hearts(), []);
  // A later reaction re-derives and persists the room: bob's pruned :h stays gone.
  emitInbound(record('4', 'carol', ':d', 4, { receivedAt: now }));
  await settle();
  /** @type {Array<{ sender: string }>} */
  const rows = await request(db.transaction(STORES.tags).objectStore(STORES.tags).getAll());
  assert.deepEqual(rows.map((r) => r.sender), ['carol']);
  assert.deepEqual(hearts(), ['♥1']);
});
