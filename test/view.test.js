import assert from 'node:assert/strict';
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

test('a head row carries avatar, name and time; a placeholder avatar has no src', async () => {
  const { view, root } = await setup();
  const t = new Date(2026, 0, 2, 9, 7).getTime() / 1000;
  view.append(rec({ id: '1', mTime: String(t), avatar: 'bob.gif' }));
  view.append(rec({ id: '2', mTime: String(t + 1), user: 'alice', avatar: '' }));
  const [bob, alice] = msgs(root);
  assert.equal(bob.querySelector('.tdf-avatar').getAttribute('src'), 'avatars/40/bob.gif');
  assert.equal(bob.querySelector('.tdf-avatar').getAttribute('loading'), 'lazy');
  assert.equal(bob.querySelector('.tdf-time').textContent, '09:07');
  assert.equal(alice.querySelector('.tdf-avatar').hasAttribute('src'), false);
  const avatar = bob.querySelector('.tdf-avatar');
  avatar.dispatchEvent(new root.ownerDocument.defaultView.Event('error'));
  assert.equal(avatar.hasAttribute('src'), false);
});

test('a sender-supplied avatar name is encoded into one path segment', async () => {
  const { view, root } = await setup();
  view.append(rec({ avatar: '../x.php?a=1#b' }));
  assert.equal(root.querySelector('.tdf-avatar').getAttribute('src'), 'avatars/40/..%2Fx.php%3Fa%3D1%23b');
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
