import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { installChatVideo, uploadVideo } from './video.js';

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
  assert.equal(p.reports.length, 1);
  assert.equal(
    /** @type {Error} */ (p.reports[0]).message,
    `video: share ${A} did not play (MediaError none: no message), so its image came back`,
  );
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

/** @param {string} name */
const notice = (name, href = SHARE) =>
  `<br>File Uploaded: [${name}] - <a href="${href}" target="_blank">Click Here</a> to view the file.`;

test('a public upload notice naming an mp4 becomes a filename caption and a paused video, with no link left', () => {
  const p = page(row('public', notice('Bunny- kiss 1.mp4')));
  const body = /** @type {Element} */ (p.doc.querySelector('.tdf-body'));
  assert.equal(body.children.length, 1, 'the notice text is dropped');
  const wrapper = /** @type {HTMLElement} */ (body.querySelector(':scope > .tdf-video'));
  assert.ok(wrapper);
  assert.equal(wrapper.dataset.share, A);
  assert.equal(wrapper.dataset.href, `https://chat.example.com/forum/chat/${SHARE}`);
  assert.deepEqual([...wrapper.children].map((c) => c.tagName), ['SPAN', 'VIDEO', 'BUTTON']);
  const caption = /** @type {HTMLElement} */ (wrapper.querySelector('.tdf-video-name'));
  assert.equal(caption.textContent, 'Bunny- kiss 1.mp4');
  const video = /** @type {HTMLVideoElement} */ (wrapper.querySelector('video'));
  assert.equal(video.getAttribute('src'), SHARE);
  assert.equal(video.controls, true);
  assert.equal(video.getAttribute('preload'), 'none', 'view.php ignores Range, so nothing loads until played');
  assert.ok(!video.hasAttribute('autoplay'), 'paused');
  assert.equal(body.querySelector('a'), null);
  assert.ok(!(body.textContent ?? '').includes('Click Here'));
  assert.deepEqual(p.reports, []);
});

test('a whispered notice and each video extension embed too, in any case', () => {
  const p = page(
    row('whisper', notice('a.webm')) + row('public', notice('b.MOV')) + row('public', notice('c.m4v')),
  );
  assert.equal(p.doc.querySelectorAll('.tdf-video').length, 3);
  assert.ok(p.doc.querySelector('.tdf-kind-whisper .tdf-video video'));
});

test('a pdf or zip notice stays a link', () => {
  const p = page(row('public', notice('report.pdf')) + row('public', notice('files.zip')) + row('public', notice('mp4.txt')));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelectorAll('.tdf-body a').length, 3);
});

test('a notice in a preview, another message kind, or with no share link is left alone', () => {
  const p = page(
    `<div class="tdf-msg tdf-kind-public"><span class="tdf-line"><span class="tdf-body">x</span><div class="tdf-preview">${notice('a.mp4')}</div></span></div>` +
      row('system', notice('b.mp4')) +
      row('public', notice('c.mp4', 'https://example.com/c.mp4')),
  );
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelectorAll('a').length, 3);
});

test('a notice row added after the install is embedded once', async () => {
  const p = page('');
  const list = /** @type {Element} */ (p.doc.querySelector('.tdf-list'));
  list.insertAdjacentHTML('beforeend', row('public', notice('later.mp4')));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.doc.querySelectorAll('.tdf-video').length, 1);
  const msg = /** @type {Element} */ (p.doc.querySelector('.tdf-msg'));
  assert.ok(msg.hasAttribute('data-tdf-tried'));
  // A block of rows, as a backlog replay adds them, is seen through its container.
  list.insertAdjacentHTML('beforeend', `<div class="tdf-block">${row('public', notice('d.mp4'))}</div>`);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.doc.querySelectorAll('.tdf-video').length, 2);
  assert.deepEqual(p.reports, []);
});

test('a notice video that fails restores the original notice text and link, with no retry', async () => {
  const p = page(row('public', notice('x.mp4')));
  const body = /** @type {Element} */ (p.doc.querySelector('.tdf-body'));
  const before = notice('x.mp4');
  const video = /** @type {Element} */ (body.querySelector('video'));
  Object.defineProperty(video, 'error', { value: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' } });
  p.fail(video);
  assert.equal(body.innerHTML, before);
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.reports.length, 1);
  assert.equal(
    /** @type {Error} */ (p.reports[0]).message,
    `video: share ${A} did not play (MediaError 4: MEDIA_ELEMENT_ERROR: Format error), so its notice came back`,
  );
  // Re-added to the chat, the same row is not tried again.
  const msg = /** @type {Element} */ (p.doc.querySelector('.tdf-msg'));
  const list = /** @type {Element} */ (p.doc.querySelector('.tdf-list'));
  msg.remove();
  list.appendChild(msg);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
});

test('a notice linking to a share on another host is left alone', () => {
  const foreign = `https://evil.example/plugins/share/view.php?id=${A}`;
  const p = page(row('public', notice('a.mp4', foreign)) + row('whisper', notice('b.mp4', `//evil.example/${SHARE}`)));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelector('video'), null, 'nothing loads from the foreign host');
  assert.equal(p.doc.querySelectorAll('.tdf-body a').length, 2);
  const q = page(row('public', notice('c.mp4', `https://chat.example.com/forum/chat/${SHARE}`)));
  assert.ok(q.doc.querySelector('.tdf-video'), "an absolute link on the chat's own origin embeds");
});

test('a body with more than the notice in it is left alone, so nothing the user wrote is dropped', () => {
  const p = page(
    row('public', `look at this ${notice('a.mp4')}`) +
      row('public', `${notice('b.mp4')} and tell me what you think`) +
      row('public', `<b>hi</b>${notice('c.mp4')}`) +
      row('public', `File Uploaded: [d.mp4] - <a href="${SHARE}">Click Here</a> to view the file. <a href="${SHARE}">again</a>`),
  );
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.ok(p.doc.querySelectorAll('.tdf-body')[0].textContent?.startsWith('look at this'));
  assert.ok(p.doc.querySelectorAll('.tdf-body')[1].textContent?.endsWith('and tell me what you think'));
  const q = page(row('public', ` File Uploaded:  [e.mp4]  -  <a href="${SHARE}">Click Here</a>  to view the file `));
  assert.ok(q.doc.querySelector('.tdf-video'), 'whitespace and a missing period still match the notice');
});

test('a notice whose link holds an image, or that sits outside the chat, is left alone', () => {
  const p = page(row('public', `File Uploaded: [a.mp4] - <a href="${SHARE}"><img src="${SHARE}"></a>`));
  p.doc.body.insertAdjacentHTML('beforeend', row('public', notice('b.mp4')));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
  assert.equal(p.doc.querySelectorAll('a').length, 2);
});

test('uploadVideo answers null for an element that is not a link', () => {
  const p = page(row('public', `File Uploaded: [a.mp4] - <span data-x="${SHARE}">x</span>`));
  assert.equal(uploadVideo(/** @type {Element} */ (p.doc.querySelector('.tdf-body span'))), null);
  const q = page(row('public', notice('a.mp4')));
  assert.equal(q.doc.querySelector('a'), null, 'the same text with a link embeds');
});

test('a failure while embedding a notice is reported, and the notice stays', async () => {
  const p = page('');
  const boom = new Error('boom');
  p.doc.createElement = () => {
    throw boom;
  };
  /** @type {Element} */ (p.doc.querySelector('.tdf-list')).insertAdjacentHTML('beforeend', row('public', notice('z.mp4')));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(p.reports, [boom]);
  assert.equal(p.doc.querySelector('.tdf-body')?.innerHTML, notice('z.mp4'));
});

test('a notice video that fails after its row was removed restores nothing', () => {
  const p = page(row('public', notice('w.mp4')));
  const body = /** @type {Element} */ (p.doc.querySelector('.tdf-body'));
  const wrapper = /** @type {Element} */ (body.querySelector('.tdf-video'));
  /** @type {Element} */ (p.doc.querySelector('.tdf-msg')).remove();
  assert.doesNotThrow(() => p.fail(wrapper.querySelector('video')));
  assert.equal(body.firstElementChild, wrapper, 'the removed row keeps its video');
  assert.deepEqual(p.reports, []);
});

test('uninstall stops the notice observer', async () => {
  const p = page('');
  p.uninstall();
  /** @type {Element} */ (p.doc.querySelector('.tdf-list')).insertAdjacentHTML('beforeend', row('public', notice('y.mp4')));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.doc.querySelector('.tdf-video'), null);
});

test('the stylesheet keeps a notice caption to one muted line within 250 px and moves the open button below it', () => {
  const flat = readFileSync(new URL('./tagging.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(flat, /#tdf-chat \.tdf-video-name \{[^}]*max-width: 250px;[^}]*white-space: nowrap; text-overflow: ellipsis;/);
  assert.ok(flat.includes('#tdf-chat .tdf-video:has(> .tdf-video-name) > .tdf-video-open { top: 20px; }'));
});

test('the stylesheet bounds a video like a posted image and shows its open button on hover, focus, or always without hover', () => {
  const flat = readFileSync(new URL('./tagging.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(flat, /#tdf-chat \.tdf-video > video \{[^}]*max-width: 250px; max-height: 250px;/);
  assert.match(flat, /#tdf-chat \.tdf-video-open \{[^}]*display: none;/);
  assert.ok(flat.includes('#tdf-chat .tdf-video:hover > .tdf-video-open, #tdf-chat .tdf-video:focus-within > .tdf-video-open { display: block; }'));
  assert.match(flat, /@media \(hover: none\) \{[^@]*#tdf-chat \.tdf-video > \.tdf-video-open \{ display: block; \}/);
  assert.ok(flat.includes('#tdf-chat .tdf-rx-frame:has(> .tdf-video) > .tdf-rx-stack'), 'a framed video shows its like stack');
});
