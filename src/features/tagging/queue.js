// The reaction send queue. Pure: the clock, the timers, the engine send and the settings are
// injected. The chat is strict about message frequency, so reactions go out FIFO, each at
// least `likeIntervalSeconds` after both the last reaction and the last own message (A5).
// The engine drops a send while its shared request is busy, so a send waits for it to idle.
// The server never echoes own messages, so delivery is judged by the reaction's own request
// (B4): 2xx is sent; anything else, or no answer in time, re-queues once, then fails.
// A like is permanent: the queue has no way to send a retraction (TDF-0011).

import { PENDING_TTL_MS } from '../../core/reconcile.js';
import { reactionText } from './reactions.js';

const READY_RETRY_MS = 1000;
// Past the engine hook's own wait for the echo (it marks it unconfirmed at PENDING_TTL_MS + 1),
// so a timed-out attempt's re-derive already sees it unconfirmed, and no answer the hook would
// still take as sent arrives after the queue has given up on it.
const CONFIRM_TIMEOUT_MS = PENDING_TTL_MS + 1000;
/** The first send and its one re-queue. */
const MAX_ATTEMPTS = 2;

/**
 * The slice of the engine's `sendReq` XMLHttpRequest the queue reads.
 * @typedef {object} SendRequest
 * @property {number} readyState
 * @property {number} status
 * @property {(type: 'loadend', listener: () => void, options: { once: true }) => void} addEventListener
 */

/**
 * @typedef {object} QueueDeps
 * @property {() => number} now                       epoch ms
 * @property {(fn: () => void, ms: number) => unknown} setTimer
 * @property {(handle: unknown) => void} clearTimer
 * @property {(text: string) => boolean} send          false when the engine refused it
 * @property {() => SendRequest | null | undefined} request  the engine's current `sendReq`
 * @property {() => number} intervalSeconds
 * @property {(text: string) => void} resetRepeat      let the engine's repeat filter pass `text`
 * @property {() => string | null} [tokenColor]       `#rrggbb` the image token is hidden in; null sends it plain
 * @property {() => void} [onAttemptFailed]            after any send that did not go through
 */

/** @typedef {'queued' | 'sending' | 'failed'} EntryState */

/**
 * @typedef {object} Entry
 * @property {string} shareId
 * @property {string} code
 * @property {string} text
 * @property {EntryState} state
 * @property {number} attempts
 * @property {string} reason  why the last attempt failed; '' while none has
 */

/**
 * @typedef {object} EntryView
 * @property {string} shareId
 * @property {string} code
 * @property {EntryState} state
 * @property {number} position  1-based place among queued entries; 0 when not queued
 * @property {string} reason    why the last attempt failed; '' while none has
 */

/**
 * @param {QueueDeps} deps
 */
export function createReactionQueue(deps) {
  /** @type {Entry[]} */
  let entries = [];
  let lastSentAt = -Infinity;
  let lastOwnAt = -Infinity;
  /** @type {unknown} */
  let timer = null;
  /** @type {Entry | null} */
  let sending = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const changed = () => {
    for (const fn of listeners) fn();
  };

  /** @param {string} shareId */
  const find = (shareId) => entries.find((e) => e.shareId === shareId);

  const dueAt = () => Math.max(lastSentAt, lastOwnAt) + deps.intervalSeconds() * 1000;

  /** @param {number} ms */
  const wake = (ms) => {
    timer = deps.setTimer(fire, Math.max(0, ms));
  };

  function schedule() {
    if (timer !== null || sending || !entries.some((e) => e.state === 'queued')) return;
    wake(dueAt() - deps.now());
  }

  function fire() {
    timer = null;
    const entry = entries.find((e) => e.state === 'queued');
    if (!entry || sending) return;
    // An own message seen since the timer was set moves the next send back.
    if (deps.now() < dueAt()) return schedule();
    const busy = deps.request();
    if (busy && busy.readyState !== 0 && busy.readyState !== 4) return wake(READY_RETRY_MS);

    entry.state = 'sending';
    entry.attempts += 1;
    sending = entry;
    lastSentAt = deps.now();
    changed();

    /** @type {string | null} */
    let refused = null;
    try {
      // Refused by the engine itself (silenced, spam, flood): no retry (A7).
      if (!deps.send(entry.text)) refused = 'refused by the chat';
    } catch (err) {
      refused = `the send failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`;
    }
    if (refused !== null) {
      sending = null;
      entry.state = 'failed';
      entry.reason = refused;
      changed();
      deps.onAttemptFailed?.();
      return schedule();
    }

    const req = deps.request();
    let settled = false;
    /** @param {string | null} failure  null when sent */
    const settle = (failure) => {
      if (settled) return;
      settled = true;
      deps.clearTimer(timeout);
      sending = null;
      const ok = failure === null;
      if (!ok) entry.reason = failure;
      if (ok) entries = entries.filter((e) => e !== entry);
      else if (entry.attempts < MAX_ATTEMPTS) {
        // The resend is the same text, which the engine's repeat filter would refuse (A6).
        deps.resetRepeat(entry.text);
        entry.state = 'queued';
      } else entry.state = 'failed';
      changed();
      if (!ok) deps.onAttemptFailed?.();
      schedule();
    };
    const timeout = deps.setTimer(() => settle(`no answer within ${CONFIRM_TIMEOUT_MS / 1000} s`), CONFIRM_TIMEOUT_MS);
    if (req) {
      req.addEventListener(
        'loadend',
        () => settle(req.status >= 200 && req.status < 300 ? null : `the server answered ${req.status || 'nothing'}`),
        { once: true },
      );
    } else settle('the chat has no send request to watch');
  }

  return {
    /**
     * Like an image with a smiley. Nothing is queued when you already reacted to it with any
     * smiley, or a like for it is queued or sending; a failed one is retried with the smiley
     * picked now. One entry per image.
     * @param {string} shareId
     * @param {string} code
     * @param {boolean} alreadyMine  the store already holds a reaction of yours on the image
     * @returns {boolean} whether a like was queued
     */
    like(shareId, code, alreadyMine) {
      if (alreadyMine) return false;
      const entry = find(shareId);
      if (entry?.state === 'queued' || entry?.state === 'sending') return false;
      const text = reactionText(code, shareId, deps.tokenColor?.() ?? null);
      if (entry) {
        entry.code = code;
        entry.text = text;
        entry.state = 'queued';
        entry.attempts = 0;
        // Moved to the back, as a new choice would be.
        entries = [...entries.filter((e) => e !== entry), entry];
      } else entries.push({ shareId, code, text, state: 'queued', attempts: 0, reason: '' });
      changed();
      schedule();
      return true;
    },

    /**
     * An own message was seen (a reaction's own echo included).
     * @param {number} [at]
     */
    noteOwnMessage(at = deps.now()) {
      if (at > lastOwnAt) lastOwnAt = at;
    },

    /**
     * Every entry on an image.
     * @param {string} shareId
     * @returns {EntryView[]}
     */
    entriesFor(shareId) {
      const queued = entries.filter((e) => e.state === 'queued');
      return entries
        .filter((e) => e.shareId === shareId)
        .map((e) => ({
          shareId: e.shareId,
          code: e.code,
          state: e.state,
          position: e.state === 'queued' ? queued.indexOf(e) + 1 : 0,
          reason: e.reason,
        }));
    },

    /**
     * @param {() => void} fn
     * @returns {() => void} unsubscribe
     */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createReactionQueue>} ReactionQueue */
