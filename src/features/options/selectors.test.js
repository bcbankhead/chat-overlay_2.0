import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORAGE_LINES, countFromDays, parseHistoryCount } from '../../core/retention.js';
import {
  HISTORY_ON,
  MB_BYTES,
  megabytesToBytes,
  parseMegabytes,
  senderLabel,
  storageLines,
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

test('storageLines: off keeps no line, on keeps each room’s newest STORAGE_LINES, above HISTORY_ON (TDF-0084)', () => {
  assert.equal(STORAGE_LINES, 50);
  assert.ok(STORAGE_LINES > HISTORY_ON, 'storage keeps a margin over replay');
  assert.equal(storageLines(0), 0);
  assert.equal(storageLines(25), 50);
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
