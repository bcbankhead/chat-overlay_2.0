import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickPreview, previewOf, youtubeThumb } from '../src/core/preview.js';

const none = new Set();

test('a direct image link previews as itself, any case, query string ignored', () => {
  for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'JPG', 'WebP']) {
    const url = `https://example.com/a/pic.${ext}`;
    assert.deepEqual(previewOf(url), { kind: 'image', url, host: 'example.com' });
  }
  const queried = 'http://example.com/pic.png?w=200#x';
  assert.deepEqual(previewOf(queried), { kind: 'image', url: queried, host: 'example.com' });
  assert.equal(previewOf('https://example.com/pic.png.html').kind, 'link');
  assert.equal(previewOf('https://example.com/page?f=pic.jpg').kind, 'link');
});

test('the three YouTube forms preview as a thumbnail built from the id alone', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}&t=10`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
  ]) {
    assert.deepEqual(previewOf(url), { kind: 'youtube', id, url, host: new URL(url).hostname });
  }
  assert.equal(youtubeThumb(id), `https://img.youtube.com/vi/${id}/hqdefault.jpg`);
});

test('a YouTube link with a malformed id is only a chip', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://www.youtube.com/shorts/dQw4w9WgXc%22',
    'https://www.youtube.com/watch',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
  ]) {
    assert.equal(previewOf(url).kind, 'link', url);
  }
});

test('any other http(s) link is a chip with its hostname', () => {
  assert.deepEqual(previewOf('https://Sub.Example.com:8080/x?y'), {
    kind: 'link',
    url: 'https://Sub.Example.com:8080/x?y',
    host: 'sub.example.com',
  });
});

test('relative, protocol-relative, mailto and unparseable links get no preview', () => {
  for (const href of [
    'plugins/share/pic.jpg',
    '/forum/x.png',
    '//example.com/pic.jpg',
    'mailto:a@example.com',
    'javascript:alert(1)',
    'https://',
    'http://[bad',
    '',
  ]) {
    assert.equal(previewOf(href), null, href);
  }
});

test('pickPreview takes the first previewable link, skipping relative ones', () => {
  const picked = pickPreview(['mailto:a@b.c', 'share/x', 'https://a.example/', 'https://b.example/'], none);
  assert.deepEqual(picked, { kind: 'link', url: 'https://a.example/', host: 'a.example' });
  assert.equal(pickPreview([], none), null);
  assert.equal(pickPreview(['share/x'], none), null);
});

test('pickPreview skips a link already shown as an image and previews the next', () => {
  const shown = new Set(['https://a.example/p.jpg']);
  assert.deepEqual(pickPreview(['https://a.example/p.jpg', 'https://youtu.be/dQw4w9WgXcQ'], shown), {
    kind: 'youtube',
    id: 'dQw4w9WgXcQ',
    url: 'https://youtu.be/dQw4w9WgXcQ',
    host: 'youtu.be',
  });
  assert.equal(pickPreview(['https://a.example/p.jpg'], shown), null);
});
