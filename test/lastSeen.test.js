import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lastSeenText } from '../src/core/lastSeen.js';

const SENT = 1_800_000_000; // server seconds
const at = (/** @type {number} */ ageMs) => SENT * 1000 + ageMs;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('under an hour reads < 1 hour', () => {
  assert.equal(lastSeenText(String(SENT), at(0)), 'Last seen < 1 hour ago');
  assert.equal(lastSeenText(String(SENT), at(59 * MIN)), 'Last seen < 1 hour ago');
  assert.equal(lastSeenText(String(SENT), at(HOUR - 1)), 'Last seen < 1 hour ago');
});

test('one hour to just under a day reads whole hours, singular and plural', () => {
  assert.equal(lastSeenText(String(SENT), at(HOUR)), 'Last seen 1 hour ago');
  assert.equal(lastSeenText(String(SENT), at(2 * HOUR - 1)), 'Last seen 1 hour ago');
  assert.equal(lastSeenText(String(SENT), at(2 * HOUR)), 'Last seen 2 hours ago');
  assert.equal(lastSeenText(String(SENT), at(23 * HOUR + 59 * MIN)), 'Last seen 23 hours ago');
});

test('a day and over reads whole days, singular and plural', () => {
  assert.equal(lastSeenText(String(SENT), at(DAY)), 'Last seen 1 day ago');
  assert.equal(lastSeenText(String(SENT), at(2 * DAY - 1)), 'Last seen 1 day ago');
  assert.equal(lastSeenText(String(SENT), at(2 * DAY)), 'Last seen 2 days ago');
  assert.equal(lastSeenText(SENT, at(40 * DAY)), 'Last seen 40 days ago');
});

test('a line from the future reads as under an hour', () => {
  assert.equal(lastSeenText(String(SENT), at(-5 * MIN)), 'Last seen < 1 hour ago');
});

test('an absent or unusable time gives null', () => {
  for (const bad of [undefined, null, '', 'x', '0', '-5', 'NaN', 'Infinity']) {
    assert.equal(lastSeenText(bad, at(HOUR)), null, String(bad));
  }
  assert.equal(lastSeenText(String(SENT), NaN), null);
});
