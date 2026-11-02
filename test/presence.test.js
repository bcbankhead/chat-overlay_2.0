import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPresence } from '../src/core/presence.js';

/** @param {string} uuID @param {'entry' | 'exit'} kind @param {string} mTime */
const line = (uuID, kind, mTime, name = `u${uuID}`) => ({ uuID, name, kind, mTime });

test('each user keeps their newest line, of either kind', () => {
  const p = createPresence();
  p.ingest('1', [line('7', 'entry', '100'), line('7', 'exit', '200'), line('7', 'entry', '150')]);
  assert.deepEqual(p.seen('1'), [line('7', 'exit', '200')]);
  p.ingest('1', [line('7', 'entry', '300')]);
  assert.deepEqual(p.seen('1'), [line('7', 'entry', '300')]);
});

test('at the same second the line ingested later wins, as polls run oldest first', () => {
  const p = createPresence();
  p.ingest('1', [line('7', 'entry', '100'), line('7', 'exit', '100')]);
  assert.equal(p.seen('1')[0].kind, 'exit');
});

test('seen lists users newest line first', () => {
  const p = createPresence();
  p.ingest('1', [line('a', 'exit', '100'), line('b', 'entry', '300'), line('c', 'exit', '200')]);
  assert.deepEqual(p.seen('1').map((l) => l.uuID), ['b', 'c', 'a']);
});

test('rooms are kept apart, and an unknown room has nobody', () => {
  const p = createPresence();
  p.ingest('1', [line('a', 'exit', '100')]);
  p.ingest('2', [line('b', 'exit', '100')]);
  assert.deepEqual(p.seen('1').map((l) => l.uuID), ['a']);
  assert.deepEqual(p.seen('2').map((l) => l.uuID), ['b']);
  assert.deepEqual(p.seen('3'), []);
});

test('subscribers are told only when something changed, and can unsubscribe', () => {
  const p = createPresence();
  let told = 0;
  const off = p.subscribe(() => told++);
  p.ingest('1', []);
  assert.equal(told, 0);
  p.ingest('1', [line('a', 'exit', '100')]);
  assert.equal(told, 1);
  p.ingest('1', [line('a', 'exit', '100'), line('a', 'entry', '50')]);
  assert.equal(told, 1, 'a repeat and an older line change nothing');
  off();
  p.ingest('1', [line('a', 'entry', '200')]);
  assert.equal(told, 1);
});

test('a line with no uuID is ignored', () => {
  const p = createPresence();
  p.ingest('1', [line('', 'exit', '100')]);
  assert.deepEqual(p.seen('1'), []);
});

test('the store hands out copies, so a caller cannot change what it keeps', () => {
  const p = createPresence();
  const input = line('a', 'exit', '100');
  p.ingest('1', [input]);
  input.kind = 'entry';
  p.seen('1')[0].name = 'changed';
  assert.deepEqual(p.seen('1'), [line('a', 'exit', '100')]);
});

test('a line with an unreadable mTime orders as oldest and yields to any dated line', () => {
  const p = createPresence();
  p.ingest('1', [line('a', 'exit', 'x'), line('b', 'exit', '5')]);
  assert.deepEqual(p.seen('1').map((l) => l.uuID), ['b', 'a']);
  p.ingest('1', [line('a', 'entry', '1')]);
  assert.equal(p.seen('1').find((l) => l.uuID === 'a').kind, 'entry');
});
