import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { listGalleryItemActions, registerGalleryItemAction, registerGalleryItemDecoration } from './api.js';
import { clearGalleryErrors, reportGalleryError } from './errors.js';
import { createImageStore } from './store.js';
import { renderGallery, resetGalleryActionStates } from './view.js';

beforeEach(() => resetGalleryActionStates());

const settle = () => new Promise((r) => setTimeout(r, 30));

let n = 0;

/** @param {Partial<import('./store.js').ImageRecord>} over */
const image = (over = {}) => ({
  id: '100000000000001',
  messageId: '1',
  user: 'alice',
  mTime: '100',
  roomID: '1',
  receivedAt: 1,
  contentType: 'image/png',
  thumb: null,
  bytes: 100,
  favorite: false,
  broken: false,
  ...over,
});

/**
 * @param {unknown} [arg]
 * @param {{ storeFails?: boolean, blocked?: boolean, openThrows?: boolean, retryFails?: string, quickview?: { on: boolean } }} [opts]
 *   retryFails: the reason a retry's probe fails with; without it, a retry loads and repairs
 */
async function open(arg, { storeFails = false, blocked = false, openThrows = false, retryFails, quickview } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  const store = createImageStore(await openDb({ name: `gallery-view-${++n}` }));
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  /** @type {unknown[]} */
  const errors = [];
  /** @type {string[]} */
  const opened = [];
  /** @type {string[]} */
  const retried = [];
  const mount = () =>
    renderGallery(container, arg, {
      doc,
      win,
      store: storeFails ? Promise.reject(new Error('IndexedDB disabled')) : Promise.resolve(store),
      open: (item) => {
        opened.push(item.id);
        if (openThrows) throw new Error('open broke');
        return blocked ? 'blocked' : 'opened';
      },
      retry: async (item) => {
        retried.push(item.id);
        if (!retryFails) return store.repair(item.id);
        await store.markBroken(item.id, retryFails);
        throw new Error(`still unavailable: ${retryFails}`);
      },
      report: (err) => errors.push(err),
      ...(quickview ? { quickview: () => quickview.on } : {}),
    });
  const tiles = () => [...container.querySelectorAll('.tdf-gallery-tile')];
  return { win, store, container, mount, tiles, errors, opened, retried };
}

test('an action and a decoration render on every item, registered before or after the flyout opens', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', receivedAt: 2 }));
  /** @type {string[]} */
  const selected = [];
  const offAction = registerGalleryItemAction({ id: 'like', label: 'Like', onSelect: (item) => selected.push(item.id) });
  const cleanup = g.mount();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.querySelectorAll('[data-action="like"]').length), [1, 1]);

  const offDecoration = registerGalleryItemDecoration((item, el) => {
    el.dataset.decorated = item.id;
  });
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.decorated), ['b', 'a']);
  assert.deepEqual(g.tiles().map((t) => t.querySelectorAll('[data-action="like"]').length), [1, 1]);

  /** @type {HTMLElement} */ (g.tiles()[0].querySelector('[data-action="like"]')).click();
  assert.deepEqual(selected, ['b']);
  assert.deepEqual(g.opened, [], 'an action click does not also open');

  offAction();
  offDecoration();
  await settle();
  assert.equal(g.container.querySelectorAll('[data-action]').length, 0);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('header counts every image; the star filter keeps favourites; a favourite cannot be trashed', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', receivedAt: 2 }));
  const cleanup = g.mount();
  await settle();
  const stats = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-stats'));
  assert.equal(stats.textContent, '2 images · 0 B');
  assert.match(stats.title, /Originals: .* · Thumbnails: .* · Favourites: 0/);

  const starOf = (/** @type {Element} */ t) => /** @type {HTMLButtonElement} */ (t.querySelector('.tdf-gallery-star'));
  const trashOf = (/** @type {Element} */ t) => /** @type {HTMLButtonElement} */ (t.querySelector('.tdf-gallery-trash'));
  starOf(g.tiles()[1]).click();
  await settle();
  assert.equal(((await g.store.list()).find((r) => r.id === 'a'))?.favorite, true);
  const favTile = g.tiles().find((t) => t.dataset.id === 'a');
  assert.ok(favTile?.classList.contains('tdf-fav'));
  assert.equal(trashOf(favTile).disabled, true);

  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['a']);
  assert.equal(stats.textContent, '2 images · 0 B');
  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();

  trashOf(g.tiles().find((t) => t.dataset.id === 'b')).click();
  await new Promise((r) => setTimeout(r, 250));
  await settle();
  assert.equal(await g.store.has('b'), false);
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['a']);
  assert.equal(stats.textContent, '1 image · 0 B');

  g.tiles()[0].click();
  assert.deepEqual(g.opened, ['a'], 'opened inside the click, with nothing awaited first');
  assert.equal(g.tiles()[0].title, 'alice — click to open');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('opened for a user, only that sender shows, until the chip is cleared', async () => {
  const g = await open({ user: 'bob%20b', label: 'bob b' });
  await g.store.put(image({ id: 'a', user: 'alice', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', user: 'bob b', receivedAt: 2 }));
  await g.store.put(image({ id: 'c', user: 'bob%20b', receivedAt: 3 }));
  const cleanup = g.mount();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'b']);
  assert.match(/** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-chip')).textContent ?? '', /Showing bob b/);
  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-chip-clear')).click();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'b', 'a']);
  cleanup();
});

test('a broken image shows the broken state; an empty gallery says so', async () => {
  const g = await open();
  const cleanup = g.mount();
  await settle();
  const empty = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-empty'));
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, 'No images yet');
  await g.store.put(image({ id: 'a', broken: true, brokenReason: 'HTTP 404' }));
  await settle();
  assert.equal(empty.hidden, true);
  assert.ok(g.tiles()[0].classList.contains('tdf-broken'));
  const badge = /** @type {HTMLElement} */ (g.tiles()[0].querySelector('.tdf-gallery-broken'));
  assert.equal(badge.title, 'The server copy no longer loads: HTTP 404');
  await g.store.repair('a');
  await settle();
  assert.equal(g.tiles()[0].classList.contains('tdf-broken'), false);
  assert.equal(badge.title, 'The server copy no longer loads');
  cleanup();
  assert.equal(g.container.children.length, 0);
});

test('empty states name the filter in force', async () => {
  const g = await open({ user: 'bob' });
  const cleanup = g.mount();
  await settle();
  const empty = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-empty'));
  assert.equal(empty.textContent, 'No images from bob yet');
  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  assert.equal(empty.textContent, 'No favourites yet. Star an image to keep it here.');
  cleanup();
});

test('failures reach the flyout: a store that will not open, a blocked tab, a throwing action or decoration', async () => {
  const down = await open(undefined, { storeFails: true });
  const offDown = down.mount();
  await settle();
  assert.deepEqual(down.errors.map((e) => /** @type {Error} */ (e).message), ['IndexedDB disabled']);
  offDown();

  const g = await open(undefined, { blocked: true });
  await g.store.put(image({ id: 'a' }));
  const offAction = registerGalleryItemAction({
    id: 'bad',
    label: 'Bad',
    onSelect: () => {
      throw new Error('action broke');
    },
  });
  const offDecoration = registerGalleryItemDecoration(() => {
    throw new Error('decoration broke');
  });
  const cleanup = g.mount();
  await settle();
  /** @type {HTMLElement} */ (g.tiles()[0].querySelector('[data-action="bad"]')).click();
  g.tiles()[0].click();
  await settle();
  assert.deepEqual(
    g.errors.map((e) => /** @type {Error} */ (e).message),
    ['decoration broke', 'action broke', 'gallery: the browser blocked the new tab'],
  );
  offAction();
  offDecoration();
  cleanup();
});

test('a trash refused by the store restores the tile and reports why', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const cleanup = g.mount();
  await settle();
  const tile = g.tiles()[0];
  const trash = /** @type {HTMLButtonElement} */ (tile.querySelector('.tdf-gallery-trash'));
  // Starred behind the tile's back: the click still sees an unstarred item.
  const t = g.store.setFavorite('a', true);
  trash.click();
  await t;
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await g.store.has('a'), true);
  assert.equal(tile.classList.contains('tdf-removing'), false);
  assert.match(String(/** @type {Error} */ (g.errors[0])?.message), /favourite and cannot be deleted/);
  cleanup();
});

test('recorded gallery failures show in the flyout and a click dismisses them', async () => {
  const logged = console.error;
  console.error = () => {};
  try {
    reportGalleryError(new Error('capture failed'));
    const g = await open();
    const cleanup = g.mount();
    await settle();
    const box = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-error'));
    assert.equal(box.hidden, false);
    assert.equal(box.textContent, 'capture failed');
    reportGalleryError({ code: 7 });
    assert.equal(box.children.length, 2);
    assert.equal(box.children[1].textContent, '{"code":7}');
    box.click();
    assert.equal(box.hidden, true);
    cleanup();
  } finally {
    console.error = logged;
    clearGalleryErrors();
  }
});

test('registrations are validated', () => {
  assert.throws(() => registerGalleryItemAction(/** @type {any} */ ({ label: 'x', onSelect() {} })), /string id/);
  assert.throws(() => registerGalleryItemAction(/** @type {any} */ ({ id: 'x', label: 'x' })), /onSelect/);
  assert.throws(() => registerGalleryItemDecoration(/** @type {any} */ ('x')), /must be a function/);
  const off = registerGalleryItemAction({ id: 'dup', label: 'old', onSelect() {} });
  const offNew = registerGalleryItemAction({ id: 'dup', label: 'new', onSelect() {} });
  off();
  assert.deepEqual(listGalleryItemActions().map((a) => a.label), ['new']);
  offNew();
  assert.deepEqual(listGalleryItemActions(), []);
});

test('a stored thumbnail renders as an img whose URL is revoked when its tile goes, and on close', async () => {
  const g = await open();
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const revoked = [];
  g.win.URL.createObjectURL = () => {
    const url = `blob:thumb-${created.length}`;
    created.push(url);
    return url;
  };
  g.win.URL.revokeObjectURL = (/** @type {string} */ url) => void revoked.push(url);
  const thumb = new Blob([new Uint8Array(500)], { type: 'image/webp' });
  await g.store.put(image({ id: 'a', receivedAt: 1, thumb, bytes: 500 }));
  await g.store.put(image({ id: 'b', receivedAt: 2, thumb, bytes: 500 }));
  const cleanup = g.mount();
  await settle();
  const imgs = g.tiles().map((t) => /** @type {HTMLImageElement | null} */ (t.querySelector('img.tdf-gallery-thumb')));
  assert.deepEqual(imgs.map((i) => i?.getAttribute('src')), ['blob:thumb-0', 'blob:thumb-1']);
  assert.deepEqual(imgs.map((i) => i?.alt), ['Image from alice', 'Image from alice']);
  assert.equal(g.container.querySelectorAll('.tdf-gallery-placeholder').length, 0);
  const stats = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-stats'));
  assert.equal(stats.textContent, '2 images · 1000 B');
  assert.match(stats.title, /^Originals: 0 B · Thumbnails: 1000 B · Favourites: 0$/);

  await g.store.remove('b');
  await settle();
  assert.deepEqual(revoked, ['blob:thumb-0'], 'the removed tile (b, drawn first) gives its URL back');
  cleanup();
  assert.deepEqual(revoked, ['blob:thumb-0', 'blob:thumb-1']);
  assert.deepEqual(g.errors, []);
});

test('a tile is a focusable button: Enter and Space open it, keys on its own buttons do not', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const cleanup = g.mount();
  await settle();
  const tile = /** @type {HTMLElement} */ (g.tiles()[0]);
  assert.equal(tile.tabIndex, 0);
  assert.equal(tile.getAttribute('role'), 'button');
  assert.equal(tile.getAttribute('aria-label'), 'Open image from alice');
  const press = (/** @type {Element} */ el, /** @type {string} */ key) =>
    el.dispatchEvent(new g.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press(tile, 'Enter');
  press(tile, ' ');
  press(tile, 'a');
  press(/** @type {Element} */ (tile.querySelector('.tdf-gallery-star')), 'Enter');
  await settle();
  assert.deepEqual(g.opened, ['a', 'a']);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a broken record with no stored original is faded and labelled, and opens nothing; trash and star still work', async () => {
  const g = await open(undefined, { retryFails: 'HTTP 404' });
  await g.store.put(image({ id: 'a', receivedAt: 1, broken: true, brokenReason: 'HTTP 404' }));
  await g.store.put(image({ id: 'b', receivedAt: 2, broken: true, brokenReason: 'HTTP 404', blob: new Blob(['x'], { type: 'image/png' }) }));
  const cleanup = g.mount();
  await settle();
  const gone = /** @type {HTMLElement} */ (g.tiles().find((t) => t.dataset.id === 'a'));
  const kept = /** @type {HTMLElement} */ (g.tiles().find((t) => t.dataset.id === 'b'));
  assert.ok(gone.classList.contains('tdf-unavailable'));
  assert.equal(gone.hasAttribute('aria-disabled'), false, 'activating it retries, so it is not disabled');
  assert.equal(gone.getAttribute('aria-label'), 'Image from alice unavailable from server — activate to retry');
  assert.equal(gone.querySelector('.tdf-gallery-unavailable')?.textContent, 'Image unavailable from server');
  assert.equal(gone.title, 'Image unavailable from server: HTTP 404 — click to retry');
  assert.equal(kept.classList.contains('tdf-unavailable'), false, 'a kept original still opens');
  assert.ok(kept.classList.contains('tdf-broken'), 'and keeps its broken badge');
  assert.equal(kept.getAttribute('aria-label'), 'Open image from alice');

  gone.click();
  gone.dispatchEvent(new g.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  kept.click();
  assert.deepEqual(g.opened, ['b']);
  assert.deepEqual(g.retried, ['a'], 'one retry at a time, the Enter came while the click was in flight');
  await settle();
  assert.ok(gone.classList.contains('tdf-unavailable'), 'a retry that fails keeps it unavailable');
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['still unavailable: HTTP 404']);
  g.errors.length = 0;

  /** @type {HTMLButtonElement} */ (gone.querySelector('.tdf-gallery-star')).click();
  await settle();
  assert.equal((await g.store.list()).find((r) => r.id === 'a')?.favorite, true);
  assert.deepEqual(g.opened, ['b'], 'the star does not open the tile');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('an open that throws is reported, not thrown out of the click', async () => {
  const g = await open(undefined, { openThrows: true });
  await g.store.put(image({ id: 'a' }));
  const cleanup = g.mount();
  await settle();
  assert.doesNotThrow(() => g.tiles()[0].click());
  assert.deepEqual(g.opened, ['a']);
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['open broke']);
  cleanup();
});

test('a broken record with no stored original and no reason is titled without one', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', broken: true }));
  const cleanup = g.mount();
  await settle();
  const tile = /** @type {HTMLElement} */ (g.tiles()[0]);
  assert.ok(tile.classList.contains('tdf-unavailable'));
  assert.equal(tile.title, 'Image unavailable from server — click to retry');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a retry that loads makes an unavailable tile openable again, without opening it', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', broken: true, brokenReason: 'no answer within 30000 ms' }));
  const cleanup = g.mount();
  await settle();
  const tile = /** @type {HTMLElement} */ (g.tiles()[0]);
  tile.click();
  await settle();
  assert.deepEqual(g.retried, ['a']);
  assert.deepEqual(g.opened, [], 'a tab opened after the probe would be blocked');
  assert.equal(tile.classList.contains('tdf-unavailable'), false);
  assert.equal(tile.getAttribute('aria-label'), 'Open image from alice');
  assert.equal(tile.title, 'alice — click to open');
  tile.click();
  assert.deepEqual(g.opened, ['a'], 'the next click opens it');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('each tile shows its size on disk, orange from 1 MB, refreshed when a repair changes it', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 3, bytes: 1048575 }));
  await g.store.put(image({ id: 'b', receivedAt: 2, bytes: 1048576 }));
  await g.store.put(image({ id: 'c', receivedAt: 1, bytes: 1536, broken: true }));
  await g.store.put(image({ id: 'd', receivedAt: 0, bytes: 512, broken: true, blob: new Blob(['x']) }));
  const cleanup = g.mount();
  await settle();
  /** @param {string} id */
  const chip = (id) =>
    /** @type {HTMLElement} */ (g.tiles().find((t) => t.dataset.id === id)?.querySelector('.tdf-gallery-size'));
  assert.equal(chip('a').textContent, '1024.0 KB');
  assert.equal(chip('a').classList.contains('tdf-large'), false);
  assert.equal(chip('b').textContent, '1.0 MB');
  assert.ok(chip('b').classList.contains('tdf-large'));
  assert.equal(chip('c').textContent, '1.5 KB', 'an unavailable tile keeps its chip');
  assert.equal(chip('d').textContent, '512 B', 'a broken tile keeps its chip');

  const before = chip('c');
  await g.store.repair('c', { bytes: 2 * 1048576 });
  await settle();
  assert.equal(chip('c'), before, 'the same chip, updated in place');
  assert.equal(chip('c').textContent, '2.0 MB');
  assert.ok(chip('c').classList.contains('tdf-large'));

  const large = chip('b');
  await g.store.repair('b', { bytes: 1048575 });
  await settle();
  assert.equal(chip('b'), large, 'the same chip, updated in place');
  assert.equal(chip('b').textContent, '1024.0 KB');
  assert.equal(chip('b').classList.contains('tdf-large'), false);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('quickview on: a tile opens the media popover over the shown tiles in display order; zoom is the tile\'s open', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  g.win.document.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await g.store.put(image({ id: 'a', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', receivedAt: 2, favorite: true }));
  await g.store.put(image({ id: 'c', receivedAt: 3, thumb: new Blob([new Uint8Array(4)], { type: 'image/png' }) }));
  const cleanup = g.mount();
  await settle();
  const doc = g.win.document;
  g.tiles()[1].click();
  assert.deepEqual(g.opened, [], 'no tab opens on the tile click');
  assert.equal(doc.querySelector('.tdf-lb-count')?.textContent, '2 / 3', 'b, in display order c, b, a');
  const thumbs = [...doc.querySelectorAll('.tdf-lb-thumb')];
  assert.match(String(thumbs[0].querySelector('img')?.getAttribute('src')), /^blob:/, 'thumbnails are the tiles\' object URLs');
  assert.match(String(doc.querySelector('.tdf-lb-stage img')?.getAttribute('src')), /view\.php\?id=b$/);
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-stage img')).click();
  assert.deepEqual(g.opened, ['b'], 'zoom calls the existing open, inside the click');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-close')).click();

  // The favourites filter narrows the roster to the tiles shown.
  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  g.tiles()[0].click();
  assert.equal(doc.querySelector('.tdf-lb-count')?.textContent, '1 / 1');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-close')).click();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('quickview on: an unavailable tile still retries rather than opening the popover', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  await g.store.put(image({ id: 'a', broken: true, brokenReason: 'HTTP 404' }));
  const cleanup = g.mount();
  await settle();
  g.tiles()[0].click();
  await settle();
  assert.deepEqual(g.retried, ['a']);
  assert.equal(g.win.document.querySelector('.tdf-lb'), null);
  cleanup();
});

test('the quickview setting is read at each tile click; off opens the tab inside the click', async () => {
  const setting = { on: false };
  const g = await open(undefined, { quickview: setting });
  await g.store.put(image({ id: 'a' }));
  const cleanup = g.mount();
  await settle();
  g.tiles()[0].click();
  assert.deepEqual(g.opened, ['a'], 'off: opened synchronously');
  assert.equal(g.win.document.querySelector('.tdf-lb'), null);
  setting.on = true;
  g.tiles()[0].click();
  assert.deepEqual(g.opened, ['a']);
  assert.ok(g.win.document.querySelector('.tdf-lb'));
  /** @type {HTMLElement} */ (g.win.document.querySelector('.tdf-lb-close')).click();
  assert.equal(g.win.document.activeElement, g.tiles()[0], 'closing returns focus to the tile');
  cleanup();
});

/** @param {any} win stubs object URLs so each is named and its revoke recorded */
function trackUrls(win) {
  /** @type {string[]} */
  const revoked = [];
  let made = 0;
  win.URL.createObjectURL = (/** @type {Blob} */ blob) => `blob:${blob.type || 'none'}-${made++}`;
  win.URL.revokeObjectURL = (/** @type {string} */ url) => void revoked.push(url);
  return revoked;
}

test('quickview: a stored raster original is the stage, an SVG one is not; the gallery closing closes the popover, then revokes', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  const revoked = trackUrls(g.win);
  const thumb = new Blob([new Uint8Array(4)], { type: 'image/webp' });
  await g.store.put(image({ id: 'a', receivedAt: 2, broken: true, thumb, blob: new Blob(['x'], { type: 'image/png' }) }));
  await g.store.put(image({ id: 'b', receivedAt: 1, thumb, blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }));
  const cleanup = g.mount();
  await settle();
  const doc = g.win.document;
  g.tiles()[0].click();
  assert.equal(doc.querySelector('.tdf-lb-stage img')?.getAttribute('src'), 'blob:image/png-2', 'the stored original');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-next')).click();
  assert.match(String(doc.querySelector('.tdf-lb-stage img')?.getAttribute('src')), /view\.php\?id=b$/, 'an SVG opens from the share URL');
  assert.deepEqual(revoked, []);
  cleanup();
  assert.equal(doc.querySelector('.tdf-lb'), null, 'the popover closes with the gallery');
  assert.deepEqual(revoked.sort(), ['blob:image/png-2', 'blob:image/webp-0', 'blob:image/webp-1']);
  assert.deepEqual(g.errors, []);
});

test('quickview: a tile dropped while the popover is open keeps its thumbnail until the popover closes; zoom still opens it', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  const revoked = trackUrls(g.win);
  const thumb = new Blob([new Uint8Array(4)], { type: 'image/webp' });
  await g.store.put(image({ id: 'a', receivedAt: 2, thumb }));
  await g.store.put(image({ id: 'b', receivedAt: 1, thumb }));
  const cleanup = g.mount();
  await settle();
  const doc = g.win.document;
  g.tiles()[0].click();
  await g.store.remove('b');
  await settle();
  assert.equal(g.tiles().length, 1);
  assert.deepEqual(revoked, [], 'the filmstrip still shows b');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-thumb[data-index="1"]')).click();
  assert.equal(doc.querySelector('.tdf-lb-thumb[data-index="1"] img')?.getAttribute('src'), 'blob:image/webp-1');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-stage img')).click();
  assert.deepEqual(g.opened, ['b'], 'zoom falls back to the record as it was when the popover opened');

  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-close')).click();
  await g.store.put(image({ id: 'c', receivedAt: 3 }));
  await settle();
  assert.deepEqual(revoked, [], 'a refresh that drops nothing keeps them');
  await g.store.remove('c');
  await settle();
  assert.deepEqual(revoked, ['blob:image/webp-1'], 'the next drop, once the popover has closed, gives it back');
  cleanup();
  assert.deepEqual(revoked, ['blob:image/webp-1', 'blob:image/webp-0']);
  assert.deepEqual(g.errors, []);
});

test('quickview: a new popover from the gallery gives back the last one\'s object URLs', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  const revoked = trackUrls(g.win);
  await g.store.put(image({ id: 'a', blob: new Blob(['x'], { type: 'image/png' }) }));
  const cleanup = g.mount();
  await settle();
  g.tiles()[0].click();
  g.tiles()[0].click();
  assert.deepEqual(revoked, ['blob:image/png-0']);
  assert.equal(g.win.document.querySelectorAll('.tdf-lb').length, 1);
  cleanup();
  assert.deepEqual(revoked, ['blob:image/png-0', 'blob:image/png-1']);
});

test('quickview: a popover that fails to open is reported, not thrown out of the click', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  await g.store.put(image({ id: 'a' }));
  const cleanup = g.mount();
  await settle();
  g.win.document.getElementById = () => {
    throw new Error('popover broke');
  };
  assert.doesNotThrow(() => g.tiles()[0].click());
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['popover broke']);
  assert.deepEqual(g.opened, []);
  cleanup();
});

/** A Promise-returning action whose every call is settled by hand. */
function deferredAction(/** @type {Partial<import('./api.js').GalleryItemAction>} */ over = {}) {
  /** @type {{ id: string, resolve: () => void, reject: (err: Error) => void }[]} */
  const calls = [];
  const action = {
    id: 'post',
    label: 'Post',
    onSelect: (/** @type {import('./store.js').ImageRecord} */ item) =>
      new Promise((resolve, reject) => calls.push({ id: item.id, resolve: () => resolve(undefined), reject })),
    ...over,
  };
  return { action: /** @type {import('./api.js').GalleryItemAction} */ (action), calls };
}

/** @param {Element} tile */
const postButton = (tile) => /** @type {HTMLButtonElement} */ (tile.querySelector('[data-action="post"]'));

test('a Promise action is busy in flight, ignores repeat clicks, then cools down and works again', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 80 });
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  let b = postButton(g.tiles()[0]);
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  b.click();
  assert.equal(calls.length, 1);
  assert.ok(b.classList.contains('tdf-busy'));
  assert.equal(b.getAttribute('aria-busy'), 'true');
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  b.click();
  assert.equal(calls.length, 1, 'a click while busy does nothing');
  assert.deepEqual(g.opened, [], 'the tile does not open');
  assert.equal(g.win.document.querySelector('.tdf-lb'), null, 'the media popover does not open');

  // A store change redraws the tile while busy; the state is kept by id.
  await g.store.setFavorite('a', true);
  await settle();
  b = postButton(g.tiles()[0]);
  assert.ok(b.classList.contains('tdf-busy'));

  calls[0].resolve();
  await settle();
  assert.equal(b.classList.contains('tdf-busy'), false);
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(b.title, 'Post — done');
  b.click();
  assert.equal(calls.length, 1, 'a click while cooling does nothing');

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Post');
  b.click();
  assert.equal(calls.length, 2);
  calls[1].resolve();
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a rejected action shows its reason on the button, reports it, and can be tried again', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 5000 });
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  b.click();
  calls[0].reject(new Error('Upload failed: signed out'));
  await settle();
  assert.ok(b.classList.contains('tdf-failed'));
  assert.equal(b.classList.contains('tdf-busy'), false);
  assert.equal(b.title, 'Post failed: Upload failed: signed out');
  assert.equal(b.getAttribute('aria-label'), 'Post failed: Upload failed: signed out');
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['Upload failed: signed out']);
  b.click();
  assert.equal(calls.length, 2, 'a failed action may be retried');
  assert.ok(b.classList.contains('tdf-busy'));
  calls[1].resolve();
  off();
  // Closing mid-cooldown clears the timer.
  await settle();
  cleanup();
});

test('a disabled action is titled with its reason and its click neither runs it nor opens the tile', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', broken: true }));
  await g.store.put(image({ id: 'b', receivedAt: 2 }));
  const { action, calls } = deferredAction({
    disabled: (item) => (item.broken ? 'Image unavailable from server' : null),
  });
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  const [b, a] = g.tiles();
  assert.equal(postButton(a).getAttribute('aria-disabled'), 'true');
  assert.equal(postButton(a).title, 'Image unavailable from server');
  assert.equal(postButton(a).getAttribute('aria-label'), 'Image unavailable from server');
  postButton(a).click();
  assert.equal(calls.length, 0);
  assert.deepEqual(g.retried, [], 'the click does not reach the tile\'s retry');
  assert.equal(postButton(b).getAttribute('aria-disabled'), 'false');
  postButton(b).click();
  assert.equal(calls.length, 1);
  calls[0].resolve();
  off();
  cleanup();
});

test('a synchronous action is not held busy and has no cooldown', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  /** @type {string[]} */
  const selected = [];
  const off = registerGalleryItemAction({ id: 'like', label: 'Like', cooldownMs: 5000, onSelect: (item) => void selected.push(item.id) });
  const cleanup = g.mount();
  await settle();
  const b = /** @type {HTMLButtonElement} */ (g.tiles()[0].querySelector('[data-action="like"]'));
  b.click();
  b.click();
  assert.deepEqual(selected, ['a', 'a']);
  assert.equal(b.classList.contains('tdf-busy'), false);
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Like');
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a Promise action with no cooldown returns straight to idle once it resolves', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction();
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  b.click();
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  calls[0].resolve();
  await settle();
  assert.equal(b.classList.contains('tdf-busy'), false);
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.getAttribute('aria-busy'), null);
  assert.equal(b.title, 'Post');
  b.click();
  assert.equal(calls.length, 2, 'it runs again at once');
  calls[1].resolve();
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a disabled() that throws is reported and the button still renders, enabled', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({
    disabled: () => {
      throw new Error('disabled broke');
    },
  });
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  assert.ok(b, 'the button renders');
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Post');
  assert.ok(g.errors.length > 0);
  assert.ok(g.errors.every((e) => /** @type {Error} */ (e).message === 'disabled broke'));
  b.click();
  assert.equal(calls.length, 1);
  calls[0].resolve();
  off();
  cleanup();
});

test('an action in flight when the flyout closes is still busy on reopen, then cools down there', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 80 });
  const off = registerGalleryItemAction(action);
  let cleanup = g.mount();
  await settle();
  postButton(g.tiles()[0]).click();
  assert.equal(calls.length, 1);
  cleanup();

  cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  assert.ok(b.classList.contains('tdf-busy'));
  assert.equal(b.getAttribute('aria-busy'), 'true');
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  b.click();
  assert.equal(calls.length, 1, 'no duplicate post from the reopened flyout');

  calls[0].resolve();
  await settle();
  assert.equal(b.classList.contains('tdf-busy'), false);
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(b.title, 'Post — done');
  b.click();
  assert.equal(calls.length, 1, 'a click while cooling does nothing');

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Post');
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a flyout reopened mid-cooldown draws it cooling and ends it on time', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 150 });
  const off = registerGalleryItemAction(action);
  let cleanup = g.mount();
  await settle();
  postButton(g.tiles()[0]).click();
  calls[0].resolve();
  await settle();
  cleanup();

  cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(b.title, 'Post — done');
  b.click();
  assert.equal(calls.length, 1, 'no duplicate post mid-cooldown');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Post');
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a refusal after the flyout closes is still reported, and the reopened tile shows it failed', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 5000 });
  const off = registerGalleryItemAction(action);
  let cleanup = g.mount();
  await settle();
  postButton(g.tiles()[0]).click();
  cleanup();
  calls[0].reject(new Error('Upload failed: signed out'));
  await settle();
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['Upload failed: signed out']);

  cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  assert.ok(b.classList.contains('tdf-failed'));
  assert.equal(b.getAttribute('aria-disabled'), 'false');
  assert.equal(b.title, 'Post failed: Upload failed: signed out');
  off();
  cleanup();
});
