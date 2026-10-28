import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_REPLAY_LIMIT } from '../src/core/history.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// shell.js holds one module-level slot, as the bundle does; each test takes a fresh copy.
let copies = 0;
const freshShell = () => import(`../src/core/shell.js?copy=${++copies}`);

/** A stand-in theme with the createTheme surface shell.js uses. */
function fakeTheme(initial = 'light') {
  let current = initial;
  const listeners = new Set();
  return {
    toggles: 0,
    current: () => current,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fail: false,
    async toggle() {
      this.toggles += 1;
      if (this.fail) throw new Error('quota exceeded');
      current = current === 'dark' ? 'light' : 'dark';
      for (const fn of listeners) fn(current);
    },
  };
}

/** A scroll area with fixed geometry: 100 px visible of 400. */
function scrollArea({ total = 400 } = {}) {
  const win = new Window();
  const doc = win.document;
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { value: 100 });
  Object.defineProperty(el, 'scrollHeight', { value: total });
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v) => (top = v) });
  return { win, doc, el };
}

test('before mount: the theme is unknown, and toggles and listeners wait for mount', async () => {
  const shell = await freshShell();
  assert.equal(shell.currentTheme(), null);
  const seen = [];
  shell.onThemeChange((t) => seen.push(t));
  const toggled = shell.toggleTheme();
  const theme = fakeTheme('light');
  shell.mount(theme);
  await toggled;
  assert.equal(theme.toggles, 1);
  assert.deepEqual(seen, ['light', 'dark'], 'fired from mount, then by the queued toggle');
  assert.equal(shell.currentTheme(), 'dark');
});

test('after mount: toggles run at once; off stops a listener', async () => {
  const shell = await freshShell();
  const theme = fakeTheme('dark');
  shell.mount(theme);
  const seen = [];
  const off = shell.onThemeChange((t) => seen.push(t));
  await shell.toggleTheme();
  off();
  await shell.toggleTheme();
  assert.deepEqual(seen, ['light']);
  assert.equal(theme.toggles, 2);
});

test('a second mount is ignored; unmount leaves nothing reachable', async () => {
  const shell = await freshShell();
  const first = fakeTheme('light');
  shell.mount(first);
  shell.mount(fakeTheme('dark'));
  assert.equal(shell.currentTheme(), 'light');
  shell.unmount();
  assert.equal(shell.currentTheme(), null);
  const seen = [];
  shell.onThemeChange((t) => seen.push(t));
  await first.toggle();
  assert.deepEqual(seen, []);
});

test('a copy that never mounts stays inert', async () => {
  const shell = await freshShell();
  const { el } = scrollArea();
  shell.attachScrollbar(el);
  let settled = false;
  shell.toggleTheme().then(() => (settled = true));
  await wait(20);
  assert.equal(el.classList.contains('tdf-scroll'), false);
  assert.equal(settled, false);
});

test('attachScrollbar before mount is queued; its detach cancels it', async () => {
  const shell = await freshShell();
  const a = scrollArea();
  const b = scrollArea();
  shell.attachScrollbar(a.el);
  const detachB = shell.attachScrollbar(b.el);
  detachB();
  shell.mount(fakeTheme());
  assert.equal(a.el.classList.contains('tdf-scroll'), true);
  assert.ok(a.el.querySelector('.tdf-thumb'));
  assert.equal(b.el.classList.contains('tdf-scroll'), false);
  assert.equal(b.el.querySelector('.tdf-thumb'), null);
});

test('the thumb shows on scroll and fades about a second later; detach removes it', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  const detach = shell.attachScrollbar(el);
  const thumb = el.querySelector('.tdf-thumb');
  assert.equal(thumb.classList.contains('visible'), false);
  el.scrollTop = 300;
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(thumb.classList.contains('visible'), true);
  assert.equal(thumb.style.height, '24px');
  // At the end: 300 scrolled + inset 3 + (track 94 - 24).
  assert.equal(thumb.style.transform, 'translateY(373px)');
  await wait(1000);
  assert.equal(thumb.classList.contains('visible'), false);
  detach();
  assert.equal(el.classList.contains('tdf-scroll'), false);
  assert.equal(el.querySelector('.tdf-thumb'), null);
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(thumb.classList.contains('visible'), false);
});

test('the thumb stays while hovered, fades after the pointer leaves', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = el.querySelector('.tdf-thumb');
  el.dispatchEvent(new win.Event('mouseenter'));
  await wait(1000);
  assert.equal(thumb.classList.contains('visible'), true);
  el.dispatchEvent(new win.Event('mouseleave'));
  await wait(1000);
  assert.equal(thumb.classList.contains('visible'), false);
});

test('no thumb when nothing overflows', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea({ total: 100 });
  shell.attachScrollbar(el);
  const thumb = el.querySelector('.tdf-thumb');
  el.dispatchEvent(new win.Event('mouseenter'));
  assert.equal(thumb.style.display, 'none');
  assert.equal(thumb.classList.contains('visible'), false);
});

test('dragging the thumb scrolls by the content-to-view ratio', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = el.querySelector('.tdf-thumb');
  thumb.dispatchEvent(new win.MouseEvent('mousedown', { clientY: 10, bubbles: true, cancelable: true }));
  assert.equal(thumb.classList.contains('dragging'), true);
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 30 }));
  assert.equal(el.scrollTop, 80, '20 px of drag is 80 px of a 4:1 area');
  doc.dispatchEvent(new win.MouseEvent('mouseup'));
  assert.equal(thumb.classList.contains('dragging'), false);
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 90 }));
  assert.equal(el.scrollTop, 80, 'the drag ended');
});

test('the message list gets a floating scrollbar, and trimming keeps its thumb', async () => {
  const shell = await import('../src/core/shell.js');
  const { createView } = await import('../src/core/view.js');
  shell.mount(fakeTheme());
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = '<div id="chatContainer"></div>';
  const view = createView({ doc, win, container: doc.getElementById('chatContainer'), css: '' });
  const list = doc.querySelector('#tdf-chat .tdf-list');
  assert.equal(list.classList.contains('tdf-scroll'), true);
  const rec = (i) => ({
    id: String(i), roomID: '1', mTime: String(i), user: 'bob', toUser: '', kind: 'public', avatar: '',
    color: '', size: '', family: '', text: 'hi', ircFlag: '0', lineBreakFlag: '0', receivedAt: i,
  });
  view.replay(Array.from({ length: DEFAULT_REPLAY_LIMIT + 5 }, (_, i) => rec(i)));
  assert.equal(list.querySelectorAll('.tdf-msg').length, DEFAULT_REPLAY_LIMIT);
  assert.equal(list.querySelector('.tdf-msg').dataset.id, '5');
  assert.ok(list.querySelector('.tdf-thumb'), 'the thumb was not trimmed');
});

test('a queued toggle whose save fails rejects with the cause', async () => {
  const shell = await freshShell();
  const toggled = shell.toggleTheme();
  const theme = fakeTheme();
  theme.fail = true;
  shell.mount(theme);
  await assert.rejects(toggled, /quota exceeded/);
});

test('detaching mid-drag ends the drag', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el } = scrollArea();
  const detach = shell.attachScrollbar(el);
  const thumb = el.querySelector('.tdf-thumb');
  thumb.dispatchEvent(new win.MouseEvent('mousedown', { clientY: 10, bubbles: true, cancelable: true }));
  detach();
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 30 }));
  assert.equal(el.scrollTop, 0);
  assert.equal(thumb.classList.contains('dragging'), false);
});

test('theme.css styles the class names shell.js sets', async () => {
  const { SCROLL_CLASS, THUMB_CLASS } = await freshShell();
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const name of [SCROLL_CLASS, THUMB_CLASS]) assert.match(css, new RegExp(`^\\.${name} \\{`, 'm'));
  assert.match(css, new RegExp(`^\\.${SCROLL_CLASS}::-webkit-scrollbar \\{`, 'm'));
});
