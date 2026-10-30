import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { emitInbound, emitLiked } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { createSettings } from '../../core/settings.js';
import { installRailHost, listPanels, listUserMenuActions } from '../rail/api.js';
import { clearGalleryErrors } from './errors.js';
import { startGallery } from './start.js';

const settle = () => new Promise((r) => setTimeout(r, 50));
const ID = '123456789012345';

test('start wires capture, the Gallery panel and the "View images" menu action', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  /** @type {string[]} */
  const fetched = [];
  win.fetch = async (/** @type {string} */ url) => {
    fetched.push(String(url));
    return new Response(new Blob([new Uint8Array(10)]), { headers: { 'content-type': 'image/png' } });
  };
  const logged = console.error;
  console.error = () => {};
  try {
    const indexedDB = new IDBFactory();
    startGallery({ win, doc, css: '/* gallery */', indexedDB });
    assert.equal(doc.getElementById('tdf-gallery-style')?.textContent, '/* gallery */');

    // Another member's live share is not captured; liking it captures it, from its stored record.
    const record = /** @type {any} */ ({ id: '7', roomID: '1', mTime: '100', user: 'alice', receivedAt: 1, text: `[[img src="plugins/share/view.php?id=${ID}"]]` });
    await createHistory(await openDb({ indexedDB })).put(record);
    emitInbound(record);
    await settle();
    assert.deepEqual(fetched, []);
    emitLiked({ shareId: ID, messageId: '7', user: 'alice', mTime: '100' });
    await settle();
    assert.deepEqual(fetched, [`https://chat.example.com/forum/chat/plugins/share/view.php?id=${ID}`]);

    const panel = listPanels().find((p) => p.id === 'gallery');
    assert.ok(panel);
    assert.equal(panel.title, 'Gallery');
    assert.ok(panel.icon.startsWith('<svg'));
    const body = doc.createElement('div');
    const cleanup = panel.render(body);
    await settle();
    assert.deepEqual([...body.querySelectorAll('.tdf-gallery-tile')].map((t) => /** @type {HTMLElement} */ (t).dataset.id), [ID]);
    if (typeof cleanup === 'function') cleanup();

    /** @type {unknown[]} */
    const opened = [];
    const uninstall = installRailHost({ open: (p, arg) => opened.push([p.id, arg]), report: () => {} });
    const user = { uuID: '9', name: 'bob b', rawName: 'bob%20b', roomID: '1', userID: '2', avatar: '', block: '1', ip: '', statusText: '' };
    const action = listUserMenuActions(user, () => {}).find((a) => a.id === 'gallery-view-images');
    assert.equal(action?.label, 'View images');
    action?.run(user);
    uninstall();
    assert.deepEqual(opened, [['gallery', { user: 'bob%20b', label: 'bob b' }]]);
  } finally {
    console.error = logged;
    clearGalleryErrors();
  }
});

test('with Include my images on, only the signed-in user\'s own share, named by win.userName, is captured as posted', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  win.userName = 'me';
  /** @type {string[]} */
  const fetched = [];
  win.fetch = async (/** @type {string} */ url) => {
    fetched.push(String(url));
    return new Response(new Blob([new Uint8Array(10)]), { headers: { 'content-type': 'image/png' } });
  };
  const logged = console.error;
  console.error = () => {};
  try {
    const indexedDB = new IDBFactory();
    await createSettings(await openDb({ indexedDB })).set('includeMyImages', true);
    startGallery({ win, doc: win.document, css: '', indexedDB });
    const share = (/** @type {string} */ id, /** @type {string} */ user) =>
      emitInbound(/** @type {any} */ ({ id, roomID: '1', mTime: '100', user, receivedAt: 1, text: `[[img src="plugins/share/view.php?id=${id}00000000000"]]` }));
    share('1111', 'me');
    share('2222', 'alice');
    await settle();
    assert.deepEqual(fetched, ['https://chat.example.com/forum/chat/plugins/share/view.php?id=111100000000000']);
  } finally {
    console.error = logged;
    clearGalleryErrors();
  }
});
