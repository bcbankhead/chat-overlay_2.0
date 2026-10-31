import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { build } from '../build.mjs';
import { CLOAK_FADE_MS, CLOAK_ID, CLOAK_MS } from '../src/core/cloak.js';
import { DB_VERSION, openDb } from '../src/core/db.js';
import { createSettings } from '../src/core/settings.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settle = () => new Promise((r) => setTimeout(r, 50));

/**
 * A page with the engine's globals, a shared IndexedDB, and the built userscript loaded.
 * `early` messages are polled right after the script runs, while its startup is still async.
 * `noBody` makes document.body read as null when the script runs, as in <head> before the body
 * is parsed; `beforeEval` runs just before the script does.
 */
async function page(
  bundle,
  indexedDB,
  { body, omit = [], globals = {}, early = [], loading = false, noBody = false, beforeEval } = {},
) {
  const window = new Window({ url: 'https://chat.example.com/forum/chat/' });
  const { document } = window;
  if (loading) Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
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
  if (noBody) Object.defineProperty(document, 'body', { get: () => null, configurable: true });
  beforeEval?.(window);
  window.eval(bundle);
  if (early.length) poll(...early);
  await settle();
  return { window, document, poll };
}

/**
 * The site include placed in <head>: the script runs while the document is still loading and
 * the body has not been parsed, so document.body is null. `ready()` parses the body and fires
 * DOMContentLoaded, then the engine's polling, which renders `onload` messages. `load()`
 * fires window load. happy-dom fires its own as soon as the window is created, long before a
 * real page's images and adverts would let it; that one is held back from the script.
 */
async function headPage(bundle, indexedDB, { body, globals = {}, onload = [], beforeEval } = {}) {
  let loading = true;
  const holdLoad = (window) => {
    window.addEventListener('load', (event) => loading && event.stopImmediatePropagation());
    beforeEval?.(window);
  };
  const shell = await page(bundle, indexedDB, { body: '', globals, loading: true, noBody: true, beforeEval: holdLoad });
  const { window, document, poll } = shell;
  const ready = async () => {
    delete (/** @type {any} */ (document)).body;
    document.body.innerHTML =
      body ??
      '<div id="chatContainer" style="height:300px"></div><input type="checkbox" id="autoScrollID" checked>' +
        '<div id="userContainer"></div><textarea id="optionsBar"></textarea>';
    Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    if (onload.length) poll(...onload);
    await settle();
  };
  const load = async () => {
    loading = false;
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    window.dispatchEvent(new window.Event('load'));
    await settle();
  };
  return { ...shell, ready, load };
}

/**
 * Whether the pre-mount cloak is still hiding the body. Once lifted it stays a moment longer
 * while the body fades in, then goes.
 */
const cloaked = (document) => /body \{ opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; \}/.test(document.getElementById(CLOAK_ID)?.textContent ?? '');
/**
 * The text of the bootstrap's banners, which sit directly on <body> (the rail keeps a
 * role="status" box of its own). Strings, so a failed assertion never inspects a DOM node.
 */
const banners = (document) =>
  [...(document.body?.children ?? [])].filter((el) => el.getAttribute('role') === 'status').map((el) => el.textContent);

/** The ids of the overlay's rendered messages, in order. */
const shownIds = (document) => [...document.querySelectorAll('#tdf-chat .tdf-msg[data-id]')].map((el) => el.dataset.id);

const um = (id, user, text, mTime) =>
  `${id}}{9}{chatContainer}{${user}}{}{${encodeURI(`av.gif|#ff0000|20px|georgia|${text}|0|0`)}}{x}{beep_high.mp3}{${mTime}`;

/** @type {{ userscript: string, include: string } | undefined} */
let built;
async function outputs() {
  if (!built) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tdf-smoke-'));
    const { outputs: files } = await build({ match: 'https://chat.example.com/forum/chat/*', root: repo, outfile: path.join(dir, 'tdf-chat.user.js') });
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
  // #ff0000 is under 4.5:1 on both backgrounds: darker on light, lighter on dark.
  assert.equal(line.style.getPropertyValue('--tdf-ink-light'), '#ec0000');
  assert.equal(line.style.getPropertyValue('--tdf-ink-dark'), '#ff2117');
  assert.equal(line.style.fontFamily, '');
  assert.equal(line.style.fontSize, '');

  // With no stored choice <html> follows the system; the overlay has no theme button, and
  // its list has a floating scrollbar.
  assert.equal(first.document.documentElement.dataset.tdfTheme, 'light');
  assert.equal(overlay.querySelector('.tdf-theme-toggle'), null);
  const list = overlay.querySelector('.tdf-list');
  assert.ok(list.classList.contains('tdf-scroll'));
  assert.ok(list.nextElementSibling.classList.contains('tdf-thumb'));
  // The scrollbar was attached before the overlay was inserted; its stylesheet position stands.
  assert.equal(overlay.style.position, '');

  // A second copy of the script (userscript + site include) does nothing.
  first.window.eval(bundle);
  await settle();
  assert.equal(first.document.querySelectorAll('#tdf-chat').length, 1);

  // A stored choice applies after a reload.
  const db = await openDb({ indexedDB });
  await createSettings(db).set('theme', 'dark');
  db.close();

  const second = await page(bundle, indexedDB);
  const replayed = [...second.document.querySelectorAll('#tdf-chat .tdf-msg')].map((el) => el.dataset.id);
  assert.deepEqual(replayed, ['1', '2']);
  assert.equal(second.document.documentElement.dataset.tdfTheme, 'dark');
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

test('with Chat history at 0 days messages are shown but never stored, and nothing replays', async () => {
  const bundle = await bundled();
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  await createSettings(db).set('retentionDays', 0);
  const count = () =>
    new Promise((resolve) => {
      const req = db.transaction('messages').objectStore('messages').count();
      req.onsuccess = () => resolve(req.result);
    });

  const first = await page(bundle, indexedDB);
  first.poll(um('1', 'bob', 'hello', '100'));
  await settle();
  assert.deepEqual(shownIds(first.document), ['1']);
  assert.equal(await count(), 0);

  // A line stored before the 0 was set is not replayed.
  const t = db.transaction('messages', 'readwrite');
  t.objectStore('messages').put({
    id: 'legacy', roomID: '1', mTime: '99', user: 'bob', toUser: '', kind: 'public', avatar: '', color: '',
    size: '', family: '', text: 'old', ircFlag: '0', lineBreakFlag: '0', receivedAt: Date.now(), orderKey: 99_000,
  });
  await new Promise((resolve) => (t.oncomplete = resolve));
  db.close();
  const second = await page(bundle, indexedDB);
  assert.deepEqual(shownIds(second.document), []);
});

test('a stored record that will not render is skipped with a notice; the rest replay', async () => {
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  const base = { roomID: '1', mTime: '', user: 'bob', toUser: '', kind: 'public', avatar: '', color: '', size: '', family: '', ircFlag: '0', lineBreakFlag: '0' };
  // Recent, so the default 30-day Chat history limit (features/options) keeps them. Seeded
  // raw, so each carries the orderKey history would compute (TDF-0031).
  const now = Date.now();
  const t = db.transaction('messages', 'readwrite');
  t.objectStore('messages').put({ ...base, id: 'good', mTime: '100', text: 'fine', receivedAt: now - 2, orderKey: 100_000 });
  t.objectStore('messages').put({ ...base, id: 'bad', mTime: '101', text: 42, receivedAt: now - 1, orderKey: 101_000 });
  await new Promise((resolve) => (t.oncomplete = resolve));
  db.close();

  const { document } = await page(await bundled(), indexedDB);
  assert.deepEqual(shownIds(document), ['good']);
  assert.match(document.querySelector('#tdf-chat .tdf-notice').textContent, /1 stored message could not be shown/);
  assert.equal(document.getElementById('chatContainer').style.visibility, 'hidden');
});

test('a later version opened in another tab shows one notice to reload', async () => {
  const indexedDB = new IDBFactory();
  const { document, poll } = await page(await bundled(), indexedDB);
  const req = indexedDB.open('tdf-chat-2', DB_VERSION + 1);
  let blocked = false;
  req.onblocked = () => {
    blocked = true;
  };
  await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result.close());
    req.onerror = () => reject(req.error);
  });
  assert.equal(blocked, false);
  poll(um('1', 'bob', 'after', '100'), um('2', 'carol', 'again', '101'));
  await settle();
  const notices = [...document.querySelectorAll('#tdf-chat .tdf-notice')].map((el) => el.textContent);
  assert.equal(notices.filter((t) => /updated in another tab; reload this tab/.test(t)).length, 1);
  assert.deepEqual(shownIds(document), ['1', '2']);
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
  assert.equal(document.documentElement.dataset.tdfTheme, undefined, 'the page is not left themed');
  assert.equal(document.getElementById('chatContainer').style.visibility, '');
  assert.match(document.querySelector('[role="status"]').textContent, /did not start \(observer broke\); showing the original chat/);
});

test('a successful start publishes the avatar resolver for the rail and the profile flyout', async () => {
  const { window } = await page(await bundled(), new IDBFactory());
  assert.ok(window.document.getElementById('tdf-chat'), 'overlay mounted');
  assert.equal(typeof window.__tdfChat2Avatars?.resolve, 'function');
});

test('a start that fails after the avatar resolver is published removes it', async () => {
  const globals = {
    ResizeObserver: class {
      constructor() {
        throw new Error('observer broke');
      }
    },
  };
  const { window, document } = await page(await bundled(), new IDBFactory(), { globals });
  assert.match(document.querySelector('[role="status"]').textContent, /did not start \(observer broke\)/);
  assert.equal('__tdfChat2Avatars' in window, false);
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

test('from <head>, nothing mounts while loading, everything mounts at DOMContentLoaded, and the page fades in after load', async () => {
  const indexedDB = new IDBFactory();
  const head = await headPage(await included(), indexedDB, { onload: [um('1', 'bob', 'at onload', '100')] });
  const { document } = head;
  assert.equal(head.window.__tdfChat2Loaded, true);
  assert.equal(document.getElementById('tdf-chat') === null, true);
  assert.equal(cloaked(document), true, 'cloaked while loading');
  assert.deepEqual(banners(document), []);

  await head.ready();
  assert.ok(document.getElementById('tdf-chat'), 'overlay mounted');
  assert.ok(document.getElementById('tdf-rail'), 'rail mounted');
  assert.ok(document.getElementById('tdf-composer-style'), 'composer installed');
  for (const feature of ['gallery', 'options', 'tagging']) {
    assert.ok(document.getElementById(`tdf-${feature}-style`), `${feature} started`);
  }
  assert.equal(cloaked(document), true, 'still cloaked: every feature is ready, but the engine has not laid the page out');
  assert.deepEqual(banners(document), []);
  assert.deepEqual(shownIds(document), ['1'], 'the onload message is shown');

  // The engine's own onload, assigned after the include ran, runs before the reveal.
  let laidOut = false;
  head.window.addEventListener('load', () => (laidOut = true));
  await head.load();
  assert.equal(laidOut, true);
  assert.equal(cloaked(document), false, 'revealed after window load');
  assert.ok(document.getElementById(CLOAK_ID), 'fading in');
  await new Promise((r) => setTimeout(r, CLOAK_FADE_MS + 40));
  assert.equal(document.getElementById(CLOAK_ID), null, 'removed after the fade');

  const again = await page(await included(), indexedDB);
  assert.deepEqual(shownIds(again.document), ['1'], 'and stored');
});

test('from <head>, a start that never reports ready is shown by the failsafe, which names what is pending', async () => {
  // An open that never answers: the core and the features with their own database hang.
  const hung = { open: () => ({}) };
  /** @type {Array<() => void>} */
  const failsafe = [];
  const warnings = [];
  const head = await headPage(await included(), hung, {
    beforeEval: (window) => {
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => (ms === CLOAK_MS ? (failsafe.push(fn), 0) : setTimeout(fn, ms, ...rest));
      window.console.warn = (...args) => warnings.push(args.join(' '));
    },
  });
  await head.ready();
  await head.load();
  assert.equal(cloaked(head.document), true, 'window load alone does not reveal it');
  assert.equal(failsafe.length, 1);
  failsafe[0]();
  assert.equal(cloaked(head.document), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /still starting after 8 s \(waiting on core, [^)]*\); showing the page\./);
  for (const name of ['tagging', 'rail']) assert.ok(warnings[0].includes(name), `${name} named`);
  assert.doesNotMatch(warnings[0], /window load/);
});

test('from <head>, with every feature ready but no window load, the failsafe names the load', async () => {
  /** @type {Array<() => void>} */
  const failsafe = [];
  const warnings = [];
  const head = await headPage(await included(), new IDBFactory(), {
    beforeEval: (window) => {
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => (ms === CLOAK_MS ? (failsafe.push(fn), 0) : setTimeout(fn, ms, ...rest));
      window.console.warn = (...args) => warnings.push(args.join(' '));
    },
  });
  await head.ready();
  assert.equal(cloaked(head.document), true);
  failsafe[0]();
  assert.equal(cloaked(head.document), false);
  assert.match(warnings[0], /\(waiting on window load\)/);
});

test('from <head>, a feature that will not start does not hold the reveal', async () => {
  // No user list, so no rail; and a composer whose start throws.
  const head = await headPage(await included(), new IDBFactory(), {
    body: '<div id="chatContainer" style="height:300px"></div><input type="checkbox" id="autoScrollID" checked><textarea id="optionsBar"></textarea>',
    beforeEval: (window) => {
      const append = window.document.head.appendChild.bind(window.document.head);
      window.document.head.appendChild = (node) => {
        if (node.id === 'tdf-composer-style') throw new Error('composer broke');
        return append(node);
      };
    },
  });
  await head.ready();
  assert.ok(head.document.getElementById('tdf-chat'), 'overlay mounted');
  assert.equal(head.document.getElementById('tdf-rail'), null);
  assert.equal(cloaked(head.document), true);
  await head.load();
  assert.equal(cloaked(head.document), false);
});

test('from <head>, a participant that reports ready after window load still reveals the page', async () => {
  // Every database open succeeds only once released, so the core is still pending at load.
  const real = new IDBFactory();
  /** @type {Array<() => void>} */
  const held = [];
  let holding = true;
  const indexedDB = {
    open(...args) {
      const req = real.open(...args);
      const dispatch = req.dispatchEvent.bind(req);
      req.dispatchEvent = (event) => (holding && event.type === 'success' ? (held.push(() => dispatch(event)), true) : dispatch(event));
      return req;
    },
  };
  /** @type {Array<() => void>} */
  const failsafe = [];
  const head = await headPage(await included(), indexedDB, {
    beforeEval: (window) => {
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => (ms === CLOAK_MS ? (failsafe.push(fn), 0) : setTimeout(fn, ms, ...rest));
    },
  });
  await head.ready();
  await head.load();
  assert.ok(held.length > 0, 'an open is held');
  assert.equal(head.document.getElementById('tdf-chat'), null, 'the core is still pending');
  assert.equal(cloaked(head.document), true, 'load alone does not reveal it');

  holding = false;
  for (const fn of held.splice(0)) fn();
  await settle();
  assert.ok(head.document.getElementById('tdf-chat'), 'overlay mounted');
  assert.equal(cloaked(head.document), false, 'revealed once the last participant reported');
  assert.equal(failsafe.length, 1, 'the failsafe was armed but never ran');
});

for (const { feature, hook } of [
  { feature: 'tagging', hook: 'append' },
  { feature: 'gallery', hook: 'append' },
  { feature: 'options', hook: 'append' },
  { feature: 'rail', hook: 'roomIcon' },
]) {
  test(`from <head>, a ${feature} start that throws does not hold the reveal`, async () => {
    let thrown = false;
    const fail = () => {
      thrown = true;
      throw new Error(`${feature} broke`);
    };
    /** @type {Array<() => void>} */
    const failsafe = [];
    const head = await headPage(await included(), new IDBFactory(), {
      beforeEval: (window) => {
        const { document } = window;
        const setTimeout = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...rest) => (ms === CLOAK_MS ? (failsafe.push(fn), 0) : setTimeout(fn, ms, ...rest));
        window.console.error = () => {};
        if (hook === 'append') {
          const append = document.head.appendChild.bind(document.head);
          document.head.appendChild = (node) => (node.id === `tdf-${feature}-style` ? fail() : append(node));
        } else {
          const get = document.getElementById.bind(document);
          document.getElementById = (id) => (id === 'roomIcon' ? fail() : get(id));
        }
      },
    });
    await head.ready();
    assert.equal(thrown, true, `${feature}'s start threw`);
    assert.ok(head.document.getElementById('tdf-chat'), 'overlay mounted');
    assert.equal(cloaked(head.document), true);
    await head.load();
    assert.equal(cloaked(head.document), false);
    assert.equal(failsafe.length, 1, 'the failsafe was armed but never ran');
  });
}

test('from <head>, a page with no chat container exits silently and lifts the cloak', async () => {
  const head = await headPage(await included(), new IDBFactory(), { body: '<p>login</p>' });
  assert.equal(cloaked(head.document), true);
  await head.ready();
  assert.equal(head.document.getElementById('tdf-chat') === null, true);
  assert.equal(cloaked(head.document), false);
  assert.deepEqual(banners(head.document), []);
});

test('from <head>, an unrecognised engine lifts the cloak and shows why', async () => {
  const head = await headPage(await included(), new IDBFactory(), { globals: { receiveMesReq: undefined } });
  await head.ready();
  assert.equal(cloaked(head.document), false);
  assert.match(banners(head.document).join('|'), /the chat engine was not recognised/);
});

test('from <head>, a start failure lifts the cloak and shows the banner', async () => {
  const globals = {
    ResizeObserver: class {
      constructor() {
        throw new Error('observer broke');
      }
    },
  };
  const head = await headPage(await included(), new IDBFactory(), { globals });
  await head.ready();
  assert.equal(head.document.getElementById('tdf-chat') === null, true);
  assert.equal(cloaked(head.document), false);
  assert.match(banners(head.document).join('|'), /did not start \(observer broke\)/);
});

test('an open blocked by an older build lifts the cloak and waits with a banner, then mounts', async () => {
  const indexedDB = new IDBFactory();
  // An older build's tab: a version 1 connection that does not close itself on versionchange.
  const old = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tdf-chat-2', 1);
    req.onupgradeneeded = () => {
      const v1 = req.result;
      const messages = v1.createObjectStore('messages', { keyPath: 'id' });
      for (const i of ['roomID', 'mTime', 'user', 'receivedAt']) messages.createIndex(i, i);
      messages.createIndex('roomID_receivedAt', ['roomID', 'receivedAt']);
      v1.createObjectStore('settings', { keyPath: 'key' });
      const images = v1.createObjectStore('images', { keyPath: 'id' });
      images.createIndex('user', 'user');
      images.createIndex('receivedAt', 'receivedAt');
      const tags = v1.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
      tags.createIndex('imageId', 'imageId');
      tags.createIndex('sourceMessageId', 'sourceMessageId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const head = await headPage(await included(), indexedDB);
  await head.ready();
  const { document } = head;
  assert.equal(document.getElementById('tdf-chat') === null, true);
  assert.equal(cloaked(document), false, 'the original chat shows while waiting');
  assert.match(banners(document).join('|'), /waiting for another TDF Chat tab to close/);
  head.poll(um('1', 'bob', 'while blocked', '100'));

  old.close();
  await settle();
  assert.ok(document.getElementById('tdf-chat'), 'mounted once the blocker closed');
  assert.deepEqual(banners(document), [], 'banner removed');
  assert.deepEqual(shownIds(document), ['1'], 'the message polled while blocked is shown');

  const again = await page(await included(), indexedDB);
  assert.deepEqual(shownIds(again.document), ['1'], 'and stored');
});

test('two tabs on the same build both mount with no wait, and both keep storing', async () => {
  const indexedDB = new IDBFactory();
  const a = await page(await included(), indexedDB);
  const b = await page(await included(), indexedDB);
  for (const tab of [a, b]) {
    assert.ok(tab.document.getElementById('tdf-chat'));
    assert.deepEqual(banners(tab.document), []);
  }
  a.poll(um('1', 'bob', 'from a', '100'));
  b.poll(um('2', 'carol', 'from b', '101'));
  await settle();
  const c = await page(await included(), indexedDB);
  assert.deepEqual(shownIds(c.document), ['1', '2']);
});

test('placed at the end of the body the include still mounts without a cloak', async () => {
  // A classic script at the end of the body runs while the document is still loading, with
  // the chat markup already parsed.
  let added = false;
  const shell = await page(await included(), new IDBFactory(), {
    loading: true,
    beforeEval: (window) => {
      new window.MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n.id === CLOAK_ID) added = true;
      }).observe(window.document.documentElement, { childList: true, subtree: true });
    },
  });
  const { window, document } = shell;
  assert.equal(cloaked(document), false, 'not cloaked while loading');
  Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  assert.ok(document.getElementById('tdf-chat'), 'overlay mounted');
  assert.equal(cloaked(document), false);
  assert.equal(added, false, 'no cloak was ever inserted');
});
