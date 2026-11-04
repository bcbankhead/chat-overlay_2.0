import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 * @param {{ storeFails?: boolean, blocked?: boolean, openThrows?: boolean, retryFails?: string, quickview?: { on: boolean }, includeMine?: { on: boolean }, userName?: string }} [opts]
 *   retryFails: the reason a retry's probe fails with; without it, a retry loads and repairs
 */
async function open(
  arg,
  { storeFails = false, blocked = false, openThrows = false, retryFails, quickview, includeMine, userName } = {},
) {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  if (userName !== undefined) win.userName = userName;
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
      ...(includeMine ? { includeMine: () => includeMine.on } : {}),
      self: () => String(win.userName ?? ''),
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

test('a refresh reconciles tiles by key: a star detaches none, a capture adds one at the front, a delete removes one (TDF-0047)', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', receivedAt: 2 }));
  await g.store.put(image({ id: 'c', receivedAt: 3 }));
  const cleanup = g.mount();
  await settle();
  const grid = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-grid'));
  /** @type {{ added: Node[], removed: Node[] }} */
  const seen = { added: [], removed: [] };
  const observer = new g.win.MutationObserver((/** @type {MutationRecord[]} */ records) => {
    for (const r of records) {
      seen.added.push(...r.addedNodes);
      seen.removed.push(...r.removedNodes);
    }
  });
  observer.observe(grid, { childList: true });
  const reset = () => {
    seen.added = [];
    seen.removed = [];
  };
  const before = g.tiles();
  assert.deepEqual(before.map((t) => t.dataset.id), ['c', 'b', 'a']);

  const star = /** @type {HTMLButtonElement} */ (before[1].querySelector('.tdf-gallery-star'));
  star.focus();
  star.click();
  await settle();
  assert.equal(((await g.store.list()).find((r) => r.id === 'b'))?.favorite, true);
  assert.ok(before[1].classList.contains('tdf-fav'), 'the starred tile redrew in place');
  // Identities and counts, not deepEqual on nodes: a failing diff of DOM nodes exhausts memory.
  const sameTiles = (/** @type {Element[]} */ now, /** @type {Element[]} */ was) =>
    now.length === was.length && now.every((t, i) => t === was[i]);
  assert.equal(seen.removed.length, 0, 'a star detaches no tile');
  assert.equal(seen.added.length, 0, 'a star re-adds no tile');
  assert.ok(sameTiles(g.tiles(), before), 'every tile keeps its element');
  assert.ok(g.win.document.activeElement === star, 'the clicked star keeps focus');

  await g.store.put(image({ id: 'd', receivedAt: 4 }));
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['d', 'c', 'b', 'a']);
  assert.equal(seen.added.length, 1, 'a new capture inserts exactly one tile');
  assert.equal(/** @type {HTMLElement} */ (seen.added[0]).dataset.id, 'd');
  assert.equal(seen.removed.length, 0);
  assert.ok(sameTiles(g.tiles().slice(1), before), 'the existing tiles keep their elements');
  reset();

  await g.store.remove('c');
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['d', 'b', 'a']);
  assert.equal(seen.added.length, 0, 'a delete inserts nothing');
  assert.equal(seen.removed.length, 1, 'a delete removes exactly one tile');
  assert.ok(seen.removed[0] === before[0], 'the removed tile is the deleted one');
  observer.disconnect();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('the star filter keeps favourite tiles in place: on drops the rest, off re-inserts them between the kept ones (TDF-0047)', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 1, favorite: true }));
  await g.store.put(image({ id: 'b', receivedAt: 2 }));
  await g.store.put(image({ id: 'c', receivedAt: 3, favorite: true }));
  await g.store.put(image({ id: 'd', receivedAt: 4 }));
  const cleanup = g.mount();
  await settle();
  const grid = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-grid'));
  /** @type {{ added: Node[], removed: Node[] }} */
  const seen = { added: [], removed: [] };
  const observer = new g.win.MutationObserver((/** @type {MutationRecord[]} */ records) => {
    for (const r of records) {
      seen.added.push(...r.addedNodes);
      seen.removed.push(...r.removedNodes);
    }
  });
  observer.observe(grid, { childList: true });
  const before = g.tiles();
  assert.deepEqual(before.map((t) => t.dataset.id), ['d', 'c', 'b', 'a']);
  const [d, c, b, a] = before;
  const filter = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter'));

  filter.click();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'a']);
  const kept = g.tiles();
  assert.ok(kept[0] === c && kept[1] === a, 'the favourites keep their elements');
  assert.equal(seen.added.length, 0, 'filtering on inserts nothing');
  assert.equal(seen.removed.length, 2, 'filtering on removes the two non-favourites');
  assert.ok(seen.removed.includes(d) && seen.removed.includes(b));
  seen.added = [];
  seen.removed = [];

  filter.click();
  await settle();
  const after = g.tiles();
  assert.deepEqual(after.map((t) => t.dataset.id), ['d', 'c', 'b', 'a']);
  assert.ok(after[1] === c && after[3] === a, 'the favourites still keep their elements');
  assert.equal(seen.removed.length, 0, 'filtering off detaches no tile');
  assert.equal(seen.added.length, 2, 'filtering off inserts only the two non-favourites');
  assert.ok(seen.added[0] === after[0] && seen.added[1] === after[2]);
  observer.disconnect();
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

/** @param {Element} c */
const mineOf = (c) => /** @type {HTMLButtonElement} */ (c.querySelector('.tdf-gallery-minefilter'));

test('My Images is hidden with no user name, shown with one, beside the favourites filter (TDF-0046)', async () => {
  const out = await open();
  const cleanupOut = out.mount();
  await settle();
  assert.equal(mineOf(out.container).hidden, true, 'logged out: hidden');
  cleanupOut();

  const g = await open(undefined, { userName: 'me' });
  const cleanup = g.mount();
  await settle();
  const mine = mineOf(g.container);
  assert.equal(mine.hidden, false);
  assert.equal(mine.getAttribute('aria-pressed'), 'false');
  assert.equal(mine.getAttribute('aria-label'), 'Show my images only');
  assert.equal(mine.nextElementSibling?.className, 'tdf-gallery-favfilter');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('My Images CSS: the favfilter box, pressed in the link accent not the star, and hidden despite display: grid (TDF-0046)', () => {
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  assert.match(css, /\.tdf-gallery-minefilter \{[^}]*width: 28px/);
  assert.match(css, /\.tdf-gallery-minefilter\[aria-pressed="true"\] \{[^}]*color: var\(--tdf-link\)/);
  assert.match(css, /\.tdf-gallery-minefilter\[hidden\] \{\s*display: none;/);
});

test("My Images pressed shows only the current user's images, newest first, and combines with favourites (TDF-0046)", async () => {
  const g = await open(undefined, { userName: 'me' });
  await g.store.put(image({ id: 'a', user: 'alice', receivedAt: 1, favorite: true }));
  await g.store.put(image({ id: 'b', user: 'me', receivedAt: 2 }));
  await g.store.put(image({ id: 'c', user: 'me', receivedAt: 3, favorite: true }));
  const cleanup = g.mount();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'b', 'a']);

  const mine = mineOf(g.container);
  mine.click();
  await settle();
  assert.equal(mine.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'b']);

  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c'], 'my favourites');

  mine.click();
  await settle();
  assert.equal(mine.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['c', 'a'], 'favourites from everyone');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('pressing My Images clears an active user-filter chip (TDF-0046)', async () => {
  const g = await open({ user: 'bob' }, { userName: 'me' });
  await g.store.put(image({ id: 'a', user: 'bob', receivedAt: 1 }));
  await g.store.put(image({ id: 'b', user: 'me', receivedAt: 2 }));
  const cleanup = g.mount();
  await settle();
  const chip = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-chip'));
  assert.equal(chip.hidden, false);
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['a']);

  mineOf(g.container).click();
  await settle();
  assert.equal(chip.hidden, true);
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['b']);

  mineOf(g.container).click();
  await settle();
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['b', 'a'], 'the chip does not come back');
  cleanup();
});

test('My Images empty states: with favourites, and the Include my images hint only while it is off (TDF-0046)', async () => {
  const setting = { on: false };
  const g = await open(undefined, { userName: 'me', includeMine: setting });
  await g.store.put(image({ id: 'a', user: 'alice' }));
  const cleanup = g.mount();
  await settle();
  const empty = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-empty'));
  mineOf(g.container).click();
  await settle();
  assert.equal(empty.hidden, false);
  assert.equal(
    empty.textContent,
    'No images from you yet. Include my images is off, so only images saved before it was turned off are kept.',
  );

  setting.on = true;
  await g.store.put(image({ id: 'b', user: 'alice' }));
  await settle();
  assert.equal(empty.textContent, 'No images from you yet.');

  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  assert.equal(empty.textContent, 'None of your images are favourites yet.');
  cleanup();
});

test('My Images with no includeMine dep shows no hint; losing the user name drops the filter (TDF-0046)', async () => {
  const g = await open(undefined, { userName: 'me' });
  await g.store.put(image({ id: 'a', user: 'alice' }));
  const cleanup = g.mount();
  await settle();
  const empty = /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-empty'));
  const mine = mineOf(g.container);
  mine.click();
  await settle();
  assert.equal(empty.textContent, 'No images from you yet.');

  g.win.userName = '';
  await g.store.put(image({ id: 'b', user: 'alice', receivedAt: 2 }));
  await settle();
  assert.equal(mine.hidden, true);
  assert.equal(mine.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(g.tiles().map((t) => t.dataset.id), ['b', 'a']);
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

test('each tile shows its size on disk, orange from where it reads 1.0 MB, refreshed when a repair changes it', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a', receivedAt: 3, bytes: 1048063 }));
  await g.store.put(image({ id: 'b', receivedAt: 2, bytes: 1048064 }));
  await g.store.put(image({ id: 'c', receivedAt: 1, bytes: 1536, broken: true }));
  await g.store.put(image({ id: 'd', receivedAt: 0, bytes: 512, broken: true, blob: new Blob(['x']) }));
  const cleanup = g.mount();
  await settle();
  /** @param {string} id */
  const chip = (id) =>
    /** @type {HTMLElement} */ (g.tiles().find((t) => t.dataset.id === id)?.querySelector('.tdf-gallery-size'));
  assert.equal(chip('a').textContent, '1023 KB');
  assert.equal(chip('a').classList.contains('tdf-large'), false);
  assert.equal(chip('b').textContent, '1.0 MB');
  assert.ok(chip('b').classList.contains('tdf-large'));
  assert.equal(chip('c').textContent, '2 KB', 'an unavailable tile keeps its chip');
  assert.equal(chip('d').textContent, '512 B', 'a broken tile keeps its chip');

  const before = chip('c');
  await g.store.repair('c', { bytes: 2 * 1048576 });
  await settle();
  assert.equal(chip('c'), before, 'the same chip, updated in place');
  assert.equal(chip('c').textContent, '2.0 MB');
  assert.ok(chip('c').classList.contains('tdf-large'));

  const large = chip('b');
  await g.store.repair('b', { bytes: 1048063 });
  await settle();
  assert.equal(chip('b'), large, 'the same chip, updated in place');
  assert.equal(chip('b').textContent, '1023 KB');
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

test('a rejected action shows its reason on the button, reports it, and can be tried again at once, cooldown or not', async () => {
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

test('closing the flyout mid-cooldown clears its timer', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ cooldownMs: 5000 });
  const off = registerGalleryItemAction(action);
  /** @type {unknown[]} */
  const cleared = [];
  const clearTimeout = g.win.clearTimeout.bind(g.win);
  g.win.clearTimeout = (/** @type {any} */ id) => {
    cleared.push(id);
    clearTimeout(id);
  };
  const cleanup = g.mount();
  await settle();
  postButton(g.tiles()[0]).click();
  calls[0].resolve();
  await settle();
  assert.equal(postButton(g.tiles()[0]).title, 'Post — done');
  const before = cleared.length;
  cleanup();
  assert.ok(cleared.length > before, "the cooldown's redraw timer is cleared");
  off();
  assert.deepEqual(g.errors, []);
});

test('a refusal after the flyout closes is still reported, and the reopened tile shows it failed', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction();
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

test('an action that closes the flyout before it settles raises nothing, and the reopened tile is idle', async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  /** @type {() => void} */
  let cleanup = () => {};
  let runs = 0;
  // An action that closes the gallery itself, then resolves onto a tile no longer drawn.
  const off = registerGalleryItemAction({
    id: 'post',
    label: 'Re-post',
    onSelect: async () => {
      runs += 1;
      cleanup();
    },
  });
  cleanup = /** @type {() => void} */ (g.mount());
  await settle();
  const b = postButton(g.tiles()[0]);
  assert.equal(b.textContent, 'Re-post', 'a label with no icon renders as text');
  assert.equal(b.querySelector('svg'), null);
  assert.equal(b.title, 'Re-post');
  assert.equal(b.getAttribute('aria-label'), 'Re-post');
  b.click();
  await settle();
  assert.equal(runs, 1);
  assert.equal(g.container.querySelector('.tdf-gallery-tile'), null, 'the flyout closed');
  assert.deepEqual(g.errors, []);

  cleanup = /** @type {() => void} */ (g.mount());
  await settle();
  const again = postButton(g.tiles()[0]);
  assert.equal(again.classList.contains('tdf-busy'), false);
  assert.equal(again.classList.contains('tdf-failed'), false);
  assert.equal(again.getAttribute('aria-disabled'), 'false');
  assert.equal(again.title, 'Re-post');
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

// --- TDF-0060: drag to reorder -------------------------------------------------------------

/**
 * Lay the grid out as three 128px columns 6px apart, in DOM order skipping the lifted tile, which
 * keeps the rect it had when lifted; the flyout body is `height` px tall.
 * @param {Awaited<ReturnType<typeof open>>} g
 * @param {number} [height]
 */
function layout(g, height = 1000) {
  const { win, container } = g;
  /** @type {Map<Element, { left: number, top: number }>} */
  const lifted = new Map();
  /** @param {number} left @param {number} top @param {number} w @param {number} h */
  const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top });
  win.Element.prototype.getBoundingClientRect = function () {
    if (this === container) return rect(0, 0, 400, height);
    const grid = container.querySelector('.tdf-gallery-grid');
    if (this === grid) return rect(0, -container.scrollTop, 400, 1000);
    const cls = this.classList;
    if (this.parentElement === grid && (cls.contains('tdf-gallery-tile') || cls.contains('tdf-gallery-slot'))) {
      if (cls.contains('tdf-dragging')) {
        const at = lifted.get(this) ?? { left: 0, top: 0 };
        return rect(at.left, at.top, 128, 128);
      }
      const cells = [...grid.children].filter((c) => !c.classList.contains('tdf-dragging'));
      const i = cells.indexOf(this);
      const r = rect((i % 3) * 134, Math.floor(i / 3) * 134 - container.scrollTop, 128, 128);
      lifted.set(this, { left: r.left, top: r.top });
      return r;
    }
    return rect(0, 0, 0, 0);
  };
}

/** Centre of grid cell `i` in client coordinates. @param {number} i */
const cell = (i) => ({ x: (i % 3) * 134 + 64, y: Math.floor(i / 3) * 134 + 64 });

/**
 * @param {Awaited<ReturnType<typeof open>>} g
 * @param {string} type
 * @param {EventTarget} target
 * @param {{ x: number, y: number }} at
 * @param {string} [pointerType]
 * @param {{ button?: number }} [init]
 */
const pointer = (g, type, target, at, pointerType = 'mouse', init = {}) =>
  target.dispatchEvent(
    new g.win.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      pointerId: 1,
      pointerType,
      button: 0,
      ...init,
    }),
  );

/**
 * Press tile `from`, move past the threshold, move over cell `to`, release, and click as a
 * browser would after the release.
 * @param {Awaited<ReturnType<typeof open>>} g
 * @param {number} from
 * @param {number} to
 */
function mouseDrag(g, from, to) {
  const el = g.tiles()[from];
  pointer(g, 'pointerdown', el, cell(from));
  pointer(g, 'pointermove', el, { x: cell(from).x + 10, y: cell(from).y });
  pointer(g, 'pointermove', el, cell(to));
  pointer(g, 'pointerup', el, cell(to));
  /** @type {HTMLElement} */ (el).click();
}

/** @param {Awaited<ReturnType<typeof open>>} g */
const ids = (g) => g.tiles().map((t) => t.dataset.id);

/** Four images, newest first: a b c d. @param {Awaited<ReturnType<typeof open>>} g */
async function four(g) {
  for (const [id, at] of /** @type {const} */ ([['a', 4000], ['b', 3000], ['c', 2000], ['d', 1000]])) {
    await g.store.put(image({ id, receivedAt: at }));
  }
}

test("Re-post, with its 5-second cooldown, reads 'Re-post — done' after a post and stays blocked", async () => {
  const g = await open();
  await g.store.put(image({ id: 'a' }));
  const { action, calls } = deferredAction({ label: 'Re-post', cooldownMs: 5000 });
  const off = registerGalleryItemAction(action);
  const cleanup = g.mount();
  await settle();
  const b = postButton(g.tiles()[0]);
  b.click();
  calls[0].resolve();
  await settle();
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  assert.equal(b.title, 'Re-post — done');
  assert.equal(b.getAttribute('aria-label'), 'Re-post — done');
  b.click();
  assert.equal(calls.length, 1, 'no second post within the cooldown');
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a mouse drag past 6 px reorders the grid, stores it, and opens nothing (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  /** @type {unknown[][]} */
  const moves = [];
  const move = g.store.move.bind(g.store);
  g.store.move = (...args) => (moves.push(args), move(...args));
  const cleanup = g.mount();
  await settle();
  layout(g);
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);

  mouseDrag(g, 3, 1);
  assert.deepEqual(ids(g), ['a', 'd', 'b', 'c'], 'the tile drops into the slot at once');
  assert.deepEqual(moves, [['d', 'a', 'b']], 'move gets the visible neighbours of the slot');
  assert.deepEqual(g.opened, [], 'the click after a drag is swallowed');
  await settle();
  assert.deepEqual(ids(g), ['a', 'd', 'b', 'c']);
  assert.deepEqual((await g.store.list()).map((r) => r.id), ['a', 'd', 'b', 'c']);
  assert.equal(g.container.querySelector('.tdf-gallery-slot'), null);
  assert.equal(g.container.querySelector('.tdf-dragging'), null);

  mouseDrag(g, 0, 3);
  await settle();
  assert.deepEqual(ids(g), ['d', 'b', 'c', 'a'], 'to the end');

  await new Promise((r) => setTimeout(r, 5));
  /** @type {HTMLElement} */ (g.tiles()[0]).click();
  assert.deepEqual(g.opened, ['d'], 'the next plain click opens again');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a press that moves less than 6 px is a click: it opens the tile and writes nothing (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[1];
  pointer(g, 'pointerdown', el, cell(1));
  pointer(g, 'pointermove', el, { x: cell(1).x + 3, y: cell(1).y + 3 });
  pointer(g, 'pointerup', el, { x: cell(1).x + 3, y: cell(1).y + 3 });
  /** @type {HTMLElement} */ (el).click();
  assert.deepEqual(g.opened, ['b']);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
});

test('a drop back into its own slot writes nothing (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[1];
  pointer(g, 'pointerdown', el, cell(1));
  pointer(g, 'pointermove', el, cell(2));
  pointer(g, 'pointermove', el, cell(1));
  pointer(g, 'pointerup', el, cell(1));
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
});

test('a press on the star, the trash or an action button never starts a drag (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const off = registerGalleryItemAction({ id: 'post', label: 'Post', onSelect: () => {} });
  const cleanup = g.mount();
  await settle();
  layout(g);
  for (const sel of ['.tdf-gallery-star', '.tdf-gallery-trash', '[data-action="post"]']) {
    const button = /** @type {Element} */ (g.tiles()[3].querySelector(sel));
    pointer(g, 'pointerdown', button, cell(3));
    pointer(g, 'pointermove', button, { x: cell(3).x + 20, y: cell(3).y });
    pointer(g, 'pointermove', button, cell(0));
    assert.equal(g.container.querySelector('.tdf-dragging'), null, sel);
    assert.equal(g.container.querySelector('.tdf-gallery-slot'), null, sel);
    pointer(g, 'pointerup', button, cell(0));
  }
  assert.equal((await g.store.stats()).positioned, 0);
  off();
  cleanup();
});

test('touch: a 350 ms hold starts the drag; a move before it is a scroll (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  let el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3), 'touch');
  pointer(g, 'pointermove', el, { x: cell(3).x, y: cell(3).y - 20 }, 'touch');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(g.container.querySelector('.tdf-dragging'), null, 'an early move cancels the hold');
  const early = new g.win.Event('touchmove', { bubbles: true, cancelable: true });
  el.dispatchEvent(early);
  assert.equal(early.defaultPrevented, false, 'an early swipe scrolls');
  pointer(g, 'pointercancel', el, cell(3), 'touch');

  el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3), 'touch');
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(el.classList.contains('tdf-dragging'), 'the hold lifts the tile');
  const held = new g.win.Event('touchmove', { bubbles: true, cancelable: true });
  el.dispatchEvent(held);
  assert.equal(held.defaultPrevented, true, 'a started drag keeps the flyout still');
  pointer(g, 'pointermove', el, cell(0), 'touch');
  pointer(g, 'pointerup', el, cell(0), 'touch');
  await settle();
  assert.deepEqual(ids(g), ['d', 'a', 'b', 'c']);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('pointercancel and Escape put a lifted tile back and write nothing (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  let el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(0));
  pointer(g, 'pointercancel', el, cell(0));
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.equal(g.container.querySelector('.tdf-gallery-slot'), null);

  el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(0));
  g.win.document.dispatchEvent(new g.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(el.classList.contains('tdf-dragging'), false);
  pointer(g, 'pointerup', el, cell(0));
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
});

test('under the favourites filter a move lands between its visible neighbours; hidden tiles keep their place (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  await g.store.setFavorite('a', true);
  await g.store.setFavorite('c', true);
  await g.store.setFavorite('d', true);
  const cleanup = g.mount();
  await settle();
  layout(g);
  /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-favfilter')).click();
  await settle();
  assert.deepEqual(ids(g), ['a', 'c', 'd']);
  mouseDrag(g, 2, 1);
  await settle();
  assert.deepEqual(ids(g), ['a', 'd', 'c']);
  const all = (await g.store.list()).map((r) => r.id);
  assert.deepEqual(all.filter((id) => id !== 'd'), ['a', 'b', 'c'], 'b, hidden, keeps its place among the others');
  assert.ok(all.indexOf('d') > all.indexOf('a') && all.indexOf('d') < all.indexOf('c'));
  assert.equal((await g.store.get('b'))?.position, undefined);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a capture arriving mid-drag does not rearrange the grid until the drop (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(1));
  await g.store.put(image({ id: 'new', receivedAt: 9000 }));
  await settle();
  assert.equal(g.tiles().some((t) => t.dataset.id === 'new'), false, 'the capture waits');
  assert.ok(g.container.querySelector('.tdf-gallery-slot'), 'the slot is still in place');
  pointer(g, 'pointerup', el, cell(1));
  await settle();
  assert.deepEqual(ids(g), ['new', 'a', 'd', 'b', 'c'], 'the capture lands on top and the drop is kept');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('quickview walks the grid in its manual order after a move (TDF-0060)', async () => {
  const g = await open(undefined, { quickview: { on: true } });
  g.win.document.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  mouseDrag(g, 3, 0);
  await settle();
  assert.deepEqual(ids(g), ['d', 'a', 'b', 'c']);
  await new Promise((r) => setTimeout(r, 5));
  const doc = g.win.document;
  g.tiles()[1].click();
  assert.equal(doc.querySelector('.tdf-lb-count')?.textContent, '2 / 4');
  assert.match(String(doc.querySelector('.tdf-lb-stage img')?.getAttribute('src')), /view\.php\?id=a$/);
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-prev')).click();
  assert.match(String(doc.querySelector('.tdf-lb-stage img')?.getAttribute('src')), /view\.php\?id=d$/, 'previous is the moved tile');
  /** @type {HTMLElement} */ (doc.querySelector('.tdf-lb-close')).click();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('Reset order shows only while a manual order exists and resets on a second press (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const reset = /** @type {HTMLButtonElement} */ (g.container.querySelector('.tdf-gallery-reset'));
  assert.equal(reset.hidden, true);
  mouseDrag(g, 3, 0);
  await settle();
  assert.equal(reset.hidden, false);
  assert.equal(reset.textContent, 'Reset order');

  reset.click();
  await settle();
  assert.equal(reset.textContent, 'Reset order?', 'the first press only arms it');
  assert.ok(reset.classList.contains('tdf-armed'));
  assert.deepEqual(ids(g), ['d', 'a', 'b', 'c']);
  reset.click();
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd'], 'the second press resets to newest first');
  assert.equal(reset.hidden, true);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('Reset order disarms after 4 s without a second press (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  await g.store.move('d', null, 'a');
  /** @type {(() => void)[]} */
  const timers = [];
  const cleanup = g.mount();
  await settle();
  const realSet = g.win.setTimeout.bind(g.win);
  g.win.setTimeout = /** @type {any} */ ((/** @type {() => void} */ fn, /** @type {number} */ ms) => {
    if (ms === 4000) {
      timers.push(fn);
      return 1;
    }
    return realSet(fn, ms);
  });
  const reset = /** @type {HTMLButtonElement} */ (g.container.querySelector('.tdf-gallery-reset'));
  assert.equal(reset.hidden, false);
  reset.click();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(reset.textContent, 'Reset order');
  reset.click();
  await settle();
  assert.equal((await g.store.stats()).positioned, 1, 'a press after the window only arms again');
  cleanup();
});

test('drag CSS: the lifted tile is absolute against a relative grid, and the slot is a 128px cell (TDF-0060)', () => {
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  assert.match(css, /\.tdf-gallery-grid \{\s*\/\*[^*]*\*\/\s*position: relative;/);
  assert.match(css, /\.tdf-gallery-tile\.tdf-dragging \{[^}]*position: absolute;/);
  assert.match(css, /\.tdf-gallery-slot \{[^}]*width: 128px;[^}]*height: 128px;/);
  assert.match(css, /\.tdf-gallery-reset\[hidden\] \{\s*display: none;/);
});

/** The grid of a mounted gallery. @param {Awaited<ReturnType<typeof open>>} g */
const gridOf = (g) => /** @type {HTMLElement} */ (g.container.querySelector('.tdf-gallery-grid'));

/** Whether a contextmenu on `el` was held back. @param {Awaited<ReturnType<typeof open>>} g @param {Element} el */
const menuPrevented = (g, el) => {
  const event = new g.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event.defaultPrevented;
};

test('a refresh already in flight when a drag starts finishes after the drop instead (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  /** @type {Promise<void> | null} */
  let held = null;
  let letGo = () => {};
  const list = g.store.list.bind(g.store);
  g.store.list = async () => {
    const rows = await list();
    if (held) await held;
    return rows;
  };
  held = new Promise((r) => (letGo = () => r()));
  await g.store.put(image({ id: 'new', receivedAt: 9000 }));
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(1));
  const grid = gridOf(g);
  const before = [...grid.children];
  assert.ok(grid.querySelector('.tdf-gallery-slot'));
  held = null;
  letGo();
  await settle();
  assert.equal(g.tiles().some((t) => t.dataset.id === 'new'), false, 'the refresh that began before the drag waits');
  const now = [...grid.children];
  assert.ok(now.length === before.length && now.every((c, i) => c === before[i]), 'the grid, slot included, is untouched');

  pointer(g, 'pointercancel', el, cell(1));
  await settle();
  assert.deepEqual(ids(g), ['new', 'a', 'b', 'c', 'd'], 'the owed refresh runs once the press ends');
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a drop with a refresh owed never shows the old order again (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(1));
  await g.store.put(image({ id: 'new', receivedAt: 9000 }));
  await settle();
  /** @type {string[]} */
  const seen = [];
  const observer = new g.win.MutationObserver(() => seen.push(ids(g).filter((id) => id !== 'new').join('')));
  observer.observe(gridOf(g), { childList: true });
  pointer(g, 'pointerup', el, cell(1));
  await settle();
  await settle();
  observer.disconnect();
  assert.deepEqual(ids(g), ['new', 'a', 'd', 'b', 'c']);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((s) => s === 'adbc'), `the grid went through ${seen.join(', ')}`);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a drag near the bottom edge scrolls the flyout each frame up to its limit, and the slot follows (TDF-0060)', async () => {
  const g = await open();
  for (let i = 0; i < 12; i++) await g.store.put(image({ id: `t${String(i).padStart(2, '0')}`, receivedAt: 1000 - i }));
  const cleanup = g.mount();
  await settle();
  // 300px tall over four rows of tiles, 530px: it scrolls 230px.
  layout(g, 300);
  const max = 230;
  let scroll = 0;
  Object.defineProperty(g.container, 'scrollTop', {
    configurable: true,
    get: () => scroll,
    set: (/** @type {number} */ v) => {
      scroll = Math.max(0, Math.min(max, v));
    },
  });
  /** @type {Map<number, () => void>} */
  const frames = new Map();
  /** @type {number[]} */
  const cancelled = [];
  let seq = 0;
  g.win.requestAnimationFrame = (/** @type {() => void} */ fn) => {
    frames.set(++seq, fn);
    return seq;
  };
  g.win.cancelAnimationFrame = (/** @type {number} */ id) => {
    cancelled.push(id);
    frames.delete(id);
  };
  const flush = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const fn of due) fn();
  };
  const grid = gridOf(g);
  const slotAt = () =>
    [...grid.children].filter((c) => !c.classList.contains('tdf-dragging')).findIndex((c) => c.classList.contains('tdf-gallery-slot'));
  // 30px into the 40px zone above the bottom edge.
  const edge = { x: 64, y: 290 };

  let el = g.tiles()[0];
  pointer(g, 'pointerdown', el, cell(0));
  pointer(g, 'pointermove', el, { x: 74, y: 64 });
  pointer(g, 'pointermove', el, edge);
  assert.equal(slotAt(), 6, 'over the third row before any scroll');
  assert.equal(frames.size, 1);
  flush();
  assert.equal(scroll, 8, 'a quarter of the depth into the zone, each frame');
  const steps = [scroll];
  for (let i = 0; i < 100 && frames.size; i++) {
    flush();
    steps.push(scroll);
  }
  assert.equal(scroll, max, 'it stops at the scroll limit');
  assert.equal(frames.size, 0, 'and asks for no further frame');
  assert.ok(steps.every((s, i) => i === 0 || s > steps[i - 1] || s === max));
  assert.equal(slotAt(), 9, 'the slot follows the pointer down the scrolled grid');
  assert.equal(el.style.transform, `translate(-10px, ${edge.y - 64 + max}px)`);
  pointer(g, 'pointercancel', el, edge);

  scroll = 0;
  el = g.tiles()[0];
  pointer(g, 'pointerdown', el, cell(0));
  pointer(g, 'pointermove', el, { x: 74, y: 64 });
  pointer(g, 'pointermove', el, edge);
  flush();
  assert.equal(scroll, 8);
  assert.equal(frames.size, 1);
  const [pending] = frames.keys();
  pointer(g, 'pointerup', el, edge);
  assert.ok(cancelled.includes(pending), 'the drop cancels the pending frame');
  assert.equal(frames.size, 0);
  flush();
  assert.equal(scroll, 8, 'nothing scrolls after the drop');
  await settle();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test("drag guards: a non-primary button, a tile being removed, and the browser's own drag and long-press menu (TDF-0060)", async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3), 'mouse', { button: 2 });
  pointer(g, 'pointermove', el, cell(0));
  assert.equal(g.container.querySelector('.tdf-gallery-slot'), null, 'a right press does not drag');
  pointer(g, 'pointerup', el, cell(0), 'mouse', { button: 2 });

  el.classList.add('tdf-removing');
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(0));
  assert.equal(g.container.querySelector('.tdf-gallery-slot'), null, 'a tile on its way out does not drag');
  assert.equal(menuPrevented(g, el), false, 'and is not pressed');
  pointer(g, 'pointerup', el, cell(0));
  el.classList.remove('tdf-removing');

  assert.equal(menuPrevented(g, el), false, "with no press the menu is the browser's");
  pointer(g, 'pointerdown', el, cell(3), 'touch');
  assert.equal(menuPrevented(g, el), true, 'a press holds the long-press menu back');
  pointer(g, 'pointerup', el, cell(3), 'touch');
  assert.equal(menuPrevented(g, el), false);

  const native = new g.win.Event('dragstart', { bubbles: true, cancelable: true });
  /** @type {Element} */ (el.querySelector('.tdf-gallery-thumb')).dispatchEvent(native);
  assert.equal(native.defaultPrevented, true, "the browser's own drag is refused");
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('a registry change mid-drag ends the press and leaves no slot (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(1));
  assert.ok(g.container.querySelector('.tdf-gallery-slot'));
  const off = registerGalleryItemAction({ id: 'like', label: 'Like', onSelect: () => {} });
  assert.equal(g.container.querySelector('.tdf-gallery-slot'), null);
  assert.equal(el.classList.contains('tdf-dragging'), false);
  pointer(g, 'pointermove', el, cell(0));
  pointer(g, 'pointerup', el, cell(0));
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.deepEqual(g.tiles().map((t) => t.querySelectorAll('[data-action="like"]').length), [1, 1, 1, 1]);
  assert.equal((await g.store.stats()).positioned, 0);
  off();
  cleanup();
  assert.deepEqual(g.errors, []);
});

test('closing the flyout mid-drag ends the press, leaves no slot, and runs no owed refresh (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  const grid = gridOf(g);
  const el = g.tiles()[3];
  pointer(g, 'pointerdown', el, cell(3));
  pointer(g, 'pointermove', el, cell(1));
  await g.store.put(image({ id: 'new', receivedAt: 9000 }));
  await settle();
  let lists = 0;
  const list = g.store.list.bind(g.store);
  g.store.list = () => (lists++, list());
  cleanup();
  assert.equal(grid.querySelector('.tdf-gallery-slot'), null);
  assert.equal(el.classList.contains('tdf-dragging'), false);
  pointer(g, 'pointermove', el, cell(0));
  pointer(g, 'pointerup', el, cell(0));
  await settle();
  assert.equal(lists, 0, 'the owed refresh does not run after close');
  assert.equal((await g.store.stats()).positioned, 0);
  assert.deepEqual(g.errors, []);
});

test('a move the store refuses is reported and the grid returns to the stored order (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  g.store.move = () => Promise.reject(new Error('move refused'));
  mouseDrag(g, 3, 1);
  assert.deepEqual(ids(g), ['a', 'd', 'b', 'c']);
  await settle();
  assert.deepEqual(ids(g), ['a', 'b', 'c', 'd']);
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['move refused']);
  cleanup();
});

test('a Reset order the store refuses is reported (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  await g.store.move('d', null, 'a');
  const cleanup = g.mount();
  await settle();
  g.store.resetOrder = () => Promise.reject(new Error('reset refused'));
  const reset = /** @type {HTMLButtonElement} */ (g.container.querySelector('.tdf-gallery-reset'));
  reset.click();
  reset.click();
  await settle();
  assert.deepEqual(g.errors.map((e) => /** @type {Error} */ (e).message), ['reset refused']);
  assert.deepEqual(ids(g), ['d', 'a', 'b', 'c']);
  cleanup();
});

test('a press whose tile a refresh removed before the drag began ends quietly (TDF-0060)', async () => {
  const g = await open();
  await four(g);
  const cleanup = g.mount();
  await settle();
  layout(g);
  /** @type {unknown[]} */
  const failures = [];
  g.win.addEventListener('error', (/** @type {any} */ e) => failures.push(e.error ?? e.message));
  const logged = console.error;
  console.error = () => {};
  try {
    const el = g.tiles()[3];
    pointer(g, 'pointerdown', el, cell(3));
    await g.store.remove('d');
    await settle();
    assert.deepEqual(ids(g), ['a', 'b', 'c']);
    // The pressed tile is gone, so the moves reach the document from whatever is under the pointer.
    const doc = g.win.document;
    pointer(g, 'pointermove', doc, cell(1));
    pointer(g, 'pointermove', doc, cell(0));
    assert.deepEqual(failures, [], 'nothing throws');
    assert.equal(g.container.querySelector('.tdf-gallery-slot'), null);
    assert.equal(menuPrevented(g, g.tiles()[0]), false, 'the press has ended');
    pointer(g, 'pointerup', doc, cell(0));

    // A touch hold whose tile goes before the 350 ms are up.
    const touched = g.tiles()[2];
    pointer(g, 'pointerdown', touched, cell(2), 'touch');
    await g.store.remove('c');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(failures, [], 'nor does the hold timer');
    assert.equal(g.container.querySelector('.tdf-gallery-slot'), null);
    assert.equal(menuPrevented(g, g.tiles()[0]), false);
    pointer(g, 'pointerup', doc, cell(2), 'touch');
  } finally {
    console.error = logged;
  }
  await settle();
  assert.deepEqual(ids(g), ['a', 'b']);
  assert.equal((await g.store.stats()).positioned, 0);
  cleanup();
  assert.deepEqual(g.errors, []);
});
