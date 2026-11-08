import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSenderSet } from './senders.js';

/** A read the test settles by hand, counting its calls. */
const manualRead = () => {
  /** @type {{ resolve: (v: Set<string>) => void, reject: (e: unknown) => void }[]} */
  const pending = [];
  const read = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { read, pending };
};

test('has is false before the first read lands, and answers from it after', async () => {
  const { read, pending } = manualRead();
  const senders = createSenderSet({ read, report: () => assert.fail('nothing to report') });
  assert.equal(senders.has('alice'), false, 'before any refresh');
  const done = senders.refresh();
  assert.equal(senders.has('alice'), false, 'while the read is in flight');
  pending[0].resolve(new Set(['alice']));
  await done;
  assert.equal(senders.has('alice'), true);
  assert.equal(senders.has('bob'), false);
});

test('refreshes during a read coalesce into one more read after it', async () => {
  const { read, pending } = manualRead();
  const senders = createSenderSet({ read, report: () => assert.fail('nothing to report') });
  const first = senders.refresh();
  const queued = [senders.refresh(), senders.refresh(), senders.refresh()];
  assert.equal(pending.length, 1, 'one read in flight');
  assert.equal(queued[0], queued[2], 'one queued read shared by every later refresh');
  pending[0].resolve(new Set(['alice']));
  await first;
  await Promise.resolve();
  assert.equal(pending.length, 2, 'the queued read starts once the first lands');
  pending[1].resolve(new Set(['bob']));
  await Promise.all(queued);
  assert.equal(pending.length, 2, 'no third read');
  assert.equal(senders.has('alice'), false, 'the later read replaces the set');
  assert.equal(senders.has('bob'), true);
  // Idle again: the next refresh reads at once.
  const again = senders.refresh();
  assert.equal(pending.length, 3);
  pending[2].resolve(new Set());
  await again;
  assert.equal(senders.has('bob'), false);
});

test('a failed read is reported and the last good set stands', async () => {
  const { read, pending } = manualRead();
  /** @type {unknown[]} */
  const reported = [];
  const senders = createSenderSet({ read, report: (err) => reported.push(err) });
  const first = senders.refresh();
  pending[0].resolve(new Set(['alice']));
  await first;
  const failed = senders.refresh();
  const boom = new Error('read failed');
  pending[1].reject(boom);
  await failed;
  assert.deepEqual(reported, [boom]);
  assert.equal(senders.has('alice'), true);
});

test('a read that fails before any good one leaves the set empty; a throwing read is reported too', async () => {
  /** @type {unknown[]} */
  const reported = [];
  const boom = new Error('no store');
  const senders = createSenderSet({
    read: () => {
      throw boom;
    },
    report: (err) => reported.push(err),
  });
  await senders.refresh();
  assert.deepEqual(reported, [boom]);
  assert.equal(senders.has('alice'), false);
  await senders.refresh();
  assert.equal(reported.length, 2, 'a later refresh reads again');
});
