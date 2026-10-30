import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractShareIds, formatBytes, overLimit, shareUrl } from './shareParse.js';

// The observed share text (reference/ANALYSIS.md, Images).
const SHARE =
  '[[br]][[a href="plugins/share/view.php?id=123456789012345" target="_blank"]]' +
  '[[img src="plugins/share/view.php?id=123456789012345" style="max-width:200px"]][[/a]]';

test('a share message yields its one id, though the text names it twice', () => {
  assert.deepEqual(extractShareIds(SHARE), ['123456789012345']);
});

test('several shares in one message, in order, deduplicated; other digits are ignored', () => {
  const text = `${SHARE} and plugins/share/view.php?id=999999999999999 then plugins/share/view.php?id=123456789012345`;
  assert.deepEqual(extractShareIds(text), ['123456789012345', '999999999999999']);
  assert.deepEqual(extractShareIds('plugins/share/view.php?id=12345 plain text'), [], 'too short for a like to name');
});

test('only the share path counts: another page or site with an id is not a share', () => {
  assert.deepEqual(extractShareIds('see preview.php?id=123456'), []);
  assert.deepEqual(extractShareIds('https://example.com/view.php?id=1234567'), []);
  assert.deepEqual(
    extractShareIds('https://chat.example.com/forum/chat/plugins/share/view.php?id=123456789012345'),
    ['123456789012345'],
  );
});

test('an id of other than 15 digits is still a share id', () => {
  assert.deepEqual(
    extractShareIds(
      'plugins/share/view.php?id=17933387086952 plugins/share/view.php?id=1234567890123456 plugins/share/view.php?id=123456',
    ),
    ['17933387086952', '1234567890123456', '123456'],
  );
});

test('the URL is derived from the id against the chat page', () => {
  assert.equal(
    shareUrl('123456789012345', 'https://chat.example.com/forum/chat/index.php?room=1'),
    'https://chat.example.com/forum/chat/plugins/share/view.php?id=123456789012345',
  );
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
