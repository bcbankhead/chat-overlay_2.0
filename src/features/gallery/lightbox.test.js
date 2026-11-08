import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { FILMSTRIP_SLOTS, MESSAGE_BOX_ID, WHEEL_QUIET_MS, openLightbox } from './lightbox.js';
import { LOUPE_SIZE } from './loupe.js';

/** @param {string} id @param {string | null} [thumb] */
const item = (id, thumb = `thumb-${id}`) => ({
  id,
  src: `https://chat.example.com/share/${id}`,
  thumb,
  kind: /** @type {const} */ ('unknown'),
});

/**
 * @param {{ count?: number, index?: number, ids?: string[], zoomThrows?: boolean, host?: boolean, coarse?: boolean, known?: [string, import('./roster.js').MediaKind][] }} [opts]
 */
function setup({ count = 5, index = 2, ids, zoomThrows = false, host = true, coarse = false, known = [] } = {}) {
  const clock = { t: 1000 };
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  if (coarse) win.matchMedia = (/** @type {string} */ q) => ({ media: q, matches: false });
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
  const kinds = new Map(known);
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
    now: () => clock.t,
  });
  const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (doc.querySelector(sel));
  const stage = () => $('.tdf-lb-stage');
  const media = () => /** @type {HTMLElement} */ (stage().firstElementChild);
  const thumbs = () => /** @type {HTMLElement[]} */ ([...doc.querySelectorAll('.tdf-lb-thumb')]);
  const current = () => thumbs().find((t) => t.classList.contains('tdf-current'));
  const key = (/** @type {string} */ k, target = doc.body) =>
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  /** Dispatch a wheel event on `target` (the stage by default) and return it. */
  const wheel = (/** @type {Record<string, number | boolean>} */ init, target = stage()) => {
    const event = new win.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    // happy-dom's WheelEvent drops the modifier keys from its init.
    for (const k of ['ctrlKey', 'metaKey']) if (k in init) Object.defineProperty(event, k, { value: init[k] });
    target.dispatchEvent(event);
    return event;
  };
  return { win, doc, chat, opener, box, $, stage, media, thumbs, current, key, wheel, clock, zoomed, errors, kinds };
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
  assert.equal(s.$('.tdf-lb-tab').hidden, false, 'an image shows it too');
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

test('the new-tab button zooms an image or a video; a throwing zoom is reported', () => {
  const s = setup();
  s.$('.tdf-lb-tab').click();
  assert.deepEqual(s.zoomed, ['2']);
  s.media().dispatchEvent(new s.win.Event('error'));
  s.$('.tdf-lb-tab').click();
  assert.deepEqual(s.zoomed, ['2', '2']);
  assert.ok(s.$('.tdf-lb'), 'zooming leaves the popover open');

  const t = setup({ zoomThrows: true });
  t.$('.tdf-lb-tab').click();
  assert.equal(t.errors.length, 1);
});

test('the bar holds the counter, then new tab and close, in that order, with no magnify button', () => {
  const s = setup();
  const classes = [...s.$('.tdf-lb-bar').children].map((c) => c.className);
  assert.deepEqual(classes, ['tdf-lb-count', 'tdf-lb-tab', 'tdf-lb-close']);
  assert.equal(s.doc.querySelector('.tdf-lb-magnify'), null);
  const tab = s.$('.tdf-lb-tab');
  assert.equal(tab.getAttribute('aria-label'), 'Open in new tab');
  assert.match(tab.innerHTML, /M14 4h6v6/, 'the external-link glyph');
});

test('the close button is crimson with a lighter hover; no magnify rule or 16px margin is left in the CSS', () => {
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  /** @param {string} selector */
  const body = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  assert.match(body('.tdf-lb .tdf-lb-close'), /background: #DC143C;/);
  assert.match(body('.tdf-lb .tdf-lb-close'), /color: #ffffff;/);
  assert.match(body('.tdf-lb .tdf-lb-close:hover:not(:disabled)'), /background: #E8405F;/);
  const shared = css.indexOf('.tdf-lb :is(.tdf-lb-close, .tdf-lb-tab, .tdf-lb-prev, .tdf-lb-next):hover');
  assert.ok(shared >= 0 && shared < css.indexOf('\n.tdf-lb .tdf-lb-close {'), 'the crimson rules follow the shared ones');
  assert.equal(/tdf-lb-magnify(?!ing)/.test(css), false, 'no magnify button CSS');
  assert.equal(/margin-right: 16px/.test(css), false, 'no 16px margin');
  assert.equal(body('.tdf-lb .tdf-lb-tab'), '', 'no margin moved onto the new-tab button');
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

test('Escape in the message box closes the popover; the arrows are left to the box', () => {
  const s = setup();
  const box = s.doc.createElement('textarea');
  box.id = MESSAGE_BOX_ID;
  s.doc.body.appendChild(box);
  box.focus();
  for (const k of ['ArrowRight', 'ArrowLeft']) {
    const event = new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${k} is not prevented`);
  }
  assert.equal(s.$('.tdf-lb-count').textContent, '3 / 5', 'no step');
  const escape = new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  box.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true, 'Escape is prevented');
  assert.equal(s.doc.querySelector('.tdf-lb'), null, 'Escape closes');
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

/**
 * Give the stage's image a natural size and a displayed rect, and the layer a rect, so a move
 * over it can be placed: a 1000x800 image shown at 500x400 from (100, 50), in a layer at (20, 10).
 * @param {ReturnType<typeof setup>} s
 */
function measure(s) {
  const img = s.media();
  Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
  img.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 100, top: 50, width: 500, height: 400 });
  s.$('.tdf-lb').getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 20, top: 10, width: 600, height: 400 });
  return img;
}

/** @param {ReturnType<typeof setup>} s @param {number} x @param {number} y */
const move = (s, x, y) =>
  s.media().dispatchEvent(new s.win.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));

/** @param {ReturnType<typeof setup>} s @param {Record<string, unknown>} [init] @param {EventTarget} [target] */
const pressM = (s, init = {}, target = s.doc.body) => {
  const event = new s.win.KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** @param {ReturnType<typeof setup>} s */
const magnifying = (s) => s.$('.tdf-lb').classList.contains('tdf-lb-magnifying');

test('the magnifier starts off on an image open and on a video open', () => {
  const s = setup();
  assert.equal(s.media().tagName, 'IMG');
  assert.equal(magnifying(s), false);
  const v = setup({ known: [['2', 'video']] });
  assert.equal(v.media().tagName, 'VIDEO');
  assert.equal(magnifying(v), false);
  v.key('ArrowRight');
  assert.equal(v.media().tagName, 'IMG');
  assert.equal(magnifying(v), false, 'still off on the next image');
});

test('on a fine pointer a click on the image toggles the magnifier, which is not a backdrop click and zooms nothing', () => {
  const s = setup();
  assert.ok(s.$('.tdf-lb').classList.contains('tdf-lb-fine'));
  s.media().click();
  assert.equal(magnifying(s), true);
  assert.ok(s.doc.querySelector('.tdf-lb'), 'the popover stays open');
  s.media().click();
  assert.equal(magnifying(s), false);
  assert.deepEqual(s.zoomed, []);
});

test('on a touch-only device a tap on the image opens it in a new tab and does not magnify', () => {
  const s = setup({ coarse: true });
  assert.equal(s.$('.tdf-lb').classList.contains('tdf-lb-fine'), false);
  s.media().click();
  assert.deepEqual(s.zoomed, ['2']);
  assert.equal(magnifying(s), false);
  assert.ok(s.doc.querySelector('.tdf-lb'), 'the popover stays open');
  const t = setup({ coarse: true, zoomThrows: true });
  t.media().click();
  assert.equal(t.errors.length, 1, 'a throwing zoom is reported');
});

test('a click on an image already stepped past does nothing', () => {
  const s = setup();
  const first = s.media();
  s.key('ArrowRight');
  first.click();
  assert.equal(magnifying(s), false);
  const c = setup({ coarse: true });
  const old = c.media();
  c.key('ArrowRight');
  old.click();
  assert.deepEqual(c.zoomed, []);
});

test('the image cursor is zoom-in, and zoom-out while magnifying, on a fine pointer only; the crosshair is gone', () => {
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  assert.match(css, /\n\.tdf-lb-fine \.tdf-lb-image \{\s*cursor: zoom-in;/);
  assert.match(css, /\n\.tdf-lb-fine\.tdf-lb-magnifying \.tdf-lb-image \{\s*cursor: zoom-out;/);
  assert.equal(css.includes('crosshair'), false);
  assert.equal(/\n\.tdf-lb-magnifying \.tdf-lb-image/.test(css), false, 'no cursor rule without tdf-lb-fine');
});

test('M does nothing, with or without a fine pointer', () => {
  for (const coarse of [false, true]) {
    const s = setup({ coarse });
    for (const k of ['m', 'M']) {
      assert.equal(pressM(s, { key: k }).defaultPrevented, false, `${k} is left alone`);
      assert.equal(magnifying(s), false);
    }
  }
});

test('while on, a move over the image places the loupe at natural size, centred on the cursor and capped to the layer', () => {
  const s = setup();
  const img = measure(s);
  const loupe = s.$('.tdf-lb-loupe');
  assert.equal(loupe.parentElement, s.$('.tdf-lb'));
  assert.equal(loupe.getAttribute('aria-hidden'), 'true');
  img.click();
  assert.equal(loupe.hidden, true);
  move(s, 350, 250);
  assert.equal(loupe.hidden, false);
  assert.deepEqual(
    [loupe.style.left, loupe.style.top, loupe.style.backgroundPosition, loupe.style.backgroundSize],
    ['130px', '40px', '-300px -200px', '1000px 800px'],
  );
  assert.deepEqual([loupe.style.width, loupe.style.height], ['400px', '400px'], 'the 600x400 layer caps the 500px loupe to 400px');
  assert.match(loupe.style.backgroundImage, /share\/2/);
  img.dispatchEvent(new s.win.Event('mouseleave'));
  assert.equal(loupe.hidden, true, 'leaving the image hides it');
  move(s, 99, 250);
  assert.equal(loupe.hidden, true, 'a move outside the image rect draws nothing');
  move(s, 350, 250);
  img.click();
  assert.equal(loupe.hidden, true, 'turning it off hides the loupe');
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  const rule = /\.tdf-lb-loupe \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.equal(/(?:^|[\s;{])width: ([^;]+);/.exec(rule)?.[1], `${LOUPE_SIZE}px`, 'the CSS width is LOUPE_SIZE');
  assert.equal(/(?:^|[\s;{])height: ([^;]+);/.exec(rule)?.[1], `${LOUPE_SIZE}px`, 'the CSS height is LOUPE_SIZE');
  assert.match(rule, /pointer-events: none/);
  assert.match(rule, /background-repeat: no-repeat/);
});

test('turning it on with the cursor resting on the image shows the loupe without another move', () => {
  const s = setup();
  const img = measure(s);
  move(s, 350, 250);
  assert.equal(s.$('.tdf-lb-loupe').hidden, true, 'off: a move draws nothing');
  img.click();
  const loupe = s.$('.tdf-lb-loupe');
  assert.equal(loupe.hidden, false);
  assert.deepEqual([loupe.style.left, loupe.style.top], ['130px', '40px']);
  img.click();
  img.dispatchEvent(new s.win.Event('mouseleave'));
  img.click();
  assert.equal(loupe.hidden, true, 'a cursor that left the image is forgotten');
});

test('an image that loads under a still cursor shows the loupe without another move', () => {
  const s = setup();
  const img = measure(s);
  img.click();
  Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });
  move(s, 350, 250);
  const loupe = s.$('.tdf-lb-loupe');
  assert.equal(loupe.hidden, true, 'no natural size yet, nothing to draw');
  Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
  img.dispatchEvent(new s.win.Event('load'));
  assert.equal(loupe.hidden, false);
  assert.deepEqual(
    [loupe.style.left, loupe.style.top, loupe.style.backgroundPosition, loupe.style.backgroundSize],
    ['130px', '40px', '-300px -200px', '1000px 800px'],
  );
});

test('the magnifier stays on across steps, the filmstrip and a wheel step; a step hides the loupe; a reopen starts off', () => {
  const s = setup();
  measure(s);
  s.media().click();
  move(s, 350, 250);
  s.key('ArrowRight');
  assert.equal(s.$('.tdf-lb-loupe').hidden, true, 'the loupe waits for the next move');
  assert.equal(magnifying(s), true);
  assert.match(s.$('.tdf-lb-loupe').style.backgroundImage, /share\/3/, 'the loupe follows the item');
  s.$('.tdf-lb-prev').click();
  s.thumbs()[0].click();
  assert.equal(magnifying(s), true);
  s.wheel({ deltaY: -100 });
  assert.equal(s.$('.tdf-lb-count').textContent, '2 / 5');
  assert.equal(magnifying(s), true, 'carried across a wheel step');
  measure(s);
  move(s, 350, 250);
  assert.equal(s.$('.tdf-lb-loupe').hidden, false);
  s.win.dispatchEvent(new s.win.Event('resize'));
  assert.equal(s.$('.tdf-lb-loupe').hidden, true, 'a resize hides it');

  s.key('Escape');
  openLightbox({ doc: s.doc, win: s.win, host: s.chat, items: [item('z')], index: 0, zoom: () => {}, report: () => {} });
  assert.equal(magnifying(s), false, 'a reopen on an image starts off');
});

test('a later item falling back to a video keeps a magnifier carried over the step', () => {
  const s = setup();
  s.media().click();
  s.key('ArrowRight');
  s.media().dispatchEvent(new s.win.Event('error'));
  assert.equal(s.media().tagName, 'VIDEO');
  assert.equal(magnifying(s), true);
  s.key('ArrowRight');
  assert.equal(magnifying(s), true, 'and on the image after it');
});

test('a video or unavailable item hides the loupe', () => {
  const s = setup();
  measure(s);
  s.media().click();
  move(s, 350, 250);
  assert.equal(s.$('.tdf-lb-loupe').hidden, false);
  s.media().dispatchEvent(new s.win.Event('error'));
  assert.equal(s.media().tagName, 'VIDEO');
  assert.equal(s.$('.tdf-lb-loupe').hidden, true);

  const u = setup();
  u.kinds.set('2', 'image');
  u.media().dispatchEvent(new u.win.Event('error'));
  assert.ok(u.media().classList.contains('tdf-lb-unavailable'));
  assert.equal(u.$('.tdf-lb-loupe').hidden, true);
});

test('wheel up steps to the next item and wheel down to the previous, clamped at both ends', () => {
  const s = setup({ count: 3, index: 1 });
  const count = () => s.$('.tdf-lb-count').textContent;
  assert.equal(s.wheel({ deltaY: -120 }).defaultPrevented, true);
  assert.equal(count(), '3 / 3');
  s.clock.t += WHEEL_QUIET_MS;
  s.wheel({ deltaY: -120 });
  assert.equal(count(), '3 / 3', 'clamped at the last');
  s.clock.t += WHEEL_QUIET_MS;
  s.wheel({ deltaY: 120 });
  assert.equal(count(), '2 / 3');
  s.clock.t += WHEEL_QUIET_MS;
  s.wheel({ deltaY: 120 });
  assert.equal(count(), '1 / 3');
  s.clock.t += WHEEL_QUIET_MS;
  assert.equal(s.wheel({ deltaY: 120 }).defaultPrevented, true, 'a clamped step is still consumed');
  assert.equal(count(), '1 / 3', 'clamped at the first');
});

test('the wheel steps from anywhere on the popover: the image, the video, the bar and the backdrop', () => {
  const s = setup({ count: 9, index: 2 });
  const count = () => s.$('.tdf-lb-count').textContent;
  for (const [target, expected] of /** @type {[() => Element, string][]} */ ([
    [() => s.media(), '4 / 9'],
    [() => s.$('.tdf-lb-bar'), '5 / 9'],
    [() => s.$('.tdf-lb'), '6 / 9'],
  ])) {
    s.clock.t += WHEEL_QUIET_MS;
    assert.equal(s.wheel({ deltaY: -50 }, target()).defaultPrevented, true);
    assert.equal(count(), expected);
  }
  s.media().dispatchEvent(new s.win.Event('error'));
  assert.equal(s.media().tagName, 'VIDEO');
  s.clock.t += WHEEL_QUIET_MS;
  s.wheel({ deltaY: 50 }, s.media());
  assert.equal(count(), '5 / 9', 'a video steps too');
});

test('one gesture steps once: events within the quiet period are ignored and each one extends it', () => {
  const s = setup({ count: 9, index: 4 });
  const count = () => s.$('.tdf-lb-count').textContent;
  s.wheel({ deltaY: -3 });
  assert.equal(count(), '6 / 9');
  s.clock.t += WHEEL_QUIET_MS - 1;
  assert.equal(s.wheel({ deltaY: -3 }).defaultPrevented, true, 'ignored events are still consumed');
  assert.equal(count(), '6 / 9', 'within 250ms: ignored');
  // A stream with gaps under 250ms, running well past 250ms in total, is one gesture.
  for (let i = 0; i < 10; i++) {
    s.clock.t += 100;
    s.wheel({ deltaY: -3 });
  }
  assert.equal(count(), '6 / 9', 'a long trackpad swipe still moves one item');
  s.clock.t += WHEEL_QUIET_MS;
  s.wheel({ deltaY: -3 });
  assert.equal(count(), '7 / 9', 'the next event after 250ms of quiet steps');
});

test('a wheel event with no vertical delta neither steps nor extends the gesture', () => {
  const s = setup();
  const count = () => s.$('.tdf-lb-count').textContent;
  s.wheel({ deltaY: -10 });
  assert.equal(count(), '4 / 5');
  s.clock.t += WHEEL_QUIET_MS - 10;
  assert.equal(s.wheel({ deltaX: 30, deltaY: 0 }).defaultPrevented, true, 'still consumed off the strip');
  assert.equal(count(), '4 / 5');
  s.clock.t += 10;
  s.wheel({ deltaY: -10 });
  assert.equal(count(), '5 / 5', 'the zero-delta event did not reset the quiet period');
});

test('Ctrl+wheel, Cmd+wheel and trackpad pinch are left to the browser: no step, not consumed, no gesture', () => {
  const s = setup();
  const count = () => s.$('.tdf-lb-count').textContent;
  assert.equal(s.wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented, false, 'ctrl is left native');
  assert.equal(s.wheel({ deltaY: -100, metaKey: true }).defaultPrevented, false, 'meta is left native');
  assert.equal(s.wheel({ deltaY: -100, ctrlKey: true }, s.thumbs()[0]).defaultPrevented, false, 'also over the strip');
  assert.equal(count(), '3 / 5');
  s.wheel({ deltaY: -100 });
  assert.equal(count(), '4 / 5', 'the zoom gesture did not start a quiet period');
});

test('off the filmstrip, a mostly sideways swipe is consumed without stepping on its vertical jitter', () => {
  const s = setup();
  const count = () => s.$('.tdf-lb-count').textContent;
  s.wheel({ deltaY: -10 });
  assert.equal(count(), '4 / 5');
  s.clock.t += WHEEL_QUIET_MS - 10;
  assert.equal(s.wheel({ deltaX: 40, deltaY: 2 }).defaultPrevented, true, 'consumed');
  assert.equal(s.wheel({ deltaX: -40, deltaY: -2 }).defaultPrevented, true);
  assert.equal(count(), '4 / 5', 'no step');
  s.clock.t += 10;
  s.wheel({ deltaY: -10 });
  assert.equal(count(), '5 / 5', 'the sideways events did not extend the gesture');
});

test('over the filmstrip, sideways input scrolls it natively and vertical input neither steps nor scrolls', () => {
  const s = setup();
  const count = () => s.$('.tdf-lb-count').textContent;
  const thumb = s.thumbs()[0];
  assert.equal(s.wheel({ deltaX: 40, deltaY: 5 }, thumb).defaultPrevented, false, 'sideways is left native');
  assert.equal(s.wheel({ deltaX: 40 }, s.$('.tdf-lb-strip')).defaultPrevented, false);
  assert.equal(count(), '3 / 5');
  assert.equal(s.wheel({ deltaX: 2, deltaY: -40 }, thumb).defaultPrevented, true, 'vertical is cancelled');
  assert.equal(count(), '3 / 5', 'and does not step');
  s.wheel({ deltaY: -40 });
  assert.equal(count(), '4 / 5', 'the strip did not start a gesture');
  const css = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8');
  assert.match(/\n\.tdf-lb-strip \{[^}]*\}/.exec(css)?.[0] ?? '', /overscroll-behavior: contain;/);
});

test('after a wheel step the filmstrip outlines the shown item and re-centres on it', () => {
  const s = setup({ count: 60, index: 30 });
  /** @type {unknown[]} */
  const centred = [];
  const proto = Object.getPrototypeOf(s.thumbs()[0]);
  const original = proto.scrollIntoView;
  proto.scrollIntoView = function (/** @type {unknown} */ opts) {
    centred.push([this.dataset.index, opts]);
  };
  try {
    s.wheel({ deltaY: -1 });
    assert.equal(s.current()?.dataset.index, '31');
    assert.deepEqual(centred.at(-1), ['31', { block: 'nearest', inline: 'center' }]);
  } finally {
    proto.scrollIntoView = original;
  }
});

test('the wheel listener is removed on close', () => {
  const s = setup();
  const layer = s.$('.tdf-lb');
  assert.equal(s.wheel({ deltaY: -100 }, layer).defaultPrevented, true, 'listening while open');
  s.key('Escape');
  s.clock.t += WHEEL_QUIET_MS;
  const event = new s.win.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  layer.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'gone after close');
});

test('without a given clock the wheel is timed by the window\'s own performance clock', () => {
  const s = setup();
  s.key('Escape');
  let t = 5000;
  s.win.performance.now = () => t;
  openLightbox({ doc: s.doc, win: s.win, host: s.chat, items: [item('a'), item('b'), item('c')], index: 0, zoom: () => {}, report: () => {} });
  const count = () => s.$('.tdf-lb-count').textContent;
  const wheel = () => s.$('.tdf-lb-stage').dispatchEvent(new s.win.WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }));
  wheel();
  assert.equal(count(), '2 / 3');
  t += WHEEL_QUIET_MS - 1;
  wheel();
  assert.equal(count(), '2 / 3', 'within the quiet period by that clock');
  t += WHEEL_QUIET_MS;
  wheel();
  assert.equal(count(), '3 / 3');
});
