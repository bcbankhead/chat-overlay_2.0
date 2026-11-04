import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRepostLedger } from './reposted.js';

test('a registered hash is taken once, yielding its source id', () => {
  const ledger = createRepostLedger();
  ledger.register('abc', 'src-1');
  assert.equal(ledger.take('abc'), 'src-1');
  assert.equal(ledger.take('abc'), null);
});

test('a hash never registered is a miss', () => {
  const ledger = createRepostLedger();
  ledger.register('abc', 'src-1');
  assert.equal(ledger.take('def'), null);
  assert.equal(ledger.take('abc'), 'src-1');
});

test('entries are counted: two registrations of one hash are taken twice, oldest first', () => {
  const ledger = createRepostLedger();
  ledger.register('abc', 'src-1');
  ledger.register('abc', 'src-2');
  assert.equal(ledger.take('abc'), 'src-1');
  assert.equal(ledger.take('abc'), 'src-2');
  assert.equal(ledger.take('abc'), null);
});

test('two ledgers share nothing', () => {
  const a = createRepostLedger();
  const b = createRepostLedger();
  a.register('abc', 'src-1');
  assert.equal(b.take('abc'), null);
});
