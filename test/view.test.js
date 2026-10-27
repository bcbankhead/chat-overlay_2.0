import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_REPLAY_LIMIT } from '../src/core/history.js';
import { createTheme } from '../src/core/theme.js';
import { createView } from '../src/core/view.js';

/** In-memory stand-in for the settings accessor. */
function fakeSettings(initial = {}, { failSet = false } = {}) {
  const values = { theme: 'auto', ...initial };
  return {
    values,
    async get(key) {
      return values[key];
    },
    async set(key, value) {
      if (failSet) throw new Error('quota exceeded');
      values[key] = value;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

async function setup({ dark = false, settings = fakeSettings(), autoScroll = true, globals = {} } = {}) {
  const win = new Window();
  Object.assign(win, globals);
  const doc = win.document;
  doc.body.innerHTML = `<div id="chatContainer"></div><input type="checkbox" id="autoScrollID" ${autoScroll ? 'checked' : ''}>`;
  const listeners = [];
  win.matchMedia = () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_, fn) => listeners.push(fn),
  });
  win.addSmilie = (t) => t.split(':h').join('<img src="smilies/heart.gif">');
  const whispered = [];
  win.whisperUser = (name) => whispered.push(name);
  const theme = createTheme({ win, settings });
  await theme.load();
  const container = doc.getElementById('chatContainer');
  const view = createView({ doc, win, container, theme, css: '#tdf-chat{}' });
  const root = doc.getElementById('tdf-chat');
  return { win, doc, view, root, container, settings, whispered, flipScheme: (d) => { dark = d; listeners.forEach((fn) => fn()); } };
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

test('an entry keeps sender colour and family, not size, and expands smilies', async () => {
  const { view, root } = await setup();
  view.append(rec({ text: 'love :h' }));
  const [el] = msgs(root);
  const line = el.querySelector('.tdf-line');
  assert.equal(line.style.color, '#cc0000');
  assert.equal(line.style.fontFamily, 'georgia');
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

test('low-contrast sender colours get a theme-independent ink class', async () => {
  const { view, root } = await setup();
  view.append(rec({ id: 'k', color: '#000000' }));
  view.append(rec({ id: 'y', color: 'rgb(255, 255, 0)' }));
  view.append(rec({ id: 'm', color: '#e06666' }));
  view.append(rec({ id: 'n', color: 'teal' }));
  const [black, yellow, mid, named] = msgs(root);
  assert.ok(black.classList.contains('tdf-ink-dark'));
  assert.ok(yellow.classList.contains('tdf-ink-light'));
  for (const el of [mid, named]) {
    assert.ok(!el.classList.contains('tdf-ink-dark') && !el.classList.contains('tdf-ink-light'));
  }
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

test('removeByMTime removes every entry with that mTime', async () => {
  const { view, root } = await setup();
  view.replay([rec({ id: 'a', mTime: '5' }), rec({ id: 'b', mTime: '6' }), rec({ id: 'c', mTime: '5' })]);
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

test('theme: auto follows the colour scheme; the toggle cycles and persists', async () => {
  const { root, settings, flipScheme } = await setup({ dark: true });
  const toggle = root.querySelector('.tdf-theme-toggle');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(toggle.textContent, 'Auto');
  flipScheme(false);
  assert.equal(root.dataset.theme, 'light');
  toggle.click();
  await settle();
  assert.equal(toggle.textContent, 'Light');
  assert.equal(settings.values.theme, 'light');
  flipScheme(true); // a fixed mode ignores the scheme
  assert.equal(root.dataset.theme, 'light');
  toggle.click();
  await settle();
  assert.equal(root.dataset.theme, 'dark');
  toggle.click();
  await settle();
  assert.equal(toggle.textContent, 'Auto');
  assert.equal(settings.values.theme, 'auto');
});

test('theme: a stored dark mode loads; an unknown stored value falls back to auto', async () => {
  const dark = await setup({ settings: fakeSettings({ theme: 'dark' }) });
  assert.equal(dark.root.dataset.theme, 'dark');
  const bad = await setup({ settings: fakeSettings({ theme: 'neon' }) });
  assert.equal(bad.root.querySelector('.tdf-theme-toggle').textContent, 'Auto');
});

test('theme: a failed save is shown as a notice', async () => {
  const { root } = await setup({ settings: fakeSettings({}, { failSet: true }) });
  root.querySelector('.tdf-theme-toggle').click();
  await settle();
  assert.equal(root.querySelector('.tdf-notice').textContent, 'Theme not saved: quota exceeded');
});
