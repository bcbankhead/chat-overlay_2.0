import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockHHMM, continuesGroup, GROUP_GAP_S, groupTime, localDay, orderKey, timeLabel } from '../src/core/group.js';

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

test('order key is mTime in milliseconds, or receipt time while pending', () => {
  assert.equal(orderKey({ mTime: '1700000000', receivedAt: 5 }), 1700000000000);
  assert.equal(orderKey({ mTime: '', receivedAt: 1700000000500 }), 1700000000500);
  assert.equal(orderKey({ mTime: '0', receivedAt: 42 }), 42);
});

test("order key is a send-confirmed own message's estimated server time; mTime still wins", () => {
  assert.equal(orderKey({ mTime: '', receivedAt: 1700000600500, orderAt: 1700000000500 }), 1700000000500);
  assert.equal(orderKey({ mTime: '1700000000', receivedAt: 5, orderAt: 9 }), 1700000000000);
});

test('clock is 24-hour local HH:MM', () => {
  const d = new Date(2026, 0, 2, 7, 5);
  assert.equal(clockHHMM(d.getTime() / 1000), '07:05');
  assert.equal(clockHHMM(new Date(2026, 0, 2, 23, 59).getTime() / 1000), '23:59');
});

const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min).getTime() / 1000;

test('local day is the local calendar date, split at midnight', () => {
  assert.equal(localDay(at(2026, 9, 29, 23, 59)), '2026-10-29');
  assert.equal(localDay(at(2026, 9, 30, 0, 0)), '2026-10-30');
  assert.equal(localDay(at(2026, 0, 2, 7, 5)), '2026-01-02');
});

test("a time on the viewer's day is HH:MM", () => {
  assert.equal(timeLabel(at(2026, 9, 30, 0, 0), at(2026, 9, 30, 23, 59), 'en-US'), '00:00');
  assert.equal(timeLabel(at(2026, 9, 30, 9, 7), at(2026, 9, 30, 9, 8), 'en-US'), '09:07');
});

test('a time from an earlier day carries its computed weekday and full date', () => {
  // 29 Oct 2026 is a Thursday.
  assert.equal(timeLabel(at(2026, 9, 29, 22, 43), at(2026, 9, 30, 0, 1), 'en-US'), 'Thu, Oct 29 2026 22:43');
  assert.equal(timeLabel(at(2026, 9, 29, 23, 59), at(2026, 9, 30, 0, 0), 'en-US'), 'Thu, Oct 29 2026 23:59');
});

test('a time from the previous year carries that year', () => {
  assert.equal(timeLabel(at(2025, 11, 31, 23, 30), at(2026, 0, 1, 0, 15), 'en-US'), 'Wed, Dec 31 2025 23:30');
});

test('weekday and month names follow the locale, in the fixed order', () => {
  const t = at(2026, 9, 29, 22, 43);
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(t * 1000));
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(t * 1000));
  assert.equal(timeLabel(t, at(2026, 9, 30, 12), 'fr-FR'), `${weekday}, ${month} 29 2026 22:43`);
});
