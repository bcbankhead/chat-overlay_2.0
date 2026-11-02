import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORAGE_AGE_DAYS, countFromDays, parseHistoryCount } from '../../core/retention.js';
import {
  DAY_MS,
  HISTORY_ON,
  MB_BYTES,
  megabytesToBytes,
  parseMegabytes,
  senderLabel,
  storageCutoff,
} from './selectors.js';

test('parseHistoryCount keeps 0 and 25 and reads anything else, the old 100 included, as 25', () => {
  assert.equal(HISTORY_ON, 25);
  assert.equal(parseHistoryCount(0), 0);
  assert.equal(parseHistoryCount(25), 25);
  for (const other of [100, 50, 30, -0.5, '0', '100', null, undefined, NaN, true, {}]) {
    assert.equal(parseHistoryCount(other), 25, String(other));
  }
});

test('countFromDays: 0 days becomes 0, any other value, null included, 25', () => {
  assert.equal(countFromDays(0), 0);
  for (const days of [30, 1, 365, null, undefined, NaN]) assert.equal(countFromDays(days), 25, String(days));
});

test('storageCutoff: off deletes every line, on the fixed 30-day storage age', () => {
  const now = 100 * DAY_MS;
  assert.equal(STORAGE_AGE_DAYS, 30);
  assert.equal(storageCutoff(0, now), Infinity);
  assert.equal(storageCutoff(25, now), now - 30 * DAY_MS);
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

test('senderLabel decodes a stored sender for display and keeps a malformed one as stored', () => {
  assert.equal(senderLabel('Big%20Bob'), 'Big Bob');
  assert.equal(senderLabel('alice'), 'alice');
  assert.equal(senderLabel('100%'), '100%');
});
