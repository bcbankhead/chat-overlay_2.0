// Inbound hook over the engine's page globals. Wraps `handleMessages` to read each poll's
// server records (which carry the server id, field [0]) and `createMessageDiv` to learn
// whether the engine actually rendered each message, so the engine's own filters (blocked
// users, duplicates, commands, PM rules) still decide what is shown and stored. Wraps
// `sendData` to confirm each own message by its sendData.php response. With Chat history
// off nothing is written to history; messages are still shown and announced, except those the
// server sent from before the page loaded, which skip the engine entirely (TDF-0054). With it
// on, only the newest HISTORY_ON of those reach the engine (TDF-0055).

import { describeError } from './errors.js';
import { emitConfirmChange, emitDeleted, emitInbound } from './events.js';
import { nextReceivedAt } from './history.js';
import { historyOffNow } from './historyMirror.js';
import {
  MAIN_DIV,
  classify,
  isDelete,
  parseBody,
  parseUserMessage,
  safeDecodeURI,
  whisperTarget,
} from './parse.js';
import { PENDING_TTL_MS, findPending, isExpired, provisionalId } from './reconcile.js';
import { HISTORY_ON } from './retention.js';

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
 * @property {boolean} backlog the call came from the page load's history poll
 *   (`showHistory` set when the engine entered `handleMessages`)
 * @property {boolean} rendered
 * @property {number} at epoch ms of the call
 * @property {Send | null} send the main-div send the call echoes, when it followed one
 */

/**
 * @typedef {object} Send one engine sendData call to the main div
 * @property {'inflight' | 'sent' | 'failed'} state `failed` when the POST was refused or
 *   the engine dropped the send because its request was busy
 * @property {MessageRecord | null} record the own echo paired with it, once observed
 */

/**
 * @typedef {object} EngineHook
 * @property {(deps: {
 *   history: import('./history.js').History,
 *   view: import('./view.js').View,
 *   pending?: MessageRecord[],
 *   replayed?: MessageRecord[],
 *   storing?: () => boolean,
 * }) => void} attach start storing and showing: adopt the room's stored pending own
 *   messages, then flush, in order, what the engine rendered since install. `storing`, read
 *   per message, is false while Chat history is off
 * @property {() => void} abandon stop observing; the wrappers pass straight through
 */

/** How many recent server records the clock-skew estimate reads. */
const SKEW_SAMPLES = 20;

/** Whole-message moderation commands the engine acts on (message.js.php:784-817). */
const MODERATION = new Set(['SILENCE', 'KICK', 'BAN']);

/**
 * Whether createMessageDiv acts on this message as a moderation command rather than drawing it.
 * @param {string} message the message as passed to createMessageDiv
 */
const isModeration = (message) => {
  const decoded = safeDecodeURI(String(message ?? ''));
  return MODERATION.has(decoded) || isDelete(decoded) !== null;
};

const UNPAIRED_NOTICE =
  'A message was shown but not saved: no server record in its poll matched its time and sender';

/**
 * A page-load id, unique across tabs.
 * @param {any} win
 * @returns {string}
 */
function newLoadBlock(win) {
  const uuid = win.crypto?.randomUUID?.();
  return typeof uuid === 'string' ? uuid : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  /**
   * The poll's pre-load main-div records the engine may draw with Chat history on: its newest
   * HISTORY_ON, moderation commands aside (TDF-0055).
   * @type {Set<ServerMessage>}
   */
  let backlogAllowed = new Set();
  let inPoll = false;
  /** Whether the poll being handled is the page load's history poll. */
  let inHistoryPoll = false;
  /** This page load's block id: tags every record first stored from its history poll. */
  const loadBlock = newLoadBlock(win);
  let seq = 0;
  /** @type {MessageRecord[]} pending own messages awaiting their send's outcome */
  let pendings = [];
  /**
   * Own messages their send confirmed, still under their local id. The server returns an
   * own message only when it is addressed to the sender (a self-whisper); that copy
   * replaces the local record rather than duplicating it.
   * @type {MessageRecord[]}
   */
  let sentOwn = [];
  /** @type {Send | null} the send the engine's next own echo belongs to */
  let lastSend = null;
  /**
   * Recent `server mTime - local receipt` samples (ms). Each is the clock skew less that
   * message's delivery delay, so the largest is the closest estimate of the skew.
   * @type {number[]}
   */
  let skewSamples = [];
  /** @type {Observed[] | null} calls awaiting `attach`; null once attached */
  let buffered = [];
  let abandoned = false;
  /** @type {Set<string>} ids the replay already showed */
  let replayedIds = new Set();
  /** @type {import('./history.js').History} */
  let history;
  /** @type {import('./view.js').View} */
  let view;
  /** @type {() => boolean} */
  let storing = () => true;
  /** Epoch ms of install, on the device clock. */
  const installAt = Date.now();
  /**
   * Server-clock epoch seconds of install, from the first poll reply's `Date` header; null until
   * then, and for good when that reply carries none. A message whose server mTime precedes it was
   * sent before this page loaded.
   * @type {number | null}
   */
  let loadCutoff = null;
  let cutoffRead = false;
  /** @type {string[]} notices raised before `attach`, shown once it sets the view */
  let earlyNotices = [];

  /**
   * Whether a server record was sent before this page loaded, to the main div, and is not a
   * moderation command: the records the load cutoff may hold back from the engine.
   * @param {ServerMessage} server
   */
  const heldBackable = (server) =>
    server.targetDiv === MAIN_DIV &&
    loadCutoff !== null &&
    Number(server.mTime) < loadCutoff &&
    !isModeration(server.body);

  /** Whether Chat history is off: the setting once attached, its synchronous mirror before. */
  const historyOff = () => (buffered ? historyOffNow(win) : !storing());

  /**
   * Fix the load cutoff from the first poll reply that carries a usable Date header, once. A
   * header read that throws gives up for the session.
   * @param {any} req
   */
  const readCutoff = (req) => {
    let header;
    try {
      header = req.getResponseHeader?.('Date');
    } catch (err) {
      cutoffRead = true;
      throw err;
    }
    const serverMs = typeof header === 'string' ? Date.parse(header) : NaN;
    if (!Number.isFinite(serverMs)) return;
    cutoffRead = true;
    loadCutoff = Math.floor(serverMs / 1000) - Math.ceil((Date.now() - installAt) / 1000);
  };

  /**
   * A local time (ms) moved onto the server's clock, or undefined before any poll has
   * supplied a skew sample. A record without a server mTime orders by it (TDF-0032).
   * @param {number} now
   */
  const serverAt = (now) => (skewSamples.length ? now + Math.max(...skewSamples) : undefined);

  /** @param {Promise<unknown>} p */
  const report = (p) => p.catch((err) => view.notice(`Chat history not saved: ${describeError(err)}`));

  /** @param {() => void} fn a core event's emit */
  const announce = (fn) => {
    try {
      fn();
    } catch (err) {
      view.notice(`A chat feature failed: ${describeError(err)}`);
    }
  };

  /** @param {MessageRecord} record */
  const emit = (record) => announce(() => emitInbound(record));

  /**
   * Mark a pending own message unconfirmed, stored and shown, and tell features.
   * @param {MessageRecord} record
   */
  const unconfirm = (record) => {
    report(history.markUnconfirmed(record.id));
    view.markUnconfirmed(record.id);
    announce(() => emitConfirmChange({ roomID, ids: [record.id], confirm: 'unconfirmed' }));
  };

  /**
   * Run hook bookkeeping from an engine call or callback; a throw becomes a notice.
   * @template T
   * @param {string} what
   * @param {() => T} fn
   * @returns {T | undefined}
   */
  const guard = (what, fn) => {
    try {
      return fn();
    } catch (err) {
      const text = `${what}: ${describeError(err)}`;
      if (view) view.notice(text);
      else earlyNotices.push(text);
      return undefined;
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
    win.setTimeout(
      () =>
        guard('Message status not updated', () => {
          if (!pendings.includes(record)) return;
          pendings = pendings.filter((p) => p !== record);
          unconfirm(record);
        }),
      Math.max(0, delay),
    );
  };

  /**
   * Settle a pending own message by its send's outcome, unless already settled.
   * @param {MessageRecord} record
   * @param {'sent' | 'failed'} state
   */
  const resolveSend = (record, state) => {
    if (!pendings.includes(record)) return;
    pendings = pendings.filter((p) => p !== record);
    if (state === 'sent') {
      const { confirm: _drop, ...rest } = record;
      // The server never returns this message, so it orders by its receipt time moved onto
      // the server's clock, alongside the server-timed messages around it.
      /** @type {MessageRecord} */
      const orderAt = serverAt(rest.receivedAt);
      const confirmed = orderAt === undefined ? rest : { ...rest, orderAt };
      if (storing()) report(history.confirmPending(record.id, confirmed));
      view.confirm(record.id, confirmed);
      const now = Date.now();
      sentOwn = [...sentOwn.filter((r) => !isExpired(r, now)), confirmed];
    } else {
      unconfirm(record);
    }
  };

  // The server never returns a sender's own messages in a poll, so an own message is
  // confirmed by its sendData.php response. The engine's own response handler is empty, and
  // it drops a send outright while its request is busy.
  const origSend = win.sendData;
  if (typeof origSend === 'function') {
    win.sendData = function (/** @type {string} */ displayMDiv) {
      if (abandoned || displayMDiv !== MAIN_DIV) return origSend.apply(this, arguments);
      const req = win.sendReq;
      const send = guard('Message status not tracked', () => {
        const idle = Boolean(req) && (req.readyState == 4 || req.readyState == 0);
        /** @type {Send} */
        const created = { state: idle ? 'inflight' : 'failed', record: null };
        lastSend = created;
        // Only the echo the engine renders synchronously after this send belongs to it; a send
        // with no echo (room entry or exit) must not pair with a later one.
        queueMicrotask(() => {
          if (lastSend === created) lastSend = null;
        });
        return created;
      });
      const result = origSend.apply(this, arguments);
      if (send?.state === 'inflight') {
        guard('Message status not tracked', () =>
          req.addEventListener(
            'loadend',
            () =>
              guard('Message status not updated', () => {
                send.state = req.status >= 200 && req.status < 300 ? 'sent' : 'failed';
                if (send.record) resolveSend(send.record, send.state);
              }),
            { once: true },
          ),
        );
      }
      return result;
    };
  }

  win.handleMessages = function (/** @type {unknown[]} */ ...args) {
    if (abandoned) return origHandle.apply(this, args);
    const req = win.receiveMesReq;
    if (req && req.readyState == 4 && !cutoffRead) guard('Page load time not read', () => readCutoff(req));
    if (req && req.readyState == 4 && req.responseXML) {
      queue = Array.from(req.responseXML.getElementsByTagName('usermessage'), (node) =>
        parseUserMessage(/** @type {Element} */ (node).textContent ?? ''),
      );
      // Poll order is oldest first, so the newest pre-load records are the last ones. Counted
      // here, before the engine draws any of them, so a record the engine then skips still
      // takes one of the HISTORY_ON places. A throw allows the whole poll to draw.
      const polled = queue;
      backlogAllowed =
        guard('History backlog not capped, drawing every message', () => {
          const held = polled.filter(heldBackable);
          return new Set(held.slice(Math.max(0, held.length - HISTORY_ON)));
        }) ?? new Set(polled);
      inPoll = true;
      // The engine sends history=1 on the first poll only and clears the flag at the end of
      // this same call, so it is read here, on entry.
      inHistoryPoll = Boolean(win.showHistory);
    }
    try {
      return origHandle.apply(this, args);
    } finally {
      inPoll = false;
      inHistoryPoll = false;
      queue = [];
      backlogAllowed = new Set();
    }
  };
  const wrappedHandle = win.handleMessages;

  // The engine binds a poll's handler when it opens the request, so a history poll already in
  // flight at install would reach the unwrapped handler. Rebind it; one already completed is
  // missed, and that load shows no block.
  const inFlight = win.receiveMesReq;
  if (inFlight.readyState < 4 && inFlight.onreadystatechange === origHandle) inFlight.onreadystatechange = wrappedHandle;

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
    // A message the server sent from before this page loaded skips the engine: no row, no
    // sound, no image or avatar requests, and nothing stored, shown or announced. With Chat
    // history off every one does (TDF-0054); with it on, all but the poll's newest HISTORY_ON
    // (TDF-0055). Without a server Date header nothing is suppressed. Moderation commands still
    // reach the engine, which applies them, and private windows are out of scope. A setting read
    // that throws draws the message.
    if (
      server &&
      heldBackable(server) &&
      guard('History setting not read', () => historyOff() || !backlogAllowed.has(server))
    ) {
      return false;
    }
    // The engine echoes a send synchronously, right after sendData, outside any poll.
    const send = inPoll ? null : lastSend;
    if (!inPoll) lastSend = null;
    const before = win.showMessages;
    // A pre-load message that still reaches the engine (Chat history on, within HISTORY_ON) is
    // drawn silently, in whichever poll carries it: doSound is swapped for a no-op for this one
    // call, so no Audio is created and no mp3 requested, then restored even if the engine throws.
    // Own echoes and engine-local notices have no server record and keep their sounds (TDF-0051).
    // This relies on the engine calling the page global doSound by name, synchronously, inside
    // createMessageDiv (message.js.php:1144-1157); a held reference or a deferred play escapes it.
    const mute = Boolean(server && heldBackable(server)) && typeof win.doSound === 'function';
    /** @type {unknown} */
    let result;
    if (mute) {
      const doSound = win.doSound;
      win.doSound = () => {};
      try {
        result = origCreate.apply(this, arguments);
      } finally {
        win.doSound = doSound;
      }
    } else {
      result = origCreate.apply(this, arguments);
    }
    /** @type {Observed} */
    const observed = {
      call,
      server,
      inPoll,
      backlog: inPoll && inHistoryPoll,
      rendered: win.showMessages > before,
      at: Date.now(),
      send,
    };
    if (buffered) buffered.push(observed);
    else safeObserve(observed);
    return result;
  };

  /** @param {Observed} observed */
  function observe({ call, server, inPoll: polled, backlog, rendered, at: now, send }) {
    if (call.mDiv !== MAIN_DIV) return; // private windows are out of scope (A6)

    const target = isDelete(safeDecodeURI(String(call.message ?? '')));
    if (target !== null) {
      // Features learn which stored record went once the delete commits.
      report(
        history.deleteByMTime(roomID, target).then((ids) => {
          if (ids.length) announce(() => emitDeleted(ids));
        }),
      );
      view.removeByMTime(target);
      return;
    }

    const body = parseBody(String(call.message ?? ''));
    const kind = classify({ targetDiv: call.mDiv, toUser: call.mToUser, body }, lang);

    if (server) {
      const serverSeconds = Number(server.mTime);
      if (serverSeconds > 0) skewSamples = [...skewSamples.slice(1 - SKEW_SAMPLES), serverSeconds * 1000 - now];
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
        // Facts, not display: the view groups and collapses from them. Storage keeps a record
        // already stored live untagged (first seen wins).
        ...(backlog ? { source: /** @type {const} */ ('backlog'), backlogBlock: loadBlock } : {}),
      };
      // A server copy of an own message (only a self-whisper is ever delivered back) replaces
      // its local record, pending or already confirmed by its send. The engine's duplicate
      // filter may drop that copy unrendered, so this check precedes the `rendered` one.
      const pending = findPending(record, pendings, now) ?? findPending(record, sentOwn, now);
      if (pending) {
        pendings = pendings.filter((p) => p !== pending);
        sentOwn = sentOwn.filter((p) => p !== pending);
        const confirmed = { ...record, receivedAt: pending.receivedAt };
        if (storing()) report(history.confirmPending(pending.id, confirmed));
        view.confirm(pending.id, confirmed);
        return;
      }
      if (!rendered || replayedIds.has(record.id)) return;
      if (storing()) report(history.put(record));
      view.place(record);
      emit(record);
      return;
    }

    if (!rendered) return;

    if (polled && call.mTime !== '') view.notice(UNPAIRED_NOTICE);

    const ownEcho = call.mTime === '' && call.mUser !== '' && call.mUser === win.userName;
    if (ownEcho) {
      const receivedAt = nextReceivedAt(now);
      // Ordered on the server's clock from the start, so a later server message lands below it
      // in the view and in storage even with the device clock fast.
      const orderAt = serverAt(receivedAt);
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
        ...(orderAt === undefined ? {} : { orderAt }),
        confirm: 'pending',
      };
      pendings.push(record);
      if (storing()) report(history.addPending(record));
      view.append(record);
      emit(record);
      expireLater(record, PENDING_TTL_MS + 1);
      if (send) {
        send.record = record;
        if (send.state !== 'inflight') resolveSend(record, send.state);
      }
      return;
    }

    // Engine-local notices (welcome, the entry pseudo-message, AdBot) have no server id:
    // shown live, never stored (A7).
    const orderAt = serverAt(now);
    view.append({
      id: null,
      roomID,
      mTime: '',
      user: call.mUser,
      toUser: call.mToUser,
      kind,
      ...body,
      receivedAt: now,
      ...(orderAt === undefined ? {} : { orderAt }),
    });
  }

  return {
    attach(deps) {
      if (abandoned || !buffered) return;
      ({ history, view } = deps);
      if (deps.storing) storing = deps.storing;
      const notices = earlyNotices;
      earlyNotices = [];
      for (const text of notices) view.notice(text);
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
      earlyNotices = [];
      pendings = [];
      sentOwn = [];
      lastSend = null;
    },
  };
}
