import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { listGalleryItemActions, registerGalleryItemAction, registerGalleryItemDecoration } from './api.js';
import { clearGalleryErrors, reportGalleryError } from './errors.js';
import { createImageStore } from './store.js';
import { renderGallery } from './view.js';

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

/** @param {unknown} [arg] @param {{ storeFails?: boolean, saveFails?: boolean }} [opts] */
async function open(arg, { storeFails = false, saveFails = false } = {}) {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  const store = createImageStore(await openDb({ name: `gallery-view-${++n}` }));
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  /** @type {unknown[]} */
  const errors = [];
  /** @type {string[]} */
  const saved = [];
  const mount = () =>
    renderGallery(container, arg, {
      doc,
      win,
      store: storeFails ? Promise.reject(new Error('IndexedDB disabled')) : Promise.resolve(store),
      save: async (item) => {
        if (saveFails) throw new Error('save failed');
        saved.push(item.id);
      },
      report: (err) => errors.push(err),
    });
  const tiles = () => [...container.querySelectorAll('.tdf-gallery-tile')];
  return { win, store, container, mount, tiles, errors, saved };
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
  assert.deepEqual(g.saved, [], 'an action click does not also save');

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
  await settle();
  assert.deepEqual(g.saved, ['a']);
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
  await g.store.put(image({ id: 'a', broken: true }));
  await settle();
  assert.equal(empty.hidden, true);
  assert.ok(g.tiles()[0].classList.contains('tdf-broken'));
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

test('failures reach the flyout: a store that will not open, a failed save, a throwing action or decoration', async () => {
  const down = await open(undefined, { storeFails: true });
  const offDown = down.mount();
  await settle();
  assert.deepEqual(down.errors.map((e) => /** @type {Error} */ (e).message), ['IndexedDB disabled']);
  offDown();

  const g = await open(undefined, { saveFails: true });
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
    ['decoration broke', 'action broke', 'save failed'],
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
