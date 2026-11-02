import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
// The browser's IDBKeyRange global, which limits.js uses.
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { onDeleted } from '../../core/events.js';
import { createSettings } from '../../core/settings.js';
import { listPanels } from '../rail/api.js';
import { startSettings } from './start.js';

const settle = () => new Promise((r) => setTimeout(r, 50));

/** Resolves once `check` holds, polling; fails after about two seconds. */
async function until(/** @type {() => Promise<boolean> | boolean} */ check) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await settle();
  }
  assert.fail('condition never held');
}

/** A database holding one room of 26 lines, the oldest `old`, and the given settings. */
async function seeded(values = {}) {
  const indexedDB = new IDBFactory();
  const db = await openDb({ indexedDB });
  const settings = createSettings(db);
  for (const [key, value] of Object.entries(values)) await settings.set(/** @type {any} */ (key), value);
  const now = Date.now();
  const base = { roomID: '1', user: 'a', text: 'x' };
  await new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readwrite');
    t.objectStore('messages').put({ ...base, id: 'old', mTime: '1', receivedAt: now, orderKey: 1 });
    for (let i = 0; i < 25; i++) {
      t.objectStore('messages').put({ ...base, id: `n${String(i).padStart(2, '0')}`, mTime: String(10 + i), receivedAt: now, orderKey: 10 + i });
    }
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  db.close();
  return indexedDB;
}

/** @param {IDBFactory} indexedDB */
async function storedIds(indexedDB) {
  const db = await openDb({ indexedDB });
  const ids = await new Promise((resolve, reject) => {
    const req = db.transaction('messages').objectStore('messages').getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return ids;
}

const settingsPanel = () => listPanels().find((p) => p.id === 'settings');

test('start registers the Settings gear at the end of the icon row and opens the flyout', async () => {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  startSettings({ win, doc, css: '/* options */', indexedDB: await seeded() });
  assert.equal(doc.getElementById('tdf-options-style')?.textContent, '/* options */');
  const panel = settingsPanel();
  assert.ok(panel);
  assert.equal(panel.title, 'Settings');
  assert.equal(panel.align, 'end');
  assert.ok(panel.icon.startsWith('<svg'));

  const body = doc.createElement('div');
  const cleanup = panel.render(body);
  await settle();
  assert.equal(body.querySelector('.tdf-opt-title')?.textContent, 'Settings');
  // Unbuilt, the version is 'dev'; the build defines the real one.
  assert.equal(body.querySelector('.tdf-opt-version-num')?.textContent, 'vdev');
  const history = [...body.querySelectorAll('label.tdf-opt-row')].find((r) => r.textContent === 'Chat history (last 25)');
  assert.equal(/** @type {HTMLInputElement} */ (history?.querySelector('input')).checked, true, 'on by default');
  if (typeof cleanup === 'function') cleanup();
});

test('the load-time limits leave stored history to bootstrap, which bounds it before replay (TDF-0057)', async (t) => {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  const indexedDB = await seeded();
  /** @type {string[][]} */
  const deleted = [];
  t.after(onDeleted((ids) => deleted.push(ids)));
  startSettings({ win, doc, css: '', indexedDB });
  doc.body.innerHTML = '<div id="tdf-chat"><div class="tdf-list"></div></div>';
  await settle();
  await settle();
  // A prune here would run after replay and could remove rows already shown.
  assert.equal((await storedIds(indexedDB)).length, 26);
  assert.deepEqual(deleted, []);
});

test('a load-time limit that fails is shown at the top of the flyout', async () => {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  doc.body.innerHTML = '<div id="tdf-chat"></div>';
  // The gallery limit's read refuses to run.
  const indexedDB = await seeded({ galleryLimitMB: 1 });
  const store = /** @type {any} */ (globalThis).IDBObjectStore.prototype;
  const getAll = store.getAll;
  const logged = console.error;
  /** @type {unknown[][]} */
  const errors = [];
  console.error = (...args) => errors.push(args);
  store.getAll = () => {
    throw new Error('read refused');
  };
  try {
    startSettings({ win, doc, css: '', indexedDB });
    await until(() => errors.length > 0);
  } finally {
    console.error = logged;
    store.getAll = getAll;
  }
  const body = doc.createElement('div');
  settingsPanel()?.render(body);
  await settle();
  const warn = body.querySelector('.tdf-opt-title + .tdf-opt-hint.tdf-warn');
  assert.match(String(warn?.textContent), /^The storage limits did not run on load: .*read refused/);
  assert.doesNotMatch(String(warn?.textContent), /IDBKeyRange is not defined/);
});

test('a database that will not open is said in the flyout', async () => {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  const broken = /** @type {any} */ ({
    open() {
      throw new Error('blocked by the browser');
    },
  });
  const logged = console.error;
  /** @type {unknown[][]} */
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    startSettings({ win, doc, css: '', indexedDB: broken });
    await until(() => errors.length > 0);
  } finally {
    console.error = logged;
  }
  const body = doc.createElement('div');
  settingsPanel()?.render(body);
  await settle();
  assert.equal(body.textContent, 'Settings could not open: blocked by the browser');
});
