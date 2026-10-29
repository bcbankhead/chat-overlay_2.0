import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS, MB_BYTES, historyCutoff, megabytesToBytes, parseDays, parseMegabytes, tagsToDelete } from './selectors.js';

test('historyCutoff: N days back from now, 0 every line, legacy null no limit', () => {
  const now = 10 * DAY_MS;
  assert.equal(historyCutoff(1, now), 9 * DAY_MS);
  assert.equal(historyCutoff(30, now), now - 30 * DAY_MS);
  assert.equal(historyCutoff(0, now), Infinity);
  assert.equal(historyCutoff(null, now), null);
});

test('parseDays takes whole numbers from 0 and refuses the rest', () => {
  assert.deepEqual(parseDays('0'), { ok: true, value: 0 });
  assert.deepEqual(parseDays(' 30 '), { ok: true, value: 30 });
  for (const bad of ['', '-1', '1.5', 'abc', '1e3']) assert.deepEqual(parseDays(bad), { ok: false }, bad);
});

test('parseMegabytes: empty is no limit, whole numbers from 1, the rest refused', () => {
  assert.deepEqual(parseMegabytes(''), { ok: true, value: null });
  assert.deepEqual(parseMegabytes('  '), { ok: true, value: null });
  assert.deepEqual(parseMegabytes('1'), { ok: true, value: 1 });
  assert.deepEqual(parseMegabytes('250'), { ok: true, value: 250 });
  for (const bad of ['0', '-5', '2.5', 'x']) assert.deepEqual(parseMegabytes(bad), { ok: false }, bad);
});

test('megabytesToBytes uses binary megabytes', () => {
  assert.equal(megabytesToBytes(1), MB_BYTES);
  assert.equal(megabytesToBytes(3), 3 * 1_048_576);
});

test('tagsToDelete selects tags of removed messages and images only', () => {
  const tags = [
    { id: 1, sourceMessageId: 'm1' },
    { id: 2, sourceMessageId: 'm2' },
    { id: 3, imageId: 'i1' },
    { id: 4, imageId: 'i2', sourceMessageId: 'm3' },
    { id: 5 },
  ];
  assert.deepEqual(tagsToDelete(tags, ['m1'], []), [1]);
  assert.deepEqual(tagsToDelete(tags, [], ['i1', 'i2']), [3, 4]);
  assert.deepEqual(tagsToDelete(tags, ['m3', 'm2'], ['i1']), [2, 3, 4]);
  assert.deepEqual(tagsToDelete(tags, [], []), []);
});
