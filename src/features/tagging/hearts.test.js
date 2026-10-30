import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { burst } from './hearts.js';

/** @param {{ reduce?: boolean }} [opts] */
function page({ reduce = false } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  win.matchMedia = (/** @type {string} */ query) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' });
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  win.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms) => timers.push({ fn, ms });
  win.clearTimeout = () => {};
  doc.body.innerHTML = '<button class="anchor"></button>';
  const anchor = doc.querySelector('.anchor');
  anchor.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 20, right: 140, bottom: 220, x: 100, y: 200 });
  const floating = () => doc.querySelectorAll('.tdf-hearts-float').length;
  return { win, doc, anchor, timers, floating };
}

test("a burst adds several fixed hearts at the middle of the anchor's bottom edge, each with its own drift and delay", () => {
  const p = page();
  let r = 0;
  const hearts = burst(p.doc, p.win, p.anchor, () => ((r += 0.37) % 1));
  assert.ok(hearts.length >= 3, String(hearts.length));
  assert.equal(p.floating(), hearts.length);
  for (const h of hearts) {
    assert.equal(h.parentElement, p.doc.body);
    assert.equal(h.style.left, '120px');
    assert.equal(h.style.top, '220px', 'the bottom edge');
    assert.equal(h.getAttribute('aria-hidden'), 'true');
  }
  assert.ok(new Set(hearts.map((h) => h.style.getPropertyValue('--tdf-drift'))).size > 1, 'drift varies');
});

test('each heart is removed when its animation ends, or by the backstop', () => {
  const p = page();
  const hearts = burst(p.doc, p.win, p.anchor);
  hearts[0].dispatchEvent(new p.win.Event('animationend'));
  assert.equal(p.floating(), hearts.length - 1);
  for (const t of p.timers) t.fn();
  assert.equal(p.floating(), 0, 'no stray nodes');
});

/** @param {number} left @param {number} top @param {number} width @param {number} height */
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

test('an anchor with no size (a hidden view) gets no hearts', () => {
  const p = page();
  p.anchor.getBoundingClientRect = () => box(0, 0, 0, 0);
  assert.deepEqual(burst(p.doc, p.win, p.anchor), []);
  assert.equal(p.floating(), 0);
  assert.equal(p.timers.length, 0);
});

test('an anchor outside the window gets no hearts', () => {
  const p = page();
  p.win.innerWidth = 800;
  p.win.innerHeight = 600;
  for (const rect of [box(100, 700, 40, 20), box(100, -50, 40, 20), box(900, 200, 40, 20), box(-60, 200, 40, 20)]) {
    p.anchor.getBoundingClientRect = () => rect;
    assert.deepEqual(burst(p.doc, p.win, p.anchor), [], JSON.stringify(rect));
  }
  assert.equal(p.floating(), 0);
});

test('an anchor scrolled out of its chat list gets no hearts; one inside it does', () => {
  const p = page();
  p.doc.body.innerHTML = '<div class="tdf-list"><button class="anchor"></button></div>';
  const list = p.doc.querySelector('.tdf-list');
  const anchor = p.doc.querySelector('.anchor');
  list.getBoundingClientRect = () => box(0, 300, 400, 200);
  anchor.getBoundingClientRect = () => box(100, 200, 40, 20);
  assert.deepEqual(burst(p.doc, p.win, anchor), []);
  assert.equal(p.floating(), 0);
  anchor.getBoundingClientRect = () => box(100, 350, 40, 20);
  assert.ok(burst(p.doc, p.win, anchor).length > 0);
});

test('with reduced motion asked for, nothing plays and no node is added', () => {
  const p = page({ reduce: true });
  assert.deepEqual(burst(p.doc, p.win, p.anchor), []);
  assert.equal(p.floating(), 0);
  assert.equal(p.timers.length, 0);
});
