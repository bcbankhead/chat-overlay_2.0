import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { build } from '../build.mjs';
import { openDb } from '../src/core/db.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settle = () => new Promise((r) => setTimeout(r, 50));

/**
 * A page with the engine's globals, a shared IndexedDB, and the built userscript loaded.
 * `early` messages are polled right after the script runs, while its startup is still async.
 */
async function page(bundle, indexedDB, { body, omit = [], globals = {}, early = [] } = {}) {
  const window = new Window({ url: 'https://dollforum.com/forum/chat/' });
  const { document } = window;
  document.body.innerHTML =
    body ?? '<div id="chatContainer" style="height:300px"></div><input type="checkbox" id="autoScrollID" checked>';
  Object.assign(window, {
    indexedDB,
    IDBKeyRange,
    roomID: 1,
    userName: 'alice',
    showMessages: 0,
    publicEntry: 'has joined the room ...',
    publicExit: 'has left the room ...',
    receiveMesReq: { readyState: 4, responseXML: null },
    createMessageDiv(mStatus, mUID, mDiv, mID, message, sfx, mUser, mToUser, mTime) {
      const div = document.createElement('div');
      div.id = mTime;
      document.getElementById(mDiv).appendChild(div);
      window.showMessages += 1;
    },
    handleMessages() {
      for (const node of window.receiveMesReq.responseXML.getElementsByTagName('usermessage')) {
        const f = node.textContent.split('}{');
        window.createMessageDiv('0', f[1], f[2], window.showMessages + 1, f[5], f[7], f[3], f[4], f[8]);
      }
    },
  });
  Object.assign(window, globals);
  for (const key of omit) delete window[key];
  const poll = (...raw) => {
    window.receiveMesReq.responseXML = { getElementsByTagName: () => raw.map((textContent) => ({ textContent })) };
    window.handleMessages();
  };
  window.eval(bundle);
  if (early.length) poll(...early);
  await settle();
  return { window, document, poll };
}

/** The ids of the overlay's rendered messages, in order. */
const shownIds = (document) => [...document.querySelectorAll('#tdf-chat .tdf-msg[data-id]')].map((el) => el.dataset.id);

const um = (id, user, text, mTime) =>
  `${id}}{9}{chatContainer}{${user}}{}{${encodeURI(`av.gif|#ff0000|20px|georgia|${text}|0|0`)}}{x}{beep_high.mp3}{${mTime}`;

/** @type {{ userscript: string, include: string } | undefined} */
let built;
async function outputs() {
  if (!built) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tdf-smoke-'));
    const { outputs: files } = await build({ root: repo, outfile: path.join(dir, 'tdf-chat.user.js') });
    built = { userscript: readFileSync(files.userscript, 'utf8'), include: readFileSync(files.include, 'utf8') };
    rmSync(dir, { recursive: true, force: true });
  }
  return built;
}
const bundled = async () => (await outputs()).userscript;
const included = async () => (await outputs()).include;

test('the built userscript overlays the chat, stores messages and replays them on reload', async () => {
  const bundle = await bundled();
  const indexedDB = new IDBFactory();

  const first = await page(bundle, indexedDB);
  const overlay = first.document.getElementById('tdf-chat');
  assert.ok(overlay, 'overlay mounted');
  assert.equal(first.document.getElementById('chatContainer').style.visibility, 'hidden');
  first.poll(um('1', 'bob', 'hello [[script]]alert(1)[[/script]]', '100'), um('2', 'carol', 'second', '101'));
  await settle();
  const entries = [...overlay.querySelectorAll('.tdf-msg')];
  assert.equal(entries.length, 2);
  assert.equal(overlay.querySelector('script'), null);
  const line = entries[0].querySelector('.tdf-line');
  assert.equal(line.style.color, '#ff0000');
  assert.equal(line.style.fontFamily, 'georgia');
  assert.equal(line.style.fontSize, '');

  // The theme toggle cycles auto → light and persists across reloads.
  const toggle = overlay.querySelector('.tdf-theme-toggle');
  assert.equal(toggle.textContent, 'Auto');
  toggle.click();
  await settle();
  assert.equal(toggle.textContent, 'Light');
  assert.equal(overlay.dataset.theme, 'light');

  // A second copy of the script (userscript + site include) does nothing.
  first.window.eval(bundle);
  await settle();
  assert.equal(first.document.querySelectorAll('#tdf-chat').length, 1);

  const second = await page(bundle, indexedDB);
  const replayed = [...second.document.querySelectorAll('#tdf-chat .tdf-msg')].map((el) => el.dataset.id);
  assert.deepEqual(replayed, ['1', '2']);
  assert.equal(second.document.querySelector('#tdf-chat .tdf-theme-toggle').textContent, 'Light');
  assert.equal(second.document.getElementById('tdf-chat').dataset.theme, 'light');
  second.poll(um('3', 'bob', 'live', '102'));
  await settle();
  const after = [...second.document.querySelectorAll('#tdf-chat .tdf-msg')].map((el) => el.dataset.id);
  assert.deepEqual(after, ['1', '2', '3']);
});

test('a page without the chat container is left alone', async () => {
  const { document } = await page(await bundled(), new IDBFactory(), { body: '<p>login</p>' });
  assert.equal(document.getElementById('tdf-chat'), null);
  assert.equal(document.querySelector('[role="status"]'), null);
});

test('an unrecognised engine shows why and leaves the chat visible', async () => {
  const { document } = await page(await bundled(), new IDBFactory(), { omit: ['receiveMesReq'] });
  assert.equal(document.getElementById('tdf-chat'), null);
  assert.equal(document.getElementById('chatContainer').style.visibility, '');
  assert.match(document.querySelector('[role="status"]').textContent, /did not start \(the chat engine was not recognised\)/);
});

test('a database that will not open shows why and leaves the chat visible', async () => {
  const broken = { open: () => { throw new Error('IndexedDB disabled'); } };
  const { document } = await page(await bundled(), broken);
  assert.equal(document.getElementById('tdf-chat'), null);
  assert.equal(document.getElementById('chatContainer').style.visibility, '');
  const banner = document.querySelector('[role="status"]');
  assert.match(banner.textContent, /did not start \(IndexedDB disabled\)/);
  banner.click();
  assert.equal(document.querySelector('[role="status"]'), null);
});

test('an own echo still pending at reload is confirmed by its server copy, stored once', async () => {
  const bundle = await bundled();
  const indexedDB = new IDBFactory();
  const first = await page(bundle, indexedDB);
  first.window.createMessageDiv('0', '9', 'chatContainer', 1, 'av.gif|#000|12px|verdana|before reload|0|0', 'beep_high.mp3', 'alice', '', '');
  await settle();
  assert.equal(first.document.querySelectorAll('#tdf-chat .tdf-pending').length, 1);

  const second = await page(bundle, indexedDB);
  assert.equal(second.document.querySelectorAll('#tdf-chat .tdf-pending').length, 1);
  second.poll(um('5', 'alice', 'before reload', '105'));
  await settle();
  assert.deepEqual(shownIds(second.document), ['5']);
  assert.equal(second.document.querySelector('#tdf-chat .tdf-pending'), null);

  const third = await page(bundle, indexedDB);
  assert.deepEqual(shownIds(third.document), ['5']);
  assert.equal(third.document.querySelector('#tdf-chat .tdf-pending, #tdf-chat .tdf-unconfirmed'), null);
  for (const { window } of [first, second, third]) await window.happyDOM.close();
});

test('a message the engine renders during startup is shown after the replay and stored', async () => {
  const bundle = await bundled();
  const indexedDB = new IDBFactory();
  const first = await page(bundle, indexedDB);
  first.poll(um('1', 'bob', 'stored', '100'));
  await settle();

  // The engine re-delivers the replayed message and a new one before startup finishes.
  const second = await page(bundle, indexedDB, { early: [um('1', 'bob', 'stored', '100'), um('2', 'carol', 'early', '101')] });
  assert.deepEqual(shownIds(second.document), ['1', '2']);

  const third = await page(bundle, indexedDB);
  assert.deepEqual(shownIds(third.document), ['1', '2']);
});

test('a stored record that will not render is skipped with a notice; the rest replay', async () => {
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  const base = { roomID: '1', mTime: '', user: 'bob', toUser: '', kind: 'public', avatar: '', color: '', size: '', family: '', ircFlag: '0', lineBreakFlag: '0' };
  const t = db.transaction('messages', 'readwrite');
  t.objectStore('messages').put({ ...base, id: 'good', mTime: '100', text: 'fine', receivedAt: 1 });
  t.objectStore('messages').put({ ...base, id: 'bad', mTime: '101', text: 42, receivedAt: 2 });
  await new Promise((resolve) => (t.oncomplete = resolve));
  db.close();

  const { document } = await page(await bundled(), indexedDB);
  assert.deepEqual(shownIds(document), ['good']);
  assert.match(document.querySelector('#tdf-chat .tdf-notice').textContent, /1 stored message could not be shown/);
  assert.equal(document.getElementById('chatContainer').style.visibility, 'hidden');
});

test('a failure after the view mounts restores the original chat, as the banner says', async () => {
  const globals = {
    ResizeObserver: class {
      constructor() {
        throw new Error('observer broke');
      }
    },
  };
  const { document } = await page(await bundled(), new IDBFactory(), { globals });
  assert.equal(document.getElementById('tdf-chat'), null);
  assert.equal(document.getElementById('tdf-chat-style'), null);
  assert.equal(document.getElementById('chatContainer').style.visibility, '');
  assert.match(document.querySelector('[role="status"]').textContent, /did not start \(observer broke\); showing the original chat/);
});

test('the site include behaves as the userscript: overlays, stores and replays', async () => {
  const include = await included();
  const indexedDB = new IDBFactory();
  const first = await page(include, indexedDB);
  assert.ok(first.document.getElementById('tdf-chat'), 'overlay mounted');
  assert.ok(first.document.getElementById('tdf-composer-style'), 'composer feature installed');
  first.poll(um('1', 'bob', 'hello', '100'));
  await settle();
  assert.deepEqual(shownIds(first.document), ['1']);

  const second = await page(include, indexedDB);
  assert.deepEqual(shownIds(second.document), ['1']);
});

test('with both the userscript and the site include on a page, the interface is created once', async () => {
  const indexedDB = new IDBFactory();
  const { window, document, poll } = await page(await bundled(), indexedDB);
  window.eval(await included());
  await settle();
  assert.equal(window.__tdfChat2Loaded, true);
  assert.equal(document.querySelectorAll('#tdf-chat').length, 1);
  assert.equal(document.querySelectorAll('#tdf-chat-style').length, 1);
  assert.equal(document.querySelectorAll('#tdf-composer-style').length, 1);
  poll(um('1', 'bob', 'once', '100'));
  await settle();
  assert.deepEqual(shownIds(document), ['1']);
  const db = await openDb({ indexedDB });
  const req = db.transaction('messages').objectStore('messages').count();
  const stored = await new Promise((resolve) => (req.onsuccess = () => resolve(req.result)));
  db.close();
  assert.equal(stored, 1);
});
