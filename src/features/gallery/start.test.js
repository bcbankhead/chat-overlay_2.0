import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { emitInbound, emitLiked } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { createSettings } from '../../core/settings.js';
import { COMPOSER_NOT_READY, installStager } from '../composer/api.js';
import { installRailHost, listPanels, listUserMenuActions } from '../rail/api.js';
import { listGalleryItemActions } from './api.js';
import { clearGalleryErrors } from './errors.js';
import { shareUrl } from './shareParse.js';
import { startGallery } from './start.js';
import { createImageStore } from './store.js';

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
    const uninstall = installRailHost({ open: (p, arg) => opened.push([p.id, arg]), close: () => {}, report: () => {} });
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

for (const on of [false, true]) {
  test(`My Images' empty state follows Include my images (${on ? 'on: no hint' : 'off: the hint'}) through start's wiring (TDF-0046)`, async () => {
    const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
    win.userName = 'me';
    const doc = win.document;
    const logged = console.error;
    console.error = () => {};
    try {
      const indexedDB = new IDBFactory();
      if (on) await createSettings(await openDb({ indexedDB })).set('includeMyImages', true);
      startGallery({ win, doc, css: '', indexedDB });
      const panel = listPanels().find((p) => p.id === 'gallery');
      assert.ok(panel);
      const body = doc.createElement('div');
      const cleanup = panel.render(body);
      await settle();
      const mine = /** @type {HTMLButtonElement} */ (body.querySelector('.tdf-gallery-minefilter'));
      assert.equal(mine.hidden, false);
      mine.click();
      await settle();
      const empty = /** @type {HTMLElement} */ (body.querySelector('.tdf-gallery-empty'));
      assert.equal(
        empty.textContent,
        on
          ? 'No images from you yet.'
          : 'No images from you yet. Include my images is off, so only images saved before it was turned off are kept.',
      );
      if (typeof cleanup === 'function') cleanup();
    } finally {
      console.error = logged;
      clearGalleryErrors();
    }
  });
}

test('with Use media quickview off, clicking a Gallery tile opens its share URL in a new tab through win.open', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  /** @type {unknown[][]} */
  const calls = [];
  win.open = (/** @type {unknown[]} */ ...args) => {
    calls.push(args);
    return {};
  };
  /** @type {string[]} */
  const fetched = [];
  win.fetch = async (/** @type {unknown} */ input) => {
    fetched.push(String(input));
    return new Response('gone', { status: 404 });
  };
  const logged = console.error;
  console.error = () => {};
  try {
    const indexedDB = new IDBFactory();
    await createImageStore(await openDb({ indexedDB })).put(
      /** @type {any} */ ({ id: ID, messageId: '7', user: 'alice', mTime: '100', roomID: '1', receivedAt: 1, contentType: 'image/png', thumb: null, bytes: 0, favorite: false, broken: false }),
    );
    await createSettings(await openDb({ indexedDB })).set('useMediaQuickview', false);
    startGallery({ win, doc, css: '', indexedDB });
    const panel = listPanels().find((p) => p.id === 'gallery');
    assert.ok(panel);
    const body = doc.createElement('div');
    const cleanup = panel.render(body);
    await settle();
    const tile = /** @type {HTMLElement | null} */ (body.querySelector('.tdf-gallery-tile'));
    assert.ok(tile);
    tile.click();
    assert.deepEqual(calls, [[shareUrl(ID, win.location.href), '_blank']]);
    await settle();
    assert.deepEqual(fetched, [shareUrl(ID, win.location.href)], 'the background probe goes through win.fetch');
    const store = createImageStore(await openDb({ indexedDB }));
    assert.equal((await store.list())[0].brokenReason, 'HTTP 404', 'and marks a dead copy broken');
    if (typeof cleanup === 'function') cleanup();
  } finally {
    console.error = logged;
    clearGalleryErrors();
  }
});

test('by default a Gallery tile opens the media popover, whose zoom opens the share URL through win.open', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  /** @type {unknown[][]} */
  const calls = [];
  win.open = (/** @type {unknown[]} */ ...args) => {
    calls.push(args);
    return {};
  };
  /** @type {string[]} */
  const fetched = [];
  win.fetch = async (/** @type {unknown} */ input) => {
    fetched.push(String(input));
    return new Response('gone', { status: 404 });
  };
  const logged = console.error;
  console.error = () => {};
  try {
    const indexedDB = new IDBFactory();
    await createImageStore(await openDb({ indexedDB })).put(
      /** @type {any} */ ({ id: ID, messageId: '7', user: 'alice', mTime: '100', roomID: '1', receivedAt: 1, contentType: 'image/png', thumb: null, bytes: 0, favorite: false, broken: false }),
    );
    startGallery({ win, doc, css: '', indexedDB });
    const panel = listPanels().find((p) => p.id === 'gallery');
    assert.ok(panel);
    const body = doc.createElement('div');
    const cleanup = panel.render(body);
    await settle();
    const tile = /** @type {HTMLElement | null} */ (body.querySelector('.tdf-gallery-tile'));
    assert.ok(tile);
    tile.click();
    assert.deepEqual(calls, [], 'no tab opens on the tile click');
    const stageImg = /** @type {HTMLElement | null} */ (doc.querySelector('.tdf-lb .tdf-lb-image'));
    assert.ok(stageImg, 'the popover shows the image');
    stageImg.click();
    assert.deepEqual(calls, [[shareUrl(ID, win.location.href), '_blank']]);
    await settle();
    assert.deepEqual(fetched, [shareUrl(ID, win.location.href)], 'the background probe goes through win.fetch');
    const store = createImageStore(await openDb({ indexedDB }));
    assert.equal((await store.list())[0].brokenReason, 'HTTP 404', 'and marks a dead copy broken');
    /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-close')).click();
    if (typeof cleanup === 'function') cleanup();
  } finally {
    console.error = logged;
    clearGalleryErrors();
  }
});

/**
 * Stand-in canvas globals, so compressOriginal shrinks every opaque original to 4 bytes of JPEG.
 * @returns {() => void} restore
 */
function fakeCanvas() {
  const g = /** @type {any} */ (globalThis);
  const saved = { createImageBitmap: g.createImageBitmap, OffscreenCanvas: g.OffscreenCanvas };
  g.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  g.OffscreenCanvas = class {
    getContext() {
      return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }) };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
    }
  };
  return () => Object.assign(g, saved);
}

/** @param {IDBFactory} indexedDB */
async function storeOriginal(indexedDB) {
  await createImageStore(await openDb({ indexedDB })).put(
    /** @type {any} */ ({
      id: ID, messageId: '7', user: 'alice', mTime: '100', roomID: '1', receivedAt: 1, contentType: 'image/png',
      thumb: null, blob: new Blob([new Uint8Array(500)], { type: 'image/png' }), bytes: 500, favorite: false, broken: false,
    }),
  );
}

test('with Compress stored images on, stored originals are compressed once the gallery starts', async () => {
  const restore = fakeCanvas();
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  try {
    const indexedDB = new IDBFactory();
    await storeOriginal(indexedDB);
    await createSettings(await openDb({ indexedDB })).set('compressStoredImages', true);
    startGallery({ win, doc: win.document, css: '', indexedDB });
    await settle();
    const row = (await createImageStore(await openDb({ indexedDB })).list())[0];
    assert.deepEqual([row.blob?.size, row.contentType, row.bytes, row.compressChecked], [4, 'image/jpeg', 4, true]);
  } finally {
    restore();
    clearGalleryErrors();
  }
});

test('with Compress stored images off nothing is compressed, until it is switched on, without a reload', async () => {
  const restore = fakeCanvas();
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  try {
    const indexedDB = new IDBFactory();
    await storeOriginal(indexedDB);
    startGallery({ win, doc: win.document, css: '', indexedDB });
    await settle();
    const store = createImageStore(await openDb({ indexedDB }));
    const before = (await store.list())[0];
    assert.deepEqual([before.blob?.size, before.compressChecked], [500, undefined]);
    await createSettings(await openDb({ indexedDB })).set('compressStoredImages', true);
    await settle();
    const after = (await store.list())[0];
    assert.deepEqual([after.blob?.size, after.contentType, after.compressChecked], [4, 'image/jpeg', true]);
  } finally {
    restore();
    clearGalleryErrors();
  }
});

test('start registers Re-post as a gallery item action', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  startGallery({ win, doc: win.document, css: '', indexedDB: new IDBFactory() });
  const post = listGalleryItemActions().find((a) => a.id === 'post');
  assert.ok(post);
  assert.equal(post.label, 'Re-post');
  assert.equal(post.icon, undefined);
  assert.equal('cooldownMs' in post, false);
  assert.equal(post.disabled?.(/** @type {any} */ ({ id: ID, broken: true, contentType: '' })), 'Image unavailable from server');
  assert.equal(post.disabled?.(/** @type {any} */ ({ id: ID, broken: false, contentType: 'image/png' })), null);
  await settle();
  clearGalleryErrors();
});

test('Re-post fetches a record without a blob relative to win.location.href, stages it through composer/api.js and closes the gallery; nothing is uploaded', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  /** @type {string[]} */
  const fetched = [];
  win.fetch = async (/** @type {unknown} */ input) => {
    fetched.push(String(input));
    return new Response(new Blob([new Uint8Array(10)]), { headers: { 'content-type': 'image/png' } });
  };
  /** @type {File[]} */
  const staged = [];
  /** @type {string | null} */
  let refusal = null;
  const uninstallStager = installStager((file) => {
    staged.push(file);
    return refusal;
  });
  /** @type {string[]} */
  const closed = [];
  const uninstallHost = installRailHost({ open: () => {}, close: (p) => void closed.push(p.id), report: () => {} });
  try {
    startGallery({ win, doc, css: '', indexedDB: new IDBFactory() });
    const post = listGalleryItemActions().find((a) => a.id === 'post');
    assert.ok(post);
    const item = /** @type {any} */ ({ id: ID, broken: false, contentType: 'image/png' });

    await post.onSelect(item);
    assert.deepEqual(fetched, [shareUrl(ID, win.location.href)], 'only the share is fetched: no upload');
    assert.deepEqual(staged.map((f) => [f.name, f.type, f.size]), [[`${ID}.png`, 'image/png', 10]]);
    assert.deepEqual(closed, ['gallery']);

    refusal = 'A file is still uploading';
    await assert.rejects(Promise.resolve(post.onSelect(item)), { message: 'A file is still uploading' });
    assert.equal(staged.length, 2);
    assert.deepEqual(closed, ['gallery'], 'a refusal leaves the gallery open');

    uninstallStager();
    await assert.rejects(Promise.resolve(post.onSelect(item)), { message: COMPOSER_NOT_READY });
  } finally {
    uninstallStager();
    uninstallHost();
    await settle();
    clearGalleryErrors();
  }
});

test('Re-post stages nothing when the Gallery flyout closes while the share is still being fetched', async () => {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  /** @type {(r: Response) => void} */
  let respond = () => {};
  win.fetch = () => new Promise((resolve) => (respond = resolve));
  /** @type {File[]} */
  const staged = [];
  const uninstallStager = installStager((file) => {
    staged.push(file);
    return null;
  });
  /** @type {string[]} */
  const closed = [];
  const uninstallHost = installRailHost({ open: () => {}, close: (p) => void closed.push(p.id), report: () => {} });
  try {
    startGallery({ win, doc: win.document, css: '', indexedDB: new IDBFactory() });
    const panel = listPanels().find((p) => p.id === 'gallery');
    const post = listGalleryItemActions().find((a) => a.id === 'post');
    assert.ok(panel && post);
    const cleanup = panel.render(win.document.createElement('div'));
    const pending = Promise.resolve(post.onSelect(/** @type {any} */ ({ id: ID, broken: false, contentType: 'image/png' })));
    if (typeof cleanup === 'function') cleanup();
    respond(new Response(new Blob([new Uint8Array(10)]), { headers: { 'content-type': 'image/png' } }));
    await pending;
    assert.deepEqual(staged, []);
    assert.deepEqual(closed, []);
  } finally {
    uninstallStager();
    uninstallHost();
    await settle();
    clearGalleryErrors();
  }
});
