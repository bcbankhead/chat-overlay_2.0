import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { FILMSTRIP_SLOTS, openLightbox } from './lightbox.js';

/** @param {string} id @param {string | null} [thumb] */
const item = (id, thumb = `thumb-${id}`) => ({
  id,
  src: `https://chat.example.com/share/${id}`,
  thumb,
  kind: /** @type {const} */ ('unknown'),
});

/**
 * @param {{ count?: number, index?: number, ids?: string[], zoomThrows?: boolean, host?: boolean }} [opts]
 */
function setup({ count = 5, index = 2, ids, zoomThrows = false, host = true } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  doc.body.innerHTML = '<div id="tdf-chat"><div class="tdf-list"></div></div><button id="opener">open</button>';
  const chat = /** @type {HTMLElement} */ (doc.getElementById('tdf-chat'));
  chat.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top: 10, left: 20, width: 600, height: 400 });
  const opener = /** @type {HTMLElement} */ (doc.getElementById('opener'));
  opener.focus();
  /** @type {string[]} */
  const zoomed = [];
  /** @type {unknown[]} */
  const errors = [];
  /** @type {Map<string, import('./roster.js').MediaKind>} */
  const kinds = new Map();
  const items = (ids ?? Array.from({ length: count }, (_, i) => String(i))).map((id) => item(id));
  const box = openLightbox({
    doc,
    win,
    host: host ? chat : null,
    items,
    index,
    zoom: (m) => {
      if (zoomThrows) throw new Error('zoom broke');
      zoomed.push(m.id);
    },
    report: (err) => errors.push(err),
    kinds,
  });
  const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (doc.querySelector(sel));
  const stage = () => $('.tdf-lb-stage');
  const media = () => /** @type {HTMLElement} */ (stage().firstElementChild);
  const thumbs = () => /** @type {HTMLElement[]} */ ([...doc.querySelectorAll('.tdf-lb-thumb')]);
  const current = () => thumbs().find((t) => t.classList.contains('tdf-current'));
  const key = (/** @type {string} */ k, target = doc.body) =>
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { win, doc, chat, opener, box, $, stage, media, thumbs, current, key, zoomed, errors, kinds };
}

test('the popover is a fixed layer kept to the chat\'s rect, outside #tdf-chat so the rail cannot cover it', () => {
  const s = setup();
  const layer = s.$('.tdf-lb');
  assert.equal(layer.parentElement, s.doc.body);
  assert.equal(layer.getAttribute('role'), 'dialog');
  assert.equal(layer.getAttribute('aria-modal'), 'true');
  assert.deepEqual(
    [layer.style.top, layer.style.left, layer.style.width, layer.style.height],
    ['10px', '20px', '600px', '400px'],
  );
  s.chat.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top: 0, left: 5, width: 300, height: 200 });
  s.win.dispatchEvent(new s.win.Event('resize'));
  assert.deepEqual([layer.style.width, layer.style.height], ['300px', '200px'], 'a resize re-measures');
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  const rule = /\.tdf-lb \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(rule, /position: fixed/);
  const z = Number(/z-index: (\d+)/.exec(rule)?.[1]);
  assert.ok(z > 11, 'above the rail (10) and its menu (11)');
});

test('with no host the layer fills the window', () => {
  const s = setup({ host: false });
  const layer = s.$('.tdf-lb');
  assert.deepEqual([layer.style.width, layer.style.height], ['100%', '100%']);
});

test('opens at the clicked item, with the counter, and focuses Close', () => {
  const s = setup();
  assert.equal(s.media().tagName, 'IMG');
  assert.equal(/** @type {HTMLImageElement} */ (s.media()).src, 'https://chat.example.com/share/2');
  assert.equal(s.$('.tdf-lb-count').textContent, '3 / 5');
  assert.equal(s.doc.activeElement, s.$('.tdf-lb-close'));
});

test('the arrows and the arrow keys step, clamped at both ends', () => {
  const s = setup({ index: 0 });
  const prev = /** @type {HTMLButtonElement} */ (s.$('.tdf-lb-prev'));
  const next = /** @type {HTMLButtonElement} */ (s.$('.tdf-lb-next'));
  assert.equal(prev.disabled, true);
  next.click();
  assert.equal(s.$('.tdf-lb-count').textContent, '2 / 5');
  s.key('ArrowRight');
  s.key('ArrowRight');
  s.key('ArrowRight');
  assert.equal(s.$('.tdf-lb-count').textContent, '5 / 5');
  assert.equal(next.disabled, true);
  s.key('ArrowRight');
  assert.equal(s.$('.tdf-lb-count').textContent, '5 / 5', 'no wrap');
  s.key('ArrowLeft');
  prev.click();
  assert.equal(s.$('.tdf-lb-count').textContent, '3 / 5');
});

test('the filmstrip outlines the current item and a thumbnail click jumps to it', () => {
  const s = setup();
  assert.equal(s.thumbs().length, 5);
  assert.equal(s.current()?.dataset.index, '2');
  assert.equal(s.current()?.getAttribute('aria-current'), 'true');
  assert.equal(/** @type {HTMLImageElement} */ (s.thumbs()[0].querySelector('img')).getAttribute('src'), 'thumb-0');
  s.thumbs()[4].click();
  assert.equal(s.$('.tdf-lb-count').textContent, '5 / 5');
  assert.equal(s.current()?.dataset.index, '4');
  assert.equal(s.thumbs().filter((t) => t.classList.contains('tdf-current')).length, 1);
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  assert.match(css, /\.tdf-lb-thumb\.tdf-current \{[^}]*border-color: #ffffff/);
});

test('a long roster renders a window of thumbnails around the current item', () => {
  const s = setup({ count: 200, index: 100 });
  assert.equal(s.thumbs().length, FILMSTRIP_SLOTS);
  assert.equal(s.current()?.dataset.index, '100');
  const first = Number(s.thumbs()[0].dataset.index);
  assert.equal(first, 100 - Math.floor((FILMSTRIP_SLOTS - 1) / 2));
});

test('a single item hides the filmstrip', () => {
  const s = setup({ count: 1, index: 0 });
  assert.equal(s.$('.tdf-lb-strip').hidden, true);
});

test('an image that fails is retried as a video, which is remembered for the share', () => {
  const s = setup();
  s.media().dispatchEvent(new s.win.Event('error'));
  const video = /** @type {HTMLVideoElement} */ (s.media());
  assert.equal(video.tagName, 'VIDEO');
  assert.equal(video.controls, true);
  assert.equal(video.src, 'https://chat.example.com/share/2');
  assert.equal(s.$('.tdf-lb-tab').hidden, false, 'a video shows the open-in-new-tab button');
  video.dispatchEvent(new s.win.Event('loadedmetadata'));
  assert.equal(s.kinds.get('2'), 'video');
  assert.ok(s.current()?.classList.contains('tdf-lb-thumb-video'), 'its thumbnail shows the play glyph');
  assert.equal(s.current()?.querySelector('img'), null);

  s.key('ArrowRight');
  assert.equal(s.media().tagName, 'IMG');
  assert.equal(s.$('.tdf-lb-tab').hidden, true);
  s.key('ArrowLeft');
  assert.equal(s.media().tagName, 'VIDEO', 'a return visit goes straight to the video');
});

test('an image that loads is remembered; one that fails as both is unavailable and still zooms', () => {
  const s = setup();
  s.media().dispatchEvent(new s.win.Event('load'));
  assert.equal(s.kinds.get('2'), 'image');
  s.key('ArrowRight');
  s.media().dispatchEvent(new s.win.Event('error'));
  s.media().dispatchEvent(new s.win.Event('error'));
  const note = s.media();
  assert.ok(note.classList.contains('tdf-lb-unavailable'));
  note.click();
  assert.deepEqual(s.zoomed, ['3']);
});

test('a late error from an item already stepped past changes nothing', () => {
  const s = setup();
  const first = s.media();
  s.key('ArrowRight');
  first.dispatchEvent(new s.win.Event('error'));
  assert.equal(s.media().tagName, 'IMG');
  assert.equal(/** @type {HTMLImageElement} */ (s.media()).src, 'https://chat.example.com/share/3');
});

test('clicking the image, or the video\'s new-tab button, zooms the item; a throwing zoom is reported', () => {
  const s = setup();
  s.media().click();
  assert.deepEqual(s.zoomed, ['2']);
  s.media().dispatchEvent(new s.win.Event('error'));
  s.$('.tdf-lb-tab').click();
  assert.deepEqual(s.zoomed, ['2', '2']);
  assert.ok(s.$('.tdf-lb'), 'zooming leaves the popover open');

  const t = setup({ zoomThrows: true });
  t.media().click();
  assert.equal(t.errors.length, 1);
});

test('Close, Escape and a backdrop click each dismiss it, return focus and remove the listeners', () => {
  for (const how of ['close', 'escape', 'backdrop']) {
    const s = setup();
    if (how === 'close') s.$('.tdf-lb-close').click();
    else if (how === 'escape') s.key('Escape');
    else s.stage().click();
    assert.equal(s.doc.querySelector('.tdf-lb'), null, how);
    assert.equal(s.doc.activeElement, s.opener, `${how} returns focus`);
    // Listeners are gone: a later key or resize does nothing and throws nothing.
    const event = new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    s.doc.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${how}: the key listener is removed`);
    s.win.dispatchEvent(new s.win.Event('resize'));
  }
});

test('a click on the media or the controls is not a backdrop click', () => {
  const s = setup();
  s.media().click();
  s.$('.tdf-lb-next').click();
  s.thumbs()[0].click();
  assert.ok(s.doc.querySelector('.tdf-lb'));
});

test('arrow keys on a focused video are left to its controls', () => {
  const s = setup();
  s.media().dispatchEvent(new s.win.Event('error'));
  s.key('ArrowRight', s.media());
  assert.equal(s.$('.tdf-lb-count').textContent, '3 / 5');
});

test('arrow keys and Escape in a text field behind the popover are left to the field', () => {
  for (const html of ['<input type="text">', '<textarea></textarea>', '<div contenteditable="true"></div>']) {
    const s = setup();
    const wrap = s.doc.createElement('div');
    wrap.innerHTML = html;
    const field = /** @type {HTMLElement} */ (wrap.firstElementChild);
    s.doc.body.appendChild(field);
    field.focus();
    for (const k of ['ArrowRight', 'ArrowLeft', 'Escape']) {
      const event = new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, `${html} ${k} is not prevented`);
    }
    assert.equal(s.$('.tdf-lb-count').textContent, '3 / 5', `${html}: no step`);
    assert.ok(s.doc.querySelector('.tdf-lb'), `${html}: Escape does not close`);
  }
});

test('a filmstrip thumbnail that fails falls back to the glyph for its kind', () => {
  const s = setup();
  const first = s.thumbs()[0];
  /** @type {HTMLImageElement} */ (first.querySelector('img')).dispatchEvent(new s.win.Event('error'));
  assert.equal(first.querySelector('img'), null);
  assert.ok(first.querySelector('.tdf-lb-glyph rect'), 'the media glyph');

  s.kinds.set('1', 'video');
  const second = s.thumbs()[1];
  /** @type {HTMLImageElement} */ (second.querySelector('img')).dispatchEvent(new s.win.Event('error'));
  assert.equal(second.querySelector('img'), null);
  assert.ok(second.querySelector('.tdf-lb-glyph path[d^="M8 5.5"]'), 'a share known as a video gets the play glyph');
});

test('a host with a zero-size rect falls back to filling the window', () => {
  const s = setup();
  const layer = s.$('.tdf-lb');
  s.chat.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top: 10, left: 20, width: 0, height: 400 });
  s.win.dispatchEvent(new s.win.Event('resize'));
  assert.deepEqual(
    [layer.style.top, layer.style.left, layer.style.width, layer.style.height],
    ['0px', '0px', '100%', '100%'],
  );
  s.chat.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top: 10, left: 20, width: 600, height: 0 });
  s.win.dispatchEvent(new s.win.Event('resize'));
  assert.deepEqual([layer.style.width, layer.style.height], ['100%', '100%']);
});

test('opening a second popover closes the first; a duplicate share shows once', () => {
  const s = setup({ ids: ['a', 'b', 'a', 'c'], index: 2 });
  assert.equal(s.thumbs().length, 3);
  assert.equal(s.$('.tdf-lb-count').textContent, '1 / 3', 'a later copy of a share opens at its first');
  openLightbox({ doc: s.doc, win: s.win, host: s.chat, items: [item('z')], index: 0, zoom: () => {}, report: () => {} });
  assert.equal(s.doc.querySelectorAll('.tdf-lb').length, 1);
});

test('an empty roster opens nothing', () => {
  const s = setup({ ids: [], index: 0 });
  assert.equal(s.doc.querySelector('.tdf-lb'), null);
});
