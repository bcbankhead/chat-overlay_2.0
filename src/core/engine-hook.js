// Inbound hook over the engine's page globals. Wraps `handleMessages` to read each poll's
// server records (which carry the server id, field [0]) and `createMessageDiv` to learn
// whether the engine actually rendered each message, so the engine's own filters (blocked
// users, duplicates, commands, PM rules) still decide what is shown and stored.

import { describeError } from './errors.js';
import { emitInbound } from './events.js';
import { nextReceivedAt } from './history.js';
import {
  MAIN_DIV,
  classify,
  isDelete,
  parseBody,
  parseUserMessage,
  safeDecodeURI,
  whisperTarget,
} from './parse.js';
import { PENDING_TTL_MS, findPending, provisionalId } from './reconcile.js';

/** @typedef {import('./history.js').MessageRecord} MessageRecord */
/** @typedef {import('./parse.js').ServerMessage} ServerMessage */

/**
 * Whether the page carries the engine globals the hook wraps. Without them the hook
 * installs nothing and the engine runs unmodified.
 * @param {any} win
 */
export function engineAvailable(win) {
  return Boolean(
    win.receiveMesReq &&
      typeof win.showMessages === 'number' &&
      typeof win.handleMessages === 'function' &&
      typeof win.createMessageDiv === 'function',
  );
}

/**
 * @typedef {object} EngineCall the createMessageDiv arguments the hook reads
 * @property {string} mDiv
 * @property {string} message
 * @property {string} mUser
 * @property {string} mToUser
 * @property {string} mTime
 */

/**
 * @typedef {object} Observed one createMessageDiv call, as the hook saw it
 * @property {EngineCall} call
 * @property {ServerMessage | undefined} server the poll's record paired with the call
 * @property {boolean} inPoll
 * @property {boolean} rendered
 * @property {number} at epoch ms of the call
 */

/**
 * @typedef {object} EngineHook
 * @property {(deps: {
 *   history: import('./history.js').History,
 *   view: import('./view.js').View,
 *   pending?: MessageRecord[],
 *   replayed?: MessageRecord[],
 * }) => void} attach start storing and showing: adopt the room's stored pending own
 *   messages, then flush, in order, what the engine rendered since install
 * @property {() => void} abandon stop observing; the wrappers pass straight through
 */

const UNPAIRED_NOTICE =
  'A message was shown but not saved: no server record in its poll matched its time and sender';

/**
 * Wrap the engine globals. Calls observed before `attach` are buffered, so messages the
 * engine renders during the overlay's async startup are not lost.
 * @param {{ win: any, roomID: string }} deps
 * @returns {EngineHook | null} null when the engine globals are missing
 */
export function installEngineHook({ win, roomID }) {
  if (!engineAvailable(win)) return null;
  const origHandle = win.handleMessages;
  const origCreate = win.createMessageDiv;

  const lang = {
    publicEntry: String(win.publicEntry ?? ''),
    publicExit: String(win.publicExit ?? ''),
  };

  /** Server records of the poll being handled, in createMessageDiv call order. */
  /** @type {ServerMessage[]} */
  let queue = [];
  let inPoll = false;
  let seq = 0;
  /** @type {MessageRecord[]} pending own messages awaiting their server copy */
  let pendings = [];
  /** @type {Observed[] | null} calls awaiting `attach`; null once attached */
  let buffered = [];
  let abandoned = false;
  /** @type {Set<string>} ids the replay already showed */
  let replayedIds = new Set();
  /** @type {import('./history.js').History} */
  let history;
  /** @type {import('./view.js').View} */
  let view;

  /** @param {Promise<unknown>} p */
  const report = (p) => p.catch((err) => view.notice(`Chat history not saved: ${describeError(err)}`));

  /** @param {MessageRecord} record */
  const emit = (record) => {
    try {
      emitInbound(record);
    } catch (err) {
      view.notice(`A chat feature failed: ${describeError(err)}`);
    }
  };

  /** @param {Observed} observed */
  const safeObserve = (observed) => {
    try {
      observe(observed);
    } catch (err) {
      view.notice(`Message not recorded: ${describeError(err)}`);
    }
  };

  /**
   * Mark a pending own message unconfirmed when its wait runs out, unless confirmed first.
   * @param {MessageRecord} record
   * @param {number} delay ms
   */
  const expireLater = (record, delay) => {
    win.setTimeout(() => {
      if (!pendings.includes(record)) return;
      pendings = pendings.filter((p) => p !== record);
      report(history.markUnconfirmed(record.id));
      view.markUnconfirmed(record.id);
    }, Math.max(0, delay));
  };

  win.handleMessages = function (/** @type {unknown[]} */ ...args) {
    if (abandoned) return origHandle.apply(this, args);
    const req = win.receiveMesReq;
    if (req && req.readyState == 4 && req.responseXML) {
      queue = Array.from(req.responseXML.getElementsByTagName('usermessage'), (node) =>
        parseUserMessage(/** @type {Element} */ (node).textContent ?? ''),
      );
      inPoll = true;
    }
    try {
      return origHandle.apply(this, args);
    } finally {
      inPoll = false;
      queue = [];
    }
  };

  win.createMessageDiv = function (
    /** @type {unknown} */ mStatus,
    /** @type {string} */ mUID,
    /** @type {string} */ mDiv,
    /** @type {unknown} */ mID,
    /** @type {string} */ message,
    /** @type {string} */ sfx,
    /** @type {string} */ mUser,
    /** @type {string} */ mToUser,
    /** @type {string} */ mTime,
  ) {
    if (abandoned) return origCreate.apply(this, arguments);
    /** @type {EngineCall} */
    const call = { mDiv, message, mUser: mUser ?? '', mToUser: mToUser ?? '', mTime: String(mTime ?? '') };
    // Pair the call with its server record before the original runs. The engine renders a
    // poll's records in order but may skip one, so the first record with the call's mTime
    // and sender pairs, and the records skipped before it are dropped.
    /** @type {ServerMessage | undefined} */
    let server;
    if (inPoll) {
      const i = queue.findIndex((s) => s.mTime === call.mTime && s.user === call.mUser);
      if (i >= 0) {
        server = queue[i];
        queue = queue.slice(i + 1);
      }
    }
    const before = win.showMessages;
    const result = origCreate.apply(this, arguments);
    /** @type {Observed} */
    const observed = { call, server, inPoll, rendered: win.showMessages > before, at: Date.now() };
    if (buffered) buffered.push(observed);
    else safeObserve(observed);
    return result;
  };

  /** @param {Observed} observed */
  function observe({ call, server, inPoll: polled, rendered, at: now }) {
    if (call.mDiv !== MAIN_DIV) return; // private windows are out of scope (A6)

    const target = isDelete(safeDecodeURI(String(call.message ?? '')));
    if (target !== null) {
      report(history.deleteByMTime(roomID, target));
      view.removeByMTime(target);
      return;
    }

    const body = parseBody(String(call.message ?? ''));
    const kind = classify({ targetDiv: call.mDiv, toUser: call.mToUser, body }, lang);

    if (server) {
      /** @type {MessageRecord} */
      const record = {
        id: server.id,
        roomID,
        mTime: server.mTime,
        user: server.user,
        toUser: server.toUser,
        kind,
        ...body,
        receivedAt: nextReceivedAt(now),
      };
      // An own message's server copy confirms its echo. The engine's duplicate filter
      // usually drops that copy unrendered, so this check precedes the `rendered` one.
      const pending = findPending(record, pendings, now);
      if (pending) {
        pendings = pendings.filter((p) => p !== pending);
        const confirmed = { ...record, receivedAt: pending.receivedAt };
        report(history.confirmPending(pending.id, confirmed));
        view.confirm(pending.id, confirmed);
        return;
      }
      if (!rendered || replayedIds.has(record.id)) return;
      report(history.put(record));
      view.append(record);
      emit(record);
      return;
    }

    if (!rendered) return;

    if (polled && call.mTime !== '') view.notice(UNPAIRED_NOTICE);

    const ownEcho = call.mTime === '' && call.mUser !== '' && call.mUser === win.userName;
    if (ownEcho) {
      const receivedAt = nextReceivedAt(now);
      /** @type {MessageRecord} */
      const record = {
        id: provisionalId(receivedAt, seq++),
        roomID,
        mTime: '',
        user: call.mUser,
        toUser: kind === 'whisper' ? whisperTarget(body.text) : '',
        kind,
        ...body,
        receivedAt,
        confirm: 'pending',
      };
      pendings.push(record);
      report(history.addPending(record));
      view.append(record);
      emit(record);
      expireLater(record, PENDING_TTL_MS + 1);
      return;
    }

    // Engine-local notices (welcome, the entry pseudo-message, AdBot) have no server id:
    // shown live, never stored (A7).
    view.append({
      id: null,
      roomID,
      mTime: '',
      user: call.mUser,
      toUser: call.mToUser,
      kind,
      ...body,
      receivedAt: now,
    });
  }

  return {
    attach(deps) {
      if (abandoned || !buffered) return;
      ({ history, view } = deps);
      replayedIds = new Set((deps.replayed ?? []).map((r) => r.id));
      // Pending own messages left by the previous page: a server copy still confirms them,
      // and each timer runs out the wait it had left.
      const now = Date.now();
      for (const record of deps.pending ?? []) {
        pendings.push(record);
        expireLater(record, PENDING_TTL_MS + 1 - (now - record.receivedAt));
      }
      const queued = buffered;
      buffered = null;
      for (const observed of queued) safeObserve(observed);
    },
    abandon() {
      abandoned = true;
      buffered = null;
      pendings = [];
    },
  };
}
