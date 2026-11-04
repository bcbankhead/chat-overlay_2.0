import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { installChatVideo } from './video.js';

const A = '100000000111111';
const SHARE = `plugins/share/view.php?id=${A}`;

/**
 * @param {string} kind
 * @param {string} body
 */
const row = (kind, body) =>
  `<div class="tdf-msg tdf-kind-${kind}" data-id="1"><span class="tdf-line"><span class="tdf-body">${body}</span></span></div>`;
const shareLink = `<a href="${SHARE}" target="_blank"><img src="${SHARE}"></a>`;

/**
 * @param {string} list
 * @param {{ failed?: boolean }} [opts]  `failed`: the list's images already failed before the install;
 *   otherwise they are still loading
 */
function page(list, { failed = false } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = /** @type {Document} */ (win.document);
  doc.body.innerHTML = `<div id="tdf-chat"><div class="tdf-list">${list}</div></div>`;
  // happy-dom loads no image and calls each one complete, which in a browser is a failed load.
  if (!failed) for (const img of doc.querySelectorAll('img')) Object.defineProperty(img, 'complete', { value: false });
  /** @type {unknown[]} */
  const reports = [];
  const uninstall = installChatVideo({ doc, report: (err) => reports.push(err) });
  /** @param {Element | null} el */
  const fail = (el) => {
    assert.ok(el, 'the element exists');
    el.dispatchEvent(new win.Event('error'));
  };
  return { win, doc, reports, uninstall, fail };
}

test('a share image that fails in a public message becomes a paused video with controls and an open button', () => {
  const p = page(row('public', shareLink));
  p.fail(p.doc.querySelector('.tdf-body img'));
  const wrapper = /** @type {HTMLElement} */ (p.doc.querySelector('.tdf-body .tdf-video'));
  assert.ok(wrapper);
  assert.equal(wrapper.dataset.share, A);
  assert.equal(wrapper.dataset.href, `https://chat.example.com/forum/chat/${SHARE}`);
  const video = /** @type {HTMLVideoElement} */ (wrapper.querySelector('video'));
  assert.equal(video.getAttribute('src'), SHARE);
  assert.equal(video.controls, true);
  assert.equal(video.getAttribute('preload'), 'metadata');
  assert.ok(video.hasAttribute('playsinline'));
  assert.ok(!video.hasAttribute('autoplay'), 'paused');
  const button = wrapper.querySelector('button.tdf-video-open');
  assert.equal(button?.getAttribute('type'), 'button');
  assert.equal(button?.getAttribute('aria-label'), 'Open in quick view');
  assert.equal(p.doc.querySelector('.tdf-body img'), null);
  assert.equal(wrapper.closest('a'), null, 'no anchor wraps the video');
  assert.equal(p.doc.querySelector('.tdf-body a'), null, 'the share link was replaced, not kept');
  assert.deepEqual(p.reports, []);
});

test('a whispered share swaps to a video too', () => {
  const p = page(row('whisper', shareLink));
  p.fail(p.doc.querySelector('.tdf-body img'));
  assert.ok(p.doc.querySelector('.tdf-kind-whisper .tdf-video video'));
});

test('a bare share image with no link is replaced itself', () => {
  const p = page(row('public', `<img src="${SHARE}">`));
  p.fail(p.doc.querySelector('.tdf-body img'));
  assert.ok(p.doc.querySelector('.tdf-body > .tdf-video'));
});

test('non-share, smilie, preview and other-kind images are left alone', () => {
  const p = page(
    row('public', '<a href="https://example.com/cat.png"><img src="https://example.com/cat.png"></a>') +
      row('public', "<img src='smilies/1.gif' alt=':h'>") +
      `<div class="tdf-msg tdf-kind-public"><span class="tdf-line"><span class="tdf-body">x</span><div class="tdf-preview"><a href="${SHARE}"><img class="tdf-preview-img" src="${SHARE}"></a></div></span></div>` +
      row('system', shareLink),
  );
  for (const img of p.doc.querySelectorAll('img')) p.fail(img);
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelectorAll('img').length, 4);
});

test('an image outside the chat is left alone', () => {
  const p = page('');
  p.doc.body.insertAdjacentHTML('beforeend', row('public', shareLink));
  p.fail(p.doc.querySelector('body > .tdf-msg img'));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
});

test('a video that fails too restores the broken image, and it is not tried again', () => {
  const p = page(row('public', shareLink));
  const link = p.doc.querySelector('.tdf-body a');
  const img = p.doc.querySelector('.tdf-body img');
  p.fail(img);
  p.fail(p.doc.querySelector('.tdf-video video'));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelector('.tdf-body a'), link, 'the original link is back');
  assert.equal(p.doc.querySelector('.tdf-body img'), img, 'with its image');
  p.fail(img);
  assert.equal(p.doc.querySelector('.tdf-video'), null, 'no retry');
});

test('inside a like frame the video takes the link\'s place, so the heart and stack stay', () => {
  const p = page(
    row(
      'public',
      `<span class="tdf-rx-frame" data-share="${A}">${shareLink}<button class="tdf-rx-like"></button><span class="tdf-rx-stack"></span></span>`,
    ),
  );
  p.fail(p.doc.querySelector('.tdf-body img'));
  const frame = /** @type {Element} */ (p.doc.querySelector('.tdf-rx-frame'));
  assert.deepEqual(
    [...frame.children].map((c) => c.className),
    ['tdf-video', 'tdf-rx-like', 'tdf-rx-stack'],
  );
});

test('a share image that already failed before the install is embedded at the install', () => {
  const p = page(row('public', shareLink) + row('public', "<img src='smilies/1.gif' alt=':h'>"), { failed: true });
  const wrapper = /** @type {HTMLElement} */ (p.doc.querySelector('.tdf-body .tdf-video'));
  assert.ok(wrapper);
  assert.equal(wrapper.dataset.share, A);
  assert.equal(p.doc.querySelectorAll('.tdf-video').length, 1, 'the smilie is left alone');
  assert.deepEqual(p.reports, []);
});

test('an image that loaded, or is still loading, at the install is left alone', () => {
  const p = page(row('public', `<a href="${SHARE}"><img class="tdf-posted" src="${SHARE}"></a>`), { failed: true });
  assert.equal(p.doc.querySelector('.tdf-video'), null, 'loaded');
  assert.equal(page(row('public', shareLink)).doc.querySelector('.tdf-video'), null, 'loading');
});

test('a failure while embedding is reported, and the image stays', () => {
  const p = page(row('public', shareLink));
  const boom = new Error('boom');
  p.doc.createElement = () => {
    throw boom;
  };
  const img = p.doc.querySelector('.tdf-body img');
  p.fail(img);
  assert.deepEqual(p.reports, [boom]);
  assert.equal(p.doc.querySelector('.tdf-body img'), img);
});

test('a video that fails after its row was removed restores nothing', () => {
  const p = page(row('public', shareLink));
  const link = /** @type {Element} */ (p.doc.querySelector('.tdf-body a'));
  p.fail(link.querySelector('img'));
  const wrapper = /** @type {Element} */ (p.doc.querySelector('.tdf-video'));
  const video = /** @type {Element} */ (wrapper.querySelector('video'));
  /** @type {Element} */ (p.doc.querySelector('.tdf-msg')).remove();
  assert.doesNotThrow(() => p.fail(video));
  assert.ok(wrapper.parentElement, 'the wrapper stays in the removed row');
  assert.equal(link.parentElement, null, 'the link did not come back into it');
  assert.deepEqual(p.reports, []);
});

test('uninstall stops the swap', () => {
  const p = page(row('public', shareLink));
  p.uninstall();
  p.fail(p.doc.querySelector('.tdf-body img'));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
});

test('the stylesheet bounds a video like a posted image and shows its open button on hover, focus, or always without hover', () => {
  const flat = readFileSync(new URL('./tagging.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(flat, /#tdf-chat \.tdf-video > video \{[^}]*max-width: 250px; max-height: 250px;/);
  assert.match(flat, /#tdf-chat \.tdf-video-open \{[^}]*display: none;/);
  assert.ok(flat.includes('#tdf-chat .tdf-video:hover > .tdf-video-open, #tdf-chat .tdf-video:focus-within > .tdf-video-open { display: block; }'));
  assert.match(flat, /@media \(hover: none\) \{[^@]*#tdf-chat \.tdf-video > \.tdf-video-open \{ display: block; \}/);
  assert.ok(flat.includes('#tdf-chat .tdf-rx-frame:has(> .tdf-video) > .tdf-rx-stack'), 'a framed video shows its like stack');
});
