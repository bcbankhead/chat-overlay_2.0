import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { isPicked, renderAvatar } from '../src/core/avatar.js';
import { tileSlot } from '../src/core/initials.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A resolver answering `url` for every name, recording each call. */
function stubResolver(url) {
  const calls = [];
  return { calls, resolve: (name, userID) => (calls.push([name, userID]), Promise.resolve(url)) };
}

function render(over = {}) {
  const win = new Window({ url: 'https://example.test/chat/' });
  const doc = win.document;
  const box = renderAvatar(/** @type {any} */ (doc), { name: 'bobSmith', file: 'bob.jpg', src: 'avatars/40/bob.jpg', className: 'tdf-avatar', ...over });
  doc.body.appendChild(box);
  const fire = (img, type) => img.dispatchEvent(new win.Event(type));
  return { win, box, fire, img: () => box.querySelector('img'), tile: () => box.querySelector('.tdf-tile') };
}

test('online.gif, share.gif and an empty value are not picked avatars', () => {
  assert.equal(isPicked('bob.jpg'), true);
  assert.equal(isPicked('online.gif'), false);
  assert.equal(isPicked('share.gif'), false);
  assert.equal(isPicked(''), false);
});

test('every avatar carries the initials tile under it, coloured by slot', () => {
  const { box, tile } = render();
  assert.equal(box.className, 'tdf-avatar');
  assert.equal(tile().textContent, 'BS');
  assert.equal(tile().dataset.tile, String(tileSlot('bobSmith')));
  assert.equal(tile().getAttribute('aria-hidden'), 'true');
});

test('a picked avatar shows at once and is never looked up', async () => {
  const resolver = stubResolver('https://f/x.jpg');
  const { img } = render({ resolver });
  assert.equal(img().getAttribute('src'), 'avatars/40/bob.jpg');
  assert.equal(img().getAttribute('loading'), 'lazy');
  await settle();
  assert.equal(resolver.calls.length, 0);
});

for (const file of ['online.gif', 'share.gif', '']) {
  test(`with ${file || 'no avatar'} the tile shows, and the forum picture covers it once loaded`, async () => {
    const resolver = stubResolver('https://f/bob.jpg');
    const { img, tile } = render({ file, userID: '42', resolver });
    assert.equal(img(), null);
    assert.ok(tile());
    await settle();
    assert.deepEqual(resolver.calls, [['bobSmith', '42']]);
    assert.equal(img(), null, 'not added before it loads');
  });
}

test('the forum picture is added on load and dropped on error, leaving the tile', async () => {
  const win = new Window({ url: 'https://example.test/chat/' });
  const doc = win.document;
  /** @type {HTMLImageElement[]} */
  const made = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === 'img') made.push(/** @type {any} */ (el));
    return el;
  };
  const loaded = renderAvatar(/** @type {any} */ (doc), { name: 'a', file: 'online.gif', src: 'avatars/40/online.gif', className: 'tdf-avatar', resolver: stubResolver('https://f/a.jpg') });
  const failed = renderAvatar(/** @type {any} */ (doc), { name: 'b', file: 'online.gif', src: 'avatars/40/online.gif', className: 'tdf-avatar', resolver: stubResolver('https://f/b.jpg') });
  await settle();
  assert.equal(made.length, 2);
  assert.equal(made[0].getAttribute('src'), 'https://f/a.jpg');
  made[0].dispatchEvent(new win.Event('load'));
  made[1].dispatchEvent(new win.Event('error'));
  assert.equal(loaded.querySelector('img'), made[0]);
  assert.equal(failed.querySelector('img'), null);
  assert.ok(failed.querySelector('.tdf-tile'));
});

test('no forum picture, or no resolver, leaves the tile', async () => {
  const none = render({ file: 'online.gif', resolver: stubResolver(null) });
  const alone = render({ file: 'online.gif' });
  await settle();
  assert.equal(none.img(), null);
  assert.equal(alone.img(), null);
  assert.ok(none.tile() && alone.tile());
});

test('a broken picked avatar is removed and the forum picture is looked up', async () => {
  const resolver = stubResolver(null);
  const { fire, img, tile } = render({ resolver });
  fire(img(), 'error');
  assert.equal(img(), null);
  assert.ok(tile());
  await settle();
  assert.deepEqual(resolver.calls, [['bobSmith', '']]);
});

test('a forum picture already found this page load is added at once, and dropped on error', async () => {
  const known = { calls: 0, peek: () => 'https://f/bob.jpg', resolve: () => (known.calls++, Promise.resolve('https://f/bob.jpg')) };
  const { img, tile, fire } = render({ file: 'online.gif', resolver: known });
  assert.equal(img()?.getAttribute('src'), 'https://f/bob.jpg', 'added synchronously');
  assert.ok(tile());
  assert.equal(known.calls, 0);
  fire(img(), 'error');
  assert.equal(img(), null);
  assert.ok(tile());
});

test('an answer of no picture already found this page load leaves the tile without asking again', async () => {
  const none = { calls: 0, peek: () => null, resolve: () => (none.calls++, Promise.resolve(null)) };
  const { img } = render({ file: 'online.gif', resolver: none });
  await settle();
  assert.equal(img(), null);
  assert.equal(none.calls, 0);
});

test('an unsettled answer is still waited for and added on load', async () => {
  const later = { calls: 0, peek: () => undefined, resolve: () => (later.calls++, Promise.resolve('https://f/bob.jpg')) };
  const { img } = render({ file: 'online.gif', resolver: later });
  assert.equal(img(), null);
  await settle();
  assert.equal(later.calls, 1);
  assert.equal(img(), null, 'not added before it loads');
});
