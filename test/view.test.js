import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_REPLAY_LIMIT } from '../src/core/history.js';
import { createView } from '../src/core/view.js';

async function setup({ autoScroll = true, globals = {} } = {}) {
  const win = new Window({ url: 'https://example.test/chat/' });
  Object.assign(win, globals);
  const doc = win.document;
  doc.body.innerHTML = `<div id="chatContainer"></div><input type="checkbox" id="autoScrollID" ${autoScroll ? 'checked' : ''}>`;
  win.addSmilie = (t) => t.split(':h').join('<img src="smilies/heart.gif">');
  const whispered = [];
  win.whisperUser = (name) => whispered.push(name);
  const container = doc.getElementById('chatContainer');
  const view = createView({ doc, win, container, css: '#tdf-chat{}' });
  const root = doc.getElementById('tdf-chat');
  return { win, doc, view, root, container, whispered };
}

const rec = (over) => ({
  id: '1', roomID: '1', mTime: '100', user: 'bob', toUser: '', kind: 'public',
  avatar: 'a.gif', color: '#cc0000', size: '30px', family: 'georgia', text: 'hi',
  ircFlag: '0', lineBreakFlag: '0', receivedAt: 1, ...over,
});
const msgs = (root) => [...root.querySelectorAll('.tdf-msg')];

test('mounts over the hidden engine container with its styles', async () => {
  const { doc, root, container } = await setup();
  assert.equal(container.style.visibility, 'hidden');
  assert.equal(container.nextElementSibling, root);
  assert.equal(doc.getElementById('tdf-chat-style').textContent, '#tdf-chat{}');
});

test('an entry keeps its sender colour per theme, not family or size, and expands smilies', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'love :h' }));
  const [el] = msgs(root);
  const line = el.querySelector('.tdf-line');
  assert.equal(line.style.getPropertyValue('--tdf-ink-light'), '#cc0000');
  assert.equal(line.style.getPropertyValue('--tdf-ink-dark'), '#f13e2f');
  assert.equal(line.style.color, '');
  assert.equal(line.style.fontFamily, '');
  assert.equal(line.style.fontSize, '');
  assert.equal(el.querySelector('.tdf-user').textContent, 'bob');
  assert.ok(el.querySelector('.tdf-user').classList.contains('tdf-sep'));
  assert.ok(el.querySelector('.tdf-body img[src="smilies/heart.gif"]'));
  assert.ok(el.classList.contains('tdf-kind-public'));
});

test('a smilie with a white matte shows its cleaned copy; others keep the site source', async () => {
  const { win, view, root } = await setup();
  const heart = win.addSmilie;
  win.addSmilie = (t) => heart(t).split(':d').join("<img src='smilies/biggrin.gif'>");
  view.append(rec({ text: ':d :h' }));
  const [fixed, plain] = msgs(root)[0].querySelectorAll('.tdf-body img');
  assert.match(fixed.getAttribute('src'), /^data:image\/gif;base64,/);
  assert.equal(plain.getAttribute('src'), 'smilies/heart.gif');
});

test('entry/exit lines show no name; irc lines show no separator; line breaks use pre', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: 'e', kind: 'entry', avatar: '1', text: '** bob has joined the room ...' }));
  view.append(rec({ id: 'w', kind: 'whisper', ircFlag: '1', text: ' &#187; alice: psst' }));
  view.append(rec({ id: 'p', text: 'a\nb', lineBreakFlag: '1' }));
  const [entry, whisper, multi] = msgs(root);
  assert.equal(entry.querySelector('.tdf-user'), null);
  assert.ok(!whisper.querySelector('.tdf-user').classList.contains('tdf-sep'));
  assert.ok(whisper.classList.contains('tdf-irc'));
  assert.equal(multi.querySelector('.tdf-body pre').textContent, 'a\nb');
});

test('low-contrast sender colours are shifted per theme, never chipped', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: 'k', color: '#000000' }));
  view.append(rec({ id: 'b', color: '#003366' }));
  view.append(rec({ id: 'p', color: '#ff69b4' }));
  const [black, blue, pink] = msgs(root);
  const ink = (el, theme) => el.querySelector('.tdf-line').style.getPropertyValue(`--tdf-ink-${theme}`);
  assert.equal(ink(black, 'light'), '#000000');
  assert.equal(ink(black, 'dark'), ''); // unset: the theme's text colour
  assert.equal(ink(blue, 'dark'), '#5585be');
  assert.equal(ink(pink, 'light'), '#cd3a89');
  for (const el of msgs(root)) {
    assert.ok(![...el.classList].some((c) => c.startsWith('tdf-ink')));
  }
});

test('a record with no sender colour sets no ink, so the line takes the theme text', async () => {
  const { view, root } = await setup();
  view.append(rec({ color: '' }));
  const line = root.querySelector('.tdf-line');
  assert.equal(line.style.getPropertyValue('--tdf-ink-light'), '');
  assert.equal(line.style.getPropertyValue('--tdf-ink-dark'), '');
});

test('notices never take a sender colour, an avatar or a group', async () => {
  const { view, root } = await setup();
  for (const kind of ['entry', 'exit', 'system']) view.append(rec({ id: kind, kind, color: '#003366' }));
  for (const el of msgs(root)) {
    const line = el.querySelector('.tdf-line');
    assert.equal(line.style.getPropertyValue('--tdf-ink-light'), '');
    assert.equal(line.style.getPropertyValue('--tdf-ink-dark'), '');
    assert.equal(el.querySelector('.tdf-avatar'), null);
    assert.ok(!el.classList.contains('tdf-head') && !el.classList.contains('tdf-cont'));
  }
});

const heads = (root) => msgs(root).map((el) => (el.classList.contains('tdf-cont') ? 'c' : el.classList.contains('tdf-head') ? 'h' : '-'));

test('a run from one sender groups under one header; a gap, sender change or whisper breaks it', async () => {
  const { view, root } = await setup();
  view.replay([
    rec({ id: '1', mTime: '1000' }),
    rec({ id: '2', mTime: '1100' }),
    rec({ id: '3', mTime: '1400' }), // 300 s after 2: still the run
    rec({ id: '4', mTime: '1701' }), // 301 s: new group
    rec({ id: '5', mTime: '1702', user: 'alice' }),
    rec({ id: '6', mTime: '1703', user: 'alice', kind: 'whisper' }),
    rec({ id: '7', mTime: '1704', user: 'alice' }),
  ]);
  assert.deepEqual(heads(root), ['h', 'c', 'c', 'h', 'h', 'h', 'h']);
  view.append(rec({ id: '8', mTime: '1705', user: 'alice' }));
  assert.equal(heads(root).at(-1), 'c');
});

test('a notice breaks a group; the next message heads its own', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: '1', mTime: '1000' }));
  view.append(rec({ id: 'e', mTime: '1001', kind: 'entry', user: 'carol' }));
  view.append(rec({ id: '2', mTime: '1002' }));
  view.notice('Chat history not saved: x');
  view.append(rec({ id: '3', mTime: '1003' }));
  assert.deepEqual(heads(root), ['h', '-', 'h', '-', 'h']);
});

test('a head row carries avatar, name and time; a missing avatar shows the initials tile', async () => {
  const { view, root } = await setup();
  const t = new Date(2026, 0, 2, 9, 7).getTime() / 1000;
  view.append(rec({ id: '1', mTime: String(t), avatar: 'bob.gif' }));
  view.append(rec({ id: '2', mTime: String(t + 1), user: 'alice', avatar: '' }));
  const [bob, alice] = msgs(root);
  const img = bob.querySelector('.tdf-avatar img');
  assert.equal(img.getAttribute('src'), 'avatars/40/bob.gif');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.equal(bob.querySelector('.tdf-avatar .tdf-tile').textContent, 'BO');
  assert.equal(bob.querySelector('.tdf-time').textContent, '09:07');
  assert.equal(alice.querySelector('.tdf-avatar img'), null);
  assert.equal(alice.querySelector('.tdf-avatar .tdf-tile').textContent, 'AL');
  img.dispatchEvent(new root.ownerDocument.defaultView.Event('error'));
  assert.equal(bob.querySelector('.tdf-avatar img'), null);
  assert.ok(bob.querySelector('.tdf-avatar .tdf-tile'));
});

test('a sender-supplied avatar name is encoded into one path segment', async () => {
  const { view, root } = await setup();
  view.append(rec({ avatar: '../x.php?a=1#b' }));
  assert.equal(root.querySelector('.tdf-avatar img').getAttribute('src'), 'avatars/40/..%2Fx.php%3Fa%3D1%23b');
});

test('online.gif and share.gif senders get the tile, then their forum picture; a picked avatar is unchanged', async () => {
  const win = new Window({ url: 'https://example.test/chat/' });
  const doc = win.document;
  doc.body.innerHTML = '<div id="chatContainer"></div>';
  win.addSmilie = (t) => t;
  const asked = [];
  const avatars = { resolve: (name) => (asked.push(name), Promise.resolve(`https://example.test/f/${encodeURIComponent(name)}.jpg`)) };
  const made = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === 'img') made.push(el);
    return el;
  };
  const view = createView({ doc, win, container: doc.getElementById('chatContainer'), css: '', avatars });
  view.append(rec({ id: '1', user: 'BatteriesNotIncluded', avatar: 'online.gif' }));
  view.append(rec({ id: '2', user: 'Dick%20Vicious', avatar: 'share.gif' }));
  view.append(rec({ id: '3', user: 'Siliconeman', avatar: 'sm.jpg' }));
  const [dot, share, picked] = msgs(doc.getElementById('tdf-chat'));
  assert.equal(dot.querySelector('.tdf-avatar .tdf-tile').textContent, 'BN');
  assert.equal(share.querySelector('.tdf-avatar .tdf-tile').textContent, 'DV');
  assert.equal(dot.querySelector('.tdf-avatar img'), null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ['BatteriesNotIncluded', 'Dick Vicious']);
  for (const img of made.filter((i) => i.getAttribute('src')?.startsWith('https://example.test/f/'))) {
    img.dispatchEvent(new win.Event('load'));
  }
  assert.equal(dot.querySelector('.tdf-avatar img').getAttribute('src'), 'https://example.test/f/BatteriesNotIncluded.jpg');
  assert.equal(share.querySelector('.tdf-avatar img').getAttribute('src'), 'https://example.test/f/Dick%20Vicious.jpg');
  assert.equal(picked.querySelector('.tdf-avatar img').getAttribute('src'), 'avatars/40/sm.jpg');
});

test('a pending message is timed by receipt and regrouped when confirmed', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: '1', mTime: '1000' }));
  view.append(rec({ id: 'local-1', mTime: '', receivedAt: 1_000_500, confirm: 'pending' }));
  assert.deepEqual(heads(root), ['h', 'c']);
  view.append(rec({ id: '3', mTime: '1002' }));
  view.confirm('local-1', rec({ id: '2', mTime: '1001', user: 'alice' }));
  assert.deepEqual(heads(root), ['h', 'h', 'h']);
});

test('removing or trimming a group\'s first message leaves the next one heading it', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: '1', mTime: '1000' }), rec({ id: '2', mTime: '1001' }), rec({ id: '3', mTime: '1002' })]);
  view.removeByMTime('1000');
  assert.deepEqual(heads(root), ['h', 'c']);
  assert.equal(msgs(root)[0].dataset.id, '2');

  const capped = await setup();
  capped.view.replay(Array.from({ length: DEFAULT_REPLAY_LIMIT }, (_, i) => rec({ id: `r${i}`, mTime: String(1000 + i) })));
  assert.equal(heads(capped.root)[0], 'h');
  assert.equal(heads(capped.root)[1], 'c');
  capped.view.append(rec({ id: 'x', mTime: String(1000 + DEFAULT_REPLAY_LIMIT) }));
  assert.equal(msgs(capped.root)[0].dataset.id, 'r1');
  assert.equal(heads(capped.root)[0], 'h');
});

test('posted images are tagged once loaded; smilies are not', async () => {
  const { win, view, root } = await setup();
  view.append(rec({ text: 'look [[img src=pic.jpg]] :h' }));
  const [posted, smilie] = root.querySelectorAll('.tdf-body img');
  Object.defineProperty(posted, 'naturalWidth', { value: 640 });
  Object.defineProperty(posted, 'naturalHeight', { value: 480 });
  Object.defineProperty(smilie, 'naturalWidth', { value: 20 });
  Object.defineProperty(smilie, 'naturalHeight', { value: 20 });
  for (const img of [posted, smilie]) img.dispatchEvent(new win.Event('load'));
  assert.ok(posted.classList.contains('tdf-posted'));
  assert.ok(!smilie.classList.contains('tdf-posted'));
});

test('a tall, narrow image is posted; an image outside the body (the avatar) never is', async () => {
  const { win, view, root } = await setup();
  view.append(rec({ text: '[[img src=tall.jpg]]' }));
  const tall = root.querySelector('.tdf-body img');
  const avatar = root.querySelector('.tdf-avatar');
  Object.defineProperty(tall, 'naturalWidth', { value: 20 });
  Object.defineProperty(tall, 'naturalHeight', { value: 480 });
  Object.defineProperty(avatar, 'naturalWidth', { value: 640 });
  Object.defineProperty(avatar, 'naturalHeight', { value: 640 });
  for (const img of [tall, avatar]) img.dispatchEvent(new win.Event('load'));
  assert.ok(tall.classList.contains('tdf-posted'));
  assert.ok(!avatar.classList.contains('tdf-posted'));
});

test('an image already loaded at render (cached) is tagged without a load event', async () => {
  const { win, view, root } = await setup();
  const proto = win.HTMLImageElement.prototype;
  const big = (img) => (img.getAttribute('src') ?? '').endsWith('pic.jpg');
  Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(proto, 'naturalWidth', { configurable: true, get() { return big(this) ? 640 : 20; } });
  Object.defineProperty(proto, 'naturalHeight', { configurable: true, get() { return big(this) ? 480 : 20; } });
  view.append(rec({ text: 'look [[img src=pic.jpg]] :h' }));
  const [posted, smilie] = root.querySelectorAll('.tdf-body img');
  assert.ok(posted.classList.contains('tdf-posted'));
  assert.ok(!smilie.classList.contains('tdf-posted'));
});

test('message html is sanitised before insertion', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: '[[img src=x onerror=alert(1)]][[script]]x[[/script]]' }));
  assert.equal(root.querySelector('script'), null);
  assert.equal(root.querySelector('img').getAttribute('onerror'), null);
});

test('replay renders records in order; a pending entry is confirmed or marked unconfirmed', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: 'a' }), rec({ id: 'b' })]);
  view.append(rec({ id: 'local-1-0', mTime: '', confirm: 'pending' }));
  view.append(rec({ id: 'local-2-1', mTime: '', confirm: 'pending' }));
  assert.ok(msgs(root)[2].classList.contains('tdf-pending'));
  view.confirm('local-1-0', rec({ id: '77', mTime: '300' }));
  view.markUnconfirmed('local-2-1');
  const ids = msgs(root).map((el) => el.dataset.id);
  assert.deepEqual(ids, ['a', 'b', '77', 'local-2-1']);
  assert.ok(!msgs(root)[2].classList.contains('tdf-pending'));
  assert.ok(msgs(root)[3].classList.contains('tdf-unconfirmed'));
  assert.ok(!msgs(root)[3].classList.contains('tdf-pending'));
});

test('removeByMTime removes only the first entry in list order with that mTime', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: 'local-1-0', mTime: '', confirm: 'pending' }), rec({ id: 'b', mTime: '6' }), rec({ id: 'c', mTime: '5' })]);
  // Confirmed in place: first in the list, though indexed after c.
  view.confirm('local-1-0', rec({ id: 'a', mTime: '5' }));
  view.removeByMTime('5');
  assert.deepEqual(msgs(root).map((el) => el.dataset.id), ['b', 'c']);
  view.removeByMTime('5');
  assert.deepEqual(msgs(root).map((el) => el.dataset.id), ['b']);
});

test('removeById drops the rows, unindexed, and the next row heads its group', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: 'a', mTime: '1000' }), rec({ id: 'b', mTime: '1001' }), rec({ id: 'c', mTime: '1002' })]);
  assert.deepEqual(heads(root), ['h', 'c', 'c']);
  view.removeById(['a', 'missing']);
  assert.deepEqual(msgs(root).map((el) => el.dataset.id), ['b', 'c']);
  assert.deepEqual(heads(root), ['h', 'c']);
  // Unindexed: neither lookup finds the removed row.
  view.removeByMTime('1000');
  view.markUnconfirmed('a');
  assert.deepEqual(msgs(root).map((el) => el.dataset.id), ['b', 'c']);
});

test('clear empties every row and notice, keeps the scrollbar, and leaves nothing indexed', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: 'a', mTime: '1000' }), rec({ id: 'b', mTime: '1001' })]);
  view.notice('trouble');
  const list = root.querySelector('.tdf-list');
  const others = list.children.length - msgs(root).length;
  view.clear();
  assert.equal(msgs(root).length, 0);
  assert.equal(list.children.length, others);
  view.confirm('a', rec({ id: 'z' }));
  view.removeByMTime('1001');
  assert.equal(msgs(root).length, 0);
  view.append(rec({ id: 'n', mTime: '2000' }));
  assert.deepEqual(heads(root), ['h']);
});

test('the list is capped: the oldest entries are trimmed and lookups still work', async () => {
  const { view, root } = await setup();
  const over = DEFAULT_REPLAY_LIMIT + 5;
  view.replay(Array.from({ length: DEFAULT_REPLAY_LIMIT }, (_, i) => rec({ id: `r${i}`, mTime: `${i}` })));
  for (let i = 0; i < over; i++) {
    view.append(rec({ id: `local-${i}`, mTime: '', confirm: 'pending' }));
    assert.ok(msgs(root).length <= DEFAULT_REPLAY_LIMIT);
  }
  view.notice('Chat history not saved: x');
  assert.equal(msgs(root).length, DEFAULT_REPLAY_LIMIT);
  assert.equal(root.querySelector('[data-id^="r"]'), null);
  assert.equal(root.querySelector('[data-id="local-0"]'), null);

  view.confirm('local-0', rec({ id: 'gone', mTime: '900' })); // trimmed: nothing to confirm
  view.removeByMTime('3'); // trimmed: nothing to remove
  assert.equal(root.querySelector('[data-id="gone"]'), null);
  assert.equal(msgs(root).length, DEFAULT_REPLAY_LIMIT);

  view.confirm(`local-${over - 1}`, rec({ id: '77', mTime: '300' }));
  view.markUnconfirmed(`local-${over - 2}`);
  assert.ok(root.querySelector('[data-id="77"]'));
  assert.equal(root.querySelector(`[data-id="local-${over - 1}"]`), null);
  assert.ok(root.querySelector(`[data-id="local-${over - 2}"]`).classList.contains('tdf-unconfirmed'));
  view.removeByMTime('300');
  assert.equal(root.querySelector('[data-id="77"]'), null);
});

test('engine enableUrl/enableEmail of 0 turn linking off; unset leaves it on', async () => {
  const text = 'see http://example.com or mail a@example.com';
  const off = await setup({ globals: { enableUrl: '0', enableEmail: '0' } });
  off.view.append(rec({ text }));
  assert.equal(off.root.querySelector('.tdf-body a'), null);
  const urlOnly = await setup({ globals: { enableUrl: '1', enableEmail: '0' } });
  urlOnly.view.append(rec({ text }));
  assert.deepEqual(
    [...urlOnly.root.querySelectorAll('.tdf-body a')].map((a) => a.getAttribute('href')),
    ['http://example.com'],
  );
  const on = await setup();
  on.view.append(rec({ text }));
  const hrefs = [...on.root.querySelectorAll('.tdf-body a')].map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('http://example.com'));
  assert.ok(hrefs.some((h) => h.startsWith('mailto:')));
});

test('an engine-local notice with no id renders without a data-id', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: null, mTime: '', user: '', kind: 'system' }));
  assert.equal(msgs(root)[0].dataset.id, undefined);
  assert.equal(msgs(root)[0].dataset.mtime, undefined);
});

test('notices show once per distinct text', async () => {
  const { view, root } = await setup();
  view.notice('Chat history not saved: x');
  view.notice('Chat history not saved: x');
  view.notice('Chat history not saved: y');
  assert.deepEqual(
    [...root.querySelectorAll('.tdf-notice')].map((el) => el.textContent),
    ['Chat history not saved: x', 'Chat history not saved: y'],
  );
});

test('autoscroll follows the engine checkbox', async () => {
  const off = await setup({ autoScroll: false });
  const list = off.root.querySelector('.tdf-list');
  list.scrollTop = 0;
  Object.defineProperty(list, 'scrollHeight', { value: 500 });
  off.view.append(rec({}));
  assert.equal(list.scrollTop, 0);
  const on = await setup({ autoScroll: true });
  const list2 = on.root.querySelector('.tdf-list');
  let set = null;
  Object.defineProperty(list2, 'scrollHeight', { value: 500 });
  Object.defineProperty(list2, 'scrollTop', { set: (v) => (set = v), get: () => set ?? 0 });
  on.view.append(rec({}));
  assert.equal(set, 500);
});

// A list whose height the test grows by hand, as a loading image would.
function stubScroll(list) {
  const geo = { height: 500, top: 0 };
  Object.defineProperty(list, 'scrollHeight', { get: () => geo.height });
  Object.defineProperty(list, 'clientHeight', { get: () => 200 });
  Object.defineProperty(list, 'scrollTop', { get: () => geo.top, set: (v) => (geo.top = v) });
  return geo;
}
const imgRec = (over) => rec({ text: '<img src="https://example.test/p.jpg">', ...over });
const loadImg = (win, img) => img.dispatchEvent(new win.Event('load'));

test('a pinned view follows an image that loads after its row is added', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  assert.equal(geo.top, 500);
  geo.height = 750;
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 750);
});

test('a pinned view follows any list image, avatars included, but no other load', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(rec({}));
  geo.height = 600;
  root.querySelector('.tdf-msg').dispatchEvent(new win.Event('load'));
  assert.equal(geo.top, 500);
  loadImg(win, root.querySelector('.tdf-avatar img'));
  assert.equal(geo.top, 600);
  assert.equal(root.querySelector('.tdf-avatar img').classList.contains('tdf-posted'), false);
});

test('a replay with images ends at the bottom once they load', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.replay([imgRec({ id: '1' }), imgRec({ id: '2', mTime: '101' })]);
  const imgs = root.querySelectorAll('.tdf-body img');
  geo.height = 800;
  loadImg(win, imgs[0]);
  geo.height = 1100;
  loadImg(win, imgs[1]);
  assert.equal(geo.top, 1100);
});

test('a late image load does not pull down a user scrolled up', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  geo.top = 100;
  list.dispatchEvent(new win.Event('scroll'));
  geo.height = 750;
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 100);
});

test('a user who scrolls back to the bottom is followed again', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  geo.top = 100;
  list.dispatchEvent(new win.Event('scroll'));
  geo.top = geo.height - 200;
  list.dispatchEvent(new win.Event('scroll'));
  geo.height = 750;
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 750);
});

test('a scroll event arriving after the list grew does not unpin', async () => {
  const { win, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  geo.height = 750;
  list.dispatchEvent(new win.Event('scroll'));
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 750);
});

test('rows added with Auto-scroll off leave the view unpinned when it is turned back on', async () => {
  const { win, doc, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  const auto = doc.getElementById('autoScrollID');
  auto.checked = false;
  geo.height = 800;
  view.append(rec({ id: '2', mTime: '101' }));
  auto.checked = true;
  geo.height = 900;
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 500);
});

test('with Auto-scroll off an image load never moves the view', async () => {
  const { win, doc, view, root } = await setup();
  const list = root.querySelector('.tdf-list');
  const geo = stubScroll(list);
  view.append(imgRec({}));
  doc.getElementById('autoScrollID').checked = false;
  geo.height = 750;
  loadImg(win, root.querySelector('.tdf-body img'));
  assert.equal(geo.top, 500);
});

test('clicking a sender name whispers them', async () => {
  const { view, root, whispered } = await setup();
  view.append(rec({ user: 'bob%20b' }));
  root.querySelector('.tdf-user').click();
  assert.deepEqual(whispered, ['bob%20b']);
  assert.equal(root.querySelector('.tdf-user').textContent, 'bob b');
});

test('the overlay has no theme button of its own', async () => {
  const { root } = await setup();
  assert.equal(root.querySelector('.tdf-theme-toggle'), null);
  assert.equal(root.dataset.theme, undefined);
});

const preview = (root) => root.querySelector('.tdf-preview');

test('a direct image link previews the image under the body, linking to it', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'see https://example.com/pic.JPG?x=1' }));
  const block = preview(root);
  assert.equal(block.parentElement.className, 'tdf-line');
  assert.equal(block.previousElementSibling.className, 'tdf-body');
  const a = block.querySelector('a');
  assert.equal(a.getAttribute('href'), 'https://example.com/pic.JPG?x=1');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  const img = a.querySelector('img.tdf-preview-img');
  assert.equal(img.getAttribute('src'), 'https://example.com/pic.JPG?x=1');
  assert.equal(img.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(img.getAttribute('loading'), 'lazy');
});

test('a YouTube link previews its thumbnail with a play badge, never an iframe', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'watch https://youtu.be/dQw4w9WgXcQ' }));
  const a = preview(root).querySelector('a');
  assert.equal(a.getAttribute('href'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(a.getAttribute('target'), '_blank');
  const img = a.querySelector('img.tdf-preview-img');
  assert.equal(img.getAttribute('src'), 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(img.getAttribute('referrerpolicy'), 'no-referrer');
  assert.ok(a.querySelector('.tdf-play'));
  assert.equal(root.querySelector('iframe'), null);
});

test('any other link previews as a hostname chip, and only the first link previews', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'see http://news.example.com/a and https://example.com/b.png' }));
  assert.equal(root.querySelectorAll('.tdf-preview').length, 1);
  const chip = preview(root).querySelector('a.tdf-chip');
  assert.equal(chip.textContent, 'news.example.com');
  assert.equal(chip.getAttribute('href'), 'http://news.example.com/a');
  assert.equal(preview(root).querySelector('img'), null);
});

test('a link shown as a posted image is skipped and the next link previews', async () => {
  // Linking off: the engine's linker would otherwise rewrite an absolute src into an anchor.
  const { view, root } = await setup({ globals: { enableUrl: '0' } });
  view.append(rec({ text: '<img src="https://example.com/p.jpg"> <a href="https://example.com/p.jpg">p</a> <a href="https://other.example/x">x</a>' }));
  assert.equal(preview(root).querySelector('.tdf-chip').textContent, 'other.example');
  const wrapped = await setup({ globals: { enableUrl: '0' } });
  wrapped.view.append(rec({ text: '<a href="https://example.com/full.jpg"><img src="https://example.com/t.jpg"></a>' }));
  assert.equal(preview(wrapped.root), null);
});

test('relative, mailto and sanitised-away links get no preview', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: '<a href="plugins/share/x.jpg">s</a> mail a@example.com <a href="javascript:alert(1)">j</a> https://ok.example/' }));
  assert.equal(root.querySelectorAll('.tdf-preview').length, 1);
  assert.equal(preview(root).querySelector('.tdf-chip').textContent, 'ok.example');
  view.append(rec({ id: '2', text: '<a href="//example.com/p.jpg">p</a> plain words' }));
  assert.equal(root.querySelectorAll('.tdf-preview').length, 1);
});

test('previews sit outside the body, which is unchanged by them', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'see https://example.com/pic.png' }));
  assert.ok(preview(root));
  assert.equal(preview(root).parentElement.className, 'tdf-line');
  assert.equal(root.querySelector('.tdf-body .tdf-preview'), null);
  assert.equal(root.querySelectorAll('.tdf-body img').length, 0);
});

test('an unconfirmed message with a link is labelled after its text, not after the preview', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: 'local-1', mTime: '', confirm: 'pending', text: 'see https://example.com/pic.png' }));
  view.markUnconfirmed('local-1');
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  const [, selector] = css.match(/([^{}]+)::after\s*\{\s*content:\s*" \(not confirmed\)"/);
  const labelled = root.querySelector(selector.trim());
  assert.equal(labelled, root.querySelector('.tdf-body'));
  assert.ok(labelled.textContent.includes('see'));
  assert.equal(labelled.querySelector('.tdf-preview'), null);
  assert.ok(preview(root));
});

test('a preview image that fails becomes its hostname chip, and a pinned view follows', async () => {
  const { win, view, root } = await setup();
  const geo = stubScroll(root.querySelector('.tdf-list'));
  view.append(rec({ text: 'https://img.example.com/pic.gif' }));
  view.append(rec({ id: '2', text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
  geo.height = 520;
  for (const img of root.querySelectorAll('.tdf-preview-img')) img.dispatchEvent(new win.Event('error'));
  const chips = [...root.querySelectorAll('.tdf-preview')].map((b) => [b.querySelector('.tdf-chip')?.textContent, b.querySelector('img')]);
  assert.deepEqual(chips, [['img.example.com', null], ['www.youtube.com', null]]);
  assert.equal(root.querySelectorAll('.tdf-chip')[1].getAttribute('href'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(geo.top, 520);
});

test('a pinned view stays at the bottom when a preview loads late', async () => {
  const { win, view, root } = await setup();
  const geo = stubScroll(root.querySelector('.tdf-list'));
  view.append(rec({ text: 'https://example.com/pic.webp' }));
  assert.equal(geo.top, 500);
  geo.height = 760;
  loadImg(win, root.querySelector('.tdf-preview-img'));
  assert.equal(geo.top, 760);
  assert.ok(!root.querySelector('.tdf-preview-img').classList.contains('tdf-posted'));
});

test('with Auto-scroll off a failed preview becomes a chip without moving the view', async () => {
  const { win, doc, view, root } = await setup();
  const geo = stubScroll(root.querySelector('.tdf-list'));
  view.append(rec({ text: 'https://img.example.com/pic.gif' }));
  doc.getElementById('autoScrollID').checked = false;
  geo.height = 520;
  root.querySelector('.tdf-preview-img').dispatchEvent(new win.Event('error'));
  assert.equal(preview(root).querySelector('.tdf-chip').textContent, 'img.example.com');
  assert.equal(geo.top, 500);
});
