import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReactionQueue } from './queue.js';

const READY_RETRY_MS = 1000;
// The engine hook's echo wait (PENDING_TTL_MS), plus the queue's 1 s margin past it.
const CONFIRM_TIMEOUT_MS = 61_000;

const A = '100000000111111';
const B = '100000000222222';
const C = '100000000333333';

/** A fake clock, timers, engine send and sendReq. */
function harness({ accept = true } = {}) {
  let now = 1_000_000;
  /** @type {{ at: number, fn: () => void, id: number }[]} */
  let timers = [];
  let nextId = 0;
  /** @type {{ text: string, at: number }[]} */
  const sent = [];
  /** @type {string[]} */
  const resets = [];
  let failures = 0;
  const req = {
    readyState: 4,
    status: 0,
    /** @type {(() => void) | null} */
    listener: null,
    /** @param {string} _type @param {() => void} fn */
    addEventListener(_type, fn) {
      this.listener = fn;
    },
    /** @param {number} status */
    answer(status) {
      this.status = status;
      this.readyState = 4;
      const fn = this.listener;
      this.listener = null;
      fn?.();
    },
  };
  const queue = createReactionQueue({
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextId;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    send: (text) => {
      sent.push({ text, at: now });
      if (accept) req.readyState = 1;
      return accept;
    },
    request: () => req,
    intervalSeconds: () => 15,
    resetRepeat: (text) => resets.push(text),
    onAttemptFailed: () => {
      failures += 1;
    },
  });
  /** Advance the clock by ms, firing due timers in order. */
  const advance = (/** @type {number} */ ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = end;
  };
  return { queue, req, sent, resets, advance, failures: () => failures, now: () => now };
}

/** @param {ReturnType<typeof harness>['queue']} queue @param {string} id */
const state = (queue, id) => queue.entriesFor(id).map((e) => `${e.code} ${e.state}${e.position ? ` #${e.position}` : ''}`);

test('reactions go out in order, at least 15 s apart', () => {
  const h = harness();
  h.queue.toggle(A, ':h', false);
  h.queue.toggle(B, ':h', false);
  h.queue.toggle(C, ':L', false);
  assert.deepEqual(state(h.queue, C), [':L queued #3']);
  h.advance(0);
  assert.deepEqual(h.sent.map((s) => s.text), [':h ^111111']);
  h.req.answer(200);
  h.advance(14_999);
  assert.equal(h.sent.length, 1);
  h.advance(1);
  h.req.answer(200);
  h.advance(15_000);
  h.req.answer(200);
  assert.deepEqual(h.sent.map((s) => s.text), [':h ^111111', ':h ^222222', ':L ^333333']);
  assert.deepEqual(h.sent.map((s) => s.at - h.sent[0].at), [0, 15_000, 30_000]);
  assert.deepEqual(state(h.queue, A), []);
});

test('two consecutive likes with the same emoji differ by their token, so neither is refused', () => {
  const h = harness();
  h.queue.toggle(A, ':h', false);
  h.queue.toggle(B, ':h', false);
  h.advance(0);
  h.req.answer(200);
  h.advance(15_000);
  assert.notEqual(h.sent[0].text, h.sent[1].text);
});

test('an own message seen pushes the next reaction back', () => {
  const h = harness();
  h.queue.noteOwnMessage(h.now());
  h.queue.toggle(A, ':h', false);
  h.advance(10_000);
  h.queue.noteOwnMessage(h.now());
  h.advance(14_999);
  assert.equal(h.sent.length, 0);
  h.advance(1);
  assert.equal(h.sent.length, 1);
});

test('a send waits for the engine request to idle, retrying every second', () => {
  const h = harness();
  h.req.readyState = 2;
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  h.advance(READY_RETRY_MS * 3);
  assert.equal(h.sent.length, 0);
  h.req.readyState = 4;
  h.advance(READY_RETRY_MS);
  assert.equal(h.sent.length, 1);
});

test('a non-2xx answer re-queues once with the repeat filter reset, then fails', () => {
  const h = harness();
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  h.req.answer(500);
  assert.deepEqual(h.resets, [':h ^111111']);
  assert.deepEqual(state(h.queue, A), [':h queued #1']);
  h.advance(15_000);
  assert.equal(h.sent.length, 2);
  h.req.answer(0);
  assert.deepEqual(state(h.queue, A), [':h failed']);
  assert.equal(h.failures(), 2);
  h.advance(60_000);
  assert.equal(h.sent.length, 2);
});

test('no answer within 61 s counts as a failed attempt', () => {
  const h = harness();
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  h.advance(CONFIRM_TIMEOUT_MS - 1);
  assert.deepEqual(state(h.queue, A), [':h sending']);
  h.advance(1);
  assert.deepEqual(state(h.queue, A), [':h queued #1']);
  h.req.readyState = 4;
  h.advance(CONFIRM_TIMEOUT_MS);
  h.advance(CONFIRM_TIMEOUT_MS);
  assert.deepEqual(state(h.queue, A), [':h failed']);
  // A late answer to a settled attempt changes nothing.
  h.req.answer(200);
  assert.deepEqual(state(h.queue, A), [':h failed']);
});

test('a failed chip toggled again is retried', () => {
  const h = harness({ accept: false });
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  assert.deepEqual(state(h.queue, A), [':h failed']);
  h.queue.toggle(A, ':h', false);
  assert.deepEqual(state(h.queue, A), [':h queued #1']);
});

test('an engine refusal fails at once, with no retry', () => {
  const h = harness({ accept: false });
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  assert.deepEqual(state(h.queue, A), [':h failed']);
  assert.deepEqual(h.resets, []);
  h.advance(60_000);
  assert.equal(h.sent.length, 1);
});

test('choosing a queued reaction again cancels it, and nothing is sent', () => {
  const h = harness();
  h.queue.toggle(A, ':h', false);
  h.advance(0);
  h.req.answer(200);
  h.queue.toggle(B, ':h', false);
  h.queue.toggle(B, ':h', false);
  assert.deepEqual(state(h.queue, B), []);
  h.advance(60_000);
  assert.equal(h.sent.length, 1);
});

test('choosing a sent reaction again queues its retraction', () => {
  const h = harness();
  h.queue.toggle(A, ':h', true);
  h.advance(0);
  assert.deepEqual(h.sent.map((s) => s.text), ['-:h ^111111']);
});

test('one entry per image and code; a different code is its own entry', () => {
  const h = harness();
  h.req.readyState = 1;
  h.queue.toggle(A, ':h', false);
  h.queue.toggle(A, ':L', false);
  assert.deepEqual(state(h.queue, A), [':h queued #1', ':L queued #2']);
  h.advance(0);
  h.req.readyState = 4;
  h.advance(READY_RETRY_MS);
  // While sending, choosing the same smiley again does nothing.
  h.queue.toggle(A, ':h', false);
  assert.deepEqual(state(h.queue, A), [':h sending', ':L queued #1']);
});

test('a failed reaction carries why: refused, a non-2xx answer, or no answer', () => {
  const refused = harness({ accept: false });
  refused.queue.toggle(A, ':h', false);
  refused.advance(0);
  assert.equal(refused.queue.entriesFor(A)[0].reason, 'refused by the chat');

  const answered = harness();
  answered.queue.toggle(A, ':h', false);
  answered.advance(0);
  answered.req.answer(503);
  assert.equal(answered.queue.entriesFor(A)[0].reason, 'the server answered 503');

  const silent = harness();
  silent.queue.toggle(A, ':h', false);
  silent.advance(CONFIRM_TIMEOUT_MS);
  assert.equal(silent.queue.entriesFor(A)[0].reason, 'no answer within 61 s');
});

test('with no send request to watch, an accepted send counts as a failed attempt', () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {(() => void)[]} */
  const timers = [];
  const queue = createReactionQueue({
    now: () => 0,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    send: (text) => (sent.push(text), true),
    request: () => null,
    intervalSeconds: () => 15,
    resetRepeat: () => {},
  });
  queue.toggle(A, ':h', false);
  timers.shift()?.();
  assert.deepEqual(queue.entriesFor(A).map((e) => [e.state, e.reason]), [['queued', 'the chat has no send request to watch']]);
});

test('a send that throws fails the reaction with the error, and the queue moves on', () => {
  /** @type {(() => void)[]} */
  const timers = [];
  let calls = 0;
  const queue = createReactionQueue({
    now: () => 0,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    send: () => {
      calls += 1;
      throw new Error('addMessage is broken');
    },
    request: () => null,
    intervalSeconds: () => 0,
    resetRepeat: () => {},
  });
  queue.toggle(A, ':h', false);
  queue.toggle(B, ':h', false);
  timers.shift()?.();
  assert.deepEqual(queue.entriesFor(A).map((e) => [e.state, e.reason]), [['failed', 'the send failed: addMessage is broken']]);
  timers.shift()?.();
  assert.equal(calls, 2);
});
