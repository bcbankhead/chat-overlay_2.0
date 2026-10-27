import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PENDING_TTL_MS, findPending, isExpired, provisionalId } from '../src/core/reconcile.js';

const now = 1_000_000;
const p = (id, receivedAt, user = 'Alice', text = 'hi') => ({ id, user, text, receivedAt });

test('findPending returns the oldest matching pending record', () => {
  const pendings = [p('b', now - 1000), p('a', now - 2000), p('c', now - 500, 'Alice', 'other')];
  assert.equal(findPending({ user: 'alice', text: 'hi' }, pendings, now)?.id, 'a');
});

test('findPending ignores other users, other text and expired records', () => {
  assert.equal(findPending({ user: 'bob', text: 'hi' }, [p('a', now)], now), null);
  assert.equal(findPending({ user: 'alice', text: 'yo' }, [p('a', now)], now), null);
  assert.equal(findPending({ user: 'alice', text: 'hi' }, [p('a', now - PENDING_TTL_MS - 1)], now), null);
});

test('isExpired is strictly past the 60 s window', () => {
  assert.equal(isExpired({ receivedAt: now - PENDING_TTL_MS }, now), false);
  assert.equal(isExpired({ receivedAt: now - PENDING_TTL_MS - 1 }, now), true);
});

test('provisionalId has the contract shape', () => {
  assert.equal(provisionalId(123, 4), 'local-123-4');
});
