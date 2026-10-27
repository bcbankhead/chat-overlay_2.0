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
 * @param {{
 *   win: any,
 *   history: import('./history.js').History,
 *   view: import('./view.js').View,
 *   roomID: string,
 * }} deps
 * @returns {boolean} whether the hook was installed
 */
export function installEngineHook({ win, history, view, roomID }) {
  if (!engineAvailable(win)) return false;
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

  win.handleMessages = function (/** @type {unknown[]} */ ...args) {
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
    // Pair the call with its server record before the original runs: inside a poll the
    // engine calls createMessageDiv exactly once per usermessage, in order.
    const server = inPoll ? queue.shift() : undefined;
    const before = win.showMessages;
    const result = origCreate.apply(this, arguments);
    const rendered = win.showMessages > before;
    try {
      observe({ mDiv, message, mUser: mUser ?? '', mToUser: mToUser ?? '', mTime: mTime ?? '' }, server, rendered);
    } catch (err) {
      view.notice(`Message not recorded: ${describeError(err)}`);
    }
    return result;
  };

  /**
   * @param {{ mDiv: string, message: string, mUser: string, mToUser: string, mTime: string }} call
   * @param {ServerMessage | undefined} server
   * @param {boolean} rendered
   */
  function observe(call, server, rendered) {
    if (call.mDiv !== MAIN_DIV) return; // private windows are out of scope (A6)

    const target = isDelete(safeDecodeURI(String(call.message ?? '')));
    if (target !== null) {
      report(history.deleteByMTime(roomID, target));
      view.removeByMTime(target);
      return;
    }

    const paired =
      server && server.mTime === String(call.mTime) && server.user === call.mUser ? server : undefined;
    const now = Date.now();
    const body = parseBody(String(call.message ?? ''));
    const kind = classify({ targetDiv: call.mDiv, toUser: call.mToUser, body }, lang);

    if (paired) {
      /** @type {MessageRecord} */
      const record = {
        id: paired.id,
        roomID,
        mTime: paired.mTime,
        user: paired.user,
        toUser: paired.toUser,
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
      if (!rendered) return;
      report(history.put(record));
      view.append(record);
      emit(record);
      return;
    }

    if (!rendered) return;

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
      win.setTimeout(() => {
        if (!pendings.includes(record)) return;
        pendings = pendings.filter((p) => p !== record);
        report(history.markUnconfirmed(record.id));
        view.markUnconfirmed(record.id);
      }, PENDING_TTL_MS + 1);
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

  return true;
}
