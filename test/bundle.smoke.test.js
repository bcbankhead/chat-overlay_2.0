import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { build } from '../build.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settle = () => new Promise((r) => setTimeout(r, 50));

/** A page with the engine's globals, a shared IndexedDB, and the built userscript loaded. */
async function page(bundle, indexedDB, { body, omit = [] } = {}) {
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
  for (const key of omit) delete window[key];
  window.eval(bundle);
  await settle();
  const poll = (...raw) => {
    window.receiveMesReq.responseXML = { getElementsByTagName: () => raw.map((textContent) => ({ textContent })) };
    window.handleMessages();
  };
  return { window, document, poll };
}

const um = (id, user, text, mTime) =>
  `${id}}{9}{chatContainer}{${user}}{}{${encodeURI(`av.gif|#ff0000|20px|georgia|${text}|0|0`)}}{x}{beep_high.mp3}{${mTime}`;

let built;
async function bundled() {
  if (!built) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tdf-smoke-'));
    const outfile = path.join(dir, 'tdf-chat.user.js');
    await build({ root: repo, outfile });
    built = readFileSync(outfile, 'utf8');
    rmSync(dir, { recursive: true, force: true });
  }
  return built;
}

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
