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

/**
 * A scroll area with fixed geometry, 100 px visible of 400, inside a static parent: it sits
 * 20 px down and 10 px in, and is 200 px wide.
 */
function scrollArea({ total = 400 } = {}) {
  const win = new Window();
  const doc = win.document;
  const parent = doc.createElement('div');
  const el = doc.createElement('div');
  parent.appendChild(el);
  doc.body.appendChild(parent);
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { value: 100 });
  Object.defineProperty(el, 'scrollHeight', { value: total });
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v) => (top = v) });
  Object.defineProperty(el, 'offsetTop', { value: 20 });
  Object.defineProperty(el, 'offsetLeft', { value: 10 });
  Object.defineProperty(el, 'offsetWidth', { value: 200 });
  return { win, doc, el, parent };
}

/** The area's thumb: its next sibling, never inside the scrolled content. */
const thumbOf = (el) => {
  const next = el.nextElementSibling;
  return next?.classList.contains('tdf-thumb') ? next : null;
};

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
  assert.ok(thumbOf(a.el));
  assert.equal(b.el.classList.contains('tdf-scroll'), false);
  assert.equal(thumbOf(b.el), null);
});

test('the thumb shows on scroll and fades about a second later; detach removes it', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  const detach = shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  assert.equal(thumb.classList.contains('visible'), false);
  el.scrollTop = 300;
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(thumb.classList.contains('visible'), true);
  assert.equal(thumb.style.height, '24px');
  // At the end: the area's top 20 + inset 3 + (track 94 - 24); never offset by scrollTop.
  assert.equal(thumb.style.top, '93px');
  assert.equal(thumb.style.left, '210px', "at the area's right edge");
  assert.equal(thumb.style.transform, '');
  await wait(1000);
  assert.equal(thumb.classList.contains('visible'), false);
  detach();
  assert.equal(el.classList.contains('tdf-scroll'), false);
  assert.equal(thumb.isConnected, false);
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(thumb.classList.contains('visible'), false);
});

test('the thumb stays while hovered, fades after the pointer leaves', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = thumbOf(el);
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
  const thumb = thumbOf(el);
  el.dispatchEvent(new win.Event('mouseenter'));
  assert.equal(thumb.style.display, 'none');
  assert.equal(thumb.classList.contains('visible'), false);
});

/** The thumb's offset within the visible area, from its top less the area's. */
function thumbOffset(el, thumb) {
  return Number(/([-\d.]+)px/.exec(thumb.style.top)[1]) - el.offsetTop;
}

test('dragging the thumb scrolls so the thumb stays under the pointer', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  thumb.dispatchEvent(new win.MouseEvent('mousedown', { clientY: 10, bubbles: true, cancelable: true }));
  assert.equal(thumb.classList.contains('dragging'), true);
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 30 }));
  // 300 px of scroll range over 70 px of thumb travel (94 px track, 24 px thumb).
  assert.ok(Math.abs(el.scrollTop - (20 * 300) / 70) < 1e-9);
  doc.dispatchEvent(new win.MouseEvent('mouseup'));
  assert.equal(thumb.classList.contains('dragging'), false);
  const top = el.scrollTop;
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 90 }));
  assert.equal(el.scrollTop, top, 'the drag ended');
});

test('on a long list, where the thumb is clamped to its minimum, it tracks the pointer', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el } = scrollArea({ total: 100000 });
  shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  el.dispatchEvent(new win.Event('scroll'));
  const before = thumbOffset(el, thumb);
  thumb.dispatchEvent(new win.MouseEvent('mousedown', { clientY: 10, bubbles: true, cancelable: true }));
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 40 }));
  el.dispatchEvent(new win.Event('scroll'));
  assert.ok(Math.abs(thumbOffset(el, thumb) - before - 30) < 1e-6, 'the thumb moved as far as the pointer');
  doc.dispatchEvent(new win.MouseEvent('mouseup'));
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
  assert.ok(thumbOf(list), 'the thumb was not trimmed');
  assert.equal(list.querySelector('.tdf-thumb'), null, 'the thumb is outside the scrolled list');
});

test('a queued toggle whose save fails rejects with the cause', async () => {
  const shell = await freshShell();
  const toggled = shell.toggleTheme();
  const theme = fakeTheme();
  theme.fail = true;
  shell.mount(theme);
  await assert.rejects(toggled, /quota exceeded/);
});

test('a toggle still queued when a failed start unmounts rejects with the reason', async () => {
  const shell = await freshShell();
  const toggled = shell.toggleTheme();
  shell.unmount();
  await assert.rejects(toggled, /overlay did not start/);
  const theme = fakeTheme();
  shell.mount(theme);
  assert.equal(theme.toggles, 0, 'the dropped toggle is not replayed by a later mount');
});

test('detaching mid-drag ends the drag', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el } = scrollArea();
  const detach = shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  thumb.dispatchEvent(new win.MouseEvent('mousedown', { clientY: 10, bubbles: true, cancelable: true }));
  detach();
  doc.dispatchEvent(new win.MouseEvent('mousemove', { clientY: 30 }));
  assert.equal(el.scrollTop, 0);
  assert.equal(thumb.classList.contains('dragging'), false);
});

test("the thumb is the area's sibling; a static parent is positioned, and restored on detach", async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el, parent } = scrollArea();
  const detach = shell.attachScrollbar(el);
  assert.equal(el.querySelector('.tdf-thumb'), null, 'nothing inside the scrolled content');
  assert.ok(thumbOf(el));
  assert.equal(parent.style.position, '', 'decided on first placement, not at attach');
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(parent.style.position, 'relative');
  detach();
  assert.equal(parent.style.position, '');
  assert.equal(parent.querySelector('.tdf-thumb'), null);
});

test('an already positioned parent is left as it is', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { el, parent } = scrollArea();
  parent.style.position = 'absolute';
  const detach = shell.attachScrollbar(el);
  assert.equal(parent.style.position, 'absolute');
  detach();
  assert.equal(parent.style.position, 'absolute');
});

test('a parent attached while detached keeps the position its stylesheet gives it once inserted', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, doc, el, parent } = scrollArea();
  parent.remove();
  parent.id = 'p';
  const style = doc.createElement('style');
  style.textContent = '#p { position: absolute; }';
  doc.head.appendChild(style);
  const detach = shell.attachScrollbar(el);
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(parent.style.position, '', 'not decided while detached');
  doc.body.appendChild(parent);
  el.dispatchEvent(new win.Event('scroll'));
  assert.equal(win.getComputedStyle(parent).position, 'absolute');
  assert.equal(parent.style.position, '');
  detach();
  assert.equal(parent.style.position, '');
});

test('hovering the thumb keeps it shown; a wheel over it scrolls the area', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  el.dispatchEvent(new win.Event('mouseenter'));
  el.dispatchEvent(new win.Event('mouseleave'));
  thumb.dispatchEvent(new win.Event('mouseenter'));
  await wait(1000);
  assert.equal(thumb.classList.contains('visible'), true);
  thumb.dispatchEvent(new win.WheelEvent('wheel', { deltaY: 40, cancelable: true }));
  assert.equal(el.scrollTop, 40);
});

test('a wheel over the thumb in lines or pages scrolls by pixels', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  thumb.dispatchEvent(new win.WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true }));
  assert.equal(el.scrollTop, 48, '3 lines of 16 px');
  thumb.dispatchEvent(new win.WheelEvent('wheel', { deltaY: 1, deltaMode: 2, cancelable: true }));
  assert.equal(el.scrollTop, 148, 'one page is the visible height');
});

test('the thumb is re-placed when the area resizes without scrolling', async () => {
  const shell = await freshShell();
  shell.mount(fakeTheme());
  const { win, el } = scrollArea();
  const observers = [];
  win.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
      this.targets = new Set();
      observers.push(this);
    }
    observe(t) {
      this.targets.add(t);
    }
    unobserve(t) {
      this.targets.delete(t);
    }
    disconnect() {
      this.targets.clear();
    }
  };
  const detach = shell.attachScrollbar(el);
  const thumb = thumbOf(el);
  const [observer] = observers;
  assert.ok(observer.targets.has(el));
  el.scrollTop = 300;
  observer.fn([]);
  assert.equal(thumb.style.top, '93px');
  detach();
  assert.equal(observer.targets.size, 0, 'detach disconnects it');
});

test('theme.css styles the class names shell.js sets', async () => {
  const { SCROLL_CLASS, THUMB_CLASS } = await freshShell();
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const name of [SCROLL_CLASS, THUMB_CLASS]) assert.match(css, new RegExp(`^\\.${name} \\{`, 'm'));
  assert.match(css, new RegExp(`^\\.${SCROLL_CLASS}::-webkit-scrollbar \\{`, 'm'));
});
