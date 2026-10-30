import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFilename, extFromType, extractShareIds, formatBytes, overLimit, sanitizeSender, shareUrl } from './shareParse.js';

// The observed share text (reference/ANALYSIS.md, Images).
const SHARE =
  '[[br]][[a href="plugins/share/view.php?id=123456789012345" target="_blank"]]' +
  '[[img src="plugins/share/view.php?id=123456789012345" style="max-width:200px"]][[/a]]';

test('a share message yields its one id, though the text names it twice', () => {
  assert.deepEqual(extractShareIds(SHARE), ['123456789012345']);
});

test('several shares in one message, in order, deduplicated; other digits are ignored', () => {
  const text = `${SHARE} and view.php?id=999999999999999 then view.php?id=123456789012345`;
  assert.deepEqual(extractShareIds(text), ['123456789012345', '999999999999999']);
  assert.deepEqual(extractShareIds('view.php?id=12345 view.php?id=1234567890123456 plain text'), []);
});

test('the URL is derived from the id against the chat page', () => {
  assert.equal(
    shareUrl('123456789012345', 'https://dollforum.com/forum/chat/index.php?room=1'),
    'https://dollforum.com/forum/chat/plugins/share/view.php?id=123456789012345',
  );
});

test('extension follows the served content type', () => {
  assert.equal(extFromType('image/jpeg'), 'jpg');
  assert.equal(extFromType('IMAGE/PNG; charset=binary'), 'png');
  assert.equal(extFromType('image/gif'), 'gif');
  assert.equal(extFromType('image/webp'), 'webp');
  assert.equal(extFromType('application/octet-stream'), 'bin');
  assert.equal(extFromType(''), 'bin');
  assert.equal(extFromType(null), 'bin');
});

test('sender names are reduced to filename-safe characters', () => {
  assert.equal(sanitizeSender('Dolly Belle'), 'Dolly_Belle');
  assert.equal(sanitizeSender('a/b\\c:d*?"<>|'), 'a_b_c_d');
  assert.equal(sanitizeSender('Mar%C3%ADa'), 'Mar_a');
  assert.equal(sanitizeSender('...'), 'unknown');
  assert.equal(sanitizeSender(''), 'unknown');
  assert.equal(sanitizeSender('x'.repeat(80)).length, 40);
});

test('filename: <sender>_<YYYY-MM-DD_HHmmss>_<shareId>.<ext>, local time from mTime, else receivedAt', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const base = { sender: 'Dolly Belle', id: '123456789012345', contentType: 'image/jpeg', receivedAt: 0 };
    assert.equal(buildFilename({ ...base, mTime: '1761696000' }), 'Dolly_Belle_2025-10-29_000000_123456789012345.jpg');
    assert.equal(
      buildFilename({ ...base, mTime: '', receivedAt: Date.UTC(2026, 0, 2, 3, 4, 5), contentType: 'image/png' }),
      'Dolly_Belle_2026-01-02_030405_123456789012345.png',
    );
    process.env.TZ = 'America/Denver';
    assert.equal(buildFilename({ ...base, mTime: '1761696000' }), 'Dolly_Belle_2025-10-28_180000_123456789012345.jpg');
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test('overLimit picks oldest non-favourites until the gallery fits, never a favourite', () => {
  const items = [
    { id: 'old-fav', receivedAt: 1, bytes: 100, favorite: true },
    { id: 'old', receivedAt: 2, bytes: 100 },
    { id: 'mid', receivedAt: 3, bytes: 100 },
    { id: 'new', receivedAt: 4, bytes: 100 },
  ];
  assert.deepEqual(overLimit(items, 400), []);
  assert.deepEqual(overLimit(items, 350), ['old']);
  assert.deepEqual(overLimit(items, 200), ['old', 'mid']);
  // Even a limit no non-favourite deletion can reach leaves the favourite.
  assert.deepEqual(overLimit(items, 0), ['old', 'mid', 'new']);
  assert.deepEqual(overLimit([], 0), []);
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

test('a sender name that is not URI-encoded is kept as given', () => {
  assert.equal(sanitizeSender('100%zz'), '100_zz');
});
