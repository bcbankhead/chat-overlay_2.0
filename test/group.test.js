import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockHHMM, continuesGroup, GROUP_GAP_S, groupTime } from '../src/core/group.js';

const key = (over) => ({ user: 'bob', kind: 'public', t: 1000, ...over });

test('the same sender within the gap continues the group', () => {
  assert.equal(continuesGroup(key(), key({ t: 1000 + GROUP_GAP_S })), true);
});

test('a gap over five minutes starts a new group', () => {
  assert.equal(continuesGroup(key(), key({ t: 1000 + GROUP_GAP_S + 1 })), false);
});

test('a sender change starts a new group', () => {
  assert.equal(continuesGroup(key(), key({ user: 'alice' })), false);
});

test('a whisper or notice never continues and is never continued', () => {
  for (const kind of ['whisper', 'entry', 'exit', 'system']) {
    assert.equal(continuesGroup(key({ kind }), key()), false, `after ${kind}`);
    assert.equal(continuesGroup(key(), key({ kind })), false, `${kind} after public`);
  }
});

test('the first row heads its group', () => {
  assert.equal(continuesGroup(null, key()), false);
});

test('group time is mTime, or receipt time while pending', () => {
  assert.equal(groupTime({ mTime: '1700000000', receivedAt: 5 }), 1700000000);
  assert.equal(groupTime({ mTime: '', receivedAt: 1700000000500 }), 1700000000.5);
});

test('clock is 24-hour local HH:MM', () => {
  const d = new Date(2026, 0, 2, 7, 5);
  assert.equal(clockHHMM(d.getTime() / 1000), '07:05');
  assert.equal(clockHHMM(new Date(2026, 0, 2, 23, 59).getTime() / 1000), '23:59');
});
