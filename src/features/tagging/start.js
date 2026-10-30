// Image reactions' wiring, apart from index.js's double-load guard so a test can drive it.
// The subscriptions to core's announcements start at once, so none is missed while the
// database opens; the store holds what arrives until its first rebuild. Core announces a
// pending message going unconfirmed (a failed reaction's echo, bootstrap's expiry) and stored
// messages deleted, so the store never re-derives from a stale snapshot.

import { openDb } from '../../core/db.js';
import { describeError } from '../../core/errors.js';
import { onConfirmChange, onDeleted, onInbound } from '../../core/events.js';
import { createHistory } from '../../core/history.js';
import { createSettings, DEFAULTS } from '../../core/settings.js';
import { engineSend, resetRepeat } from './engineSend.js';
import { createReactionQueue } from './queue.js';
import { toHexColor } from './reactions.js';
import { createTagStore } from './store.js';
import { installReactionUi } from './ui.js';

/**
 * The colour a like's token is hidden in when the native chat's own background cannot be
 * read: the forum's default chat background (TDF-0011). Provisional until measured live.
 */
export const FALLBACK_TOKEN_BG = '#ffffff';

/** The view's stylesheet (view.js), whose theme.css overrides `.body`'s background. */
const THEME_STYLE = 'tdf-chat-style';

/**
 * The native chat's background as `#rrggbb`, read now: `#chatContainer`'s computed
 * background, else its nearest opaque ancestor's, `.body`'s included until the view's
 * theme.css overrides it (then the walk stops short of `.body`); else the fallback, told to
 * `onFallback` with why.
 * @param {Document} doc
 * @param {any} win
 * @param {(reason: string) => void} [onFallback]
 * @returns {string}
 */
export function nativeChatBackground(doc, win, onFallback) {
  const chat = doc.getElementById('chatContainer');
  const themed = doc.getElementById(THEME_STYLE) !== null;
  for (let el = chat; el && el !== doc.documentElement; el = el.parentElement) {
    if (themed && el.classList.contains('body')) break;
    const hex = toHexColor(win.getComputedStyle(el).backgroundColor);
    if (hex) return hex;
  }
  onFallback?.(
    !chat
      ? 'the native chat (#chatContainer) is missing'
      : themed
        ? 'the chat background is transparent up to .body'
        : 'the chat background is transparent',
  );
  return FALLBACK_TOKEN_BG;
}

/**
 * Failures, shown in the message list once per distinct text as the view shows its own
 * problems, and logged. One that comes before the view mounts is held until the list appears.
 * @param {Document} doc
 * @param {any} win
 * @returns {(err: unknown) => void}
 */
export function reporter(doc, win) {
  /** @type {Set<string>} */
  const shown = new Set();
  /** @type {string[]} */
  const held = [];
  /** @type {MutationObserver | null} */
  let waiting = null;

  const flush = () => {
    const list = doc.querySelector('#tdf-chat .tdf-list');
    if (!list) return false;
    for (const text of held.splice(0)) {
      const el = doc.createElement('div');
      el.className = 'tdf-msg tdf-kind-system tdf-notice';
      el.setAttribute('role', 'status');
      el.textContent = text;
      list.appendChild(el);
    }
    return true;
  };

  return (err) => {
    const text = `Image reactions: ${describeError(err)}`;
    console.error(text);
    if (shown.has(text)) return;
    shown.add(text);
    held.push(text);
    if (flush() || waiting) return;
    waiting = new win.MutationObserver(() => {
      if (flush()) {
        waiting?.disconnect();
        waiting = null;
      }
    });
    waiting?.observe(doc.documentElement, { childList: true, subtree: true });
  };
}

/**
 * @param {{
 *   win: any,
 *   doc: Document,
 *   css: string,
 *   indexedDB?: IDBFactory,
 * }} deps
 */
export function startTagging({ win, doc, css, indexedDB = win.indexedDB }) {
  const fail = reporter(doc, win);
  const roomID = String(win.roomID ?? '');
  const me = String(win.userName ?? '');
  // Read once: identical on every install (settings.js.php), so every install parses alike (B1).
  /** @type {string[]} */
  const codes = (Array.isArray(win.mySmilies) ? win.mySmilies : []).filter(
    (/** @type {unknown} */ c) => typeof c === 'string' && c !== '',
  );

  let interval = DEFAULTS.likeIntervalSeconds;
  /** @type {ReturnType<typeof createTagStore> | null} */
  let store = null;
  /** @type {Array<(s: ReturnType<typeof createTagStore>) => Promise<void>>} announcements before the store */
  const early = [];
  /**
   * Hand an announcement to the store, or hold it until the store exists.
   * @param {(s: ReturnType<typeof createTagStore>) => Promise<void>} fn
   */
  const toStore = (fn) => {
    if (store) fn(store).catch(fail);
    else early.push(fn);
  };

  // A token hidden in the provisional fallback colour may show; said once, not on every send.
  let fellBack = false;
  /** @param {string} reason */
  const onFallback = (reason) => {
    if (fellBack) return;
    fellBack = true;
    fail(`likes hide their token in ${FALLBACK_TOKEN_BG}, which may show: ${reason}`);
  };

  // Read now, before bootstrap mounts the view and its theme.css overrides `.body`'s colour.
  /** @type {string | null} */
  let startReason = null;
  const startBg = nativeChatBackground(doc, win, (reason) => {
    startReason = reason;
  });

  const queue = createReactionQueue({
    now: () => Date.now(),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (handle) => win.clearTimeout(handle),
    send: (text) => engineSend({ doc, win }, text),
    request: () => win.sendReq,
    intervalSeconds: () => interval,
    resetRepeat: (text) => resetRepeat(win, text),
    tokenColor: () => (startReason === null ? startBg : nativeChatBackground(doc, win, onFallback)),
  });

  onInbound((record) => {
    if (record.user === me && record.roomID === roomID) queue.noteOwnMessage();
    toStore((s) => s.applyInbound(record));
  });
  onDeleted((ids) => toStore((s) => s.applyDeleted(ids)));
  onConfirmChange((change) => toStore((s) => s.applyConfirmChange(change)));

  if (!doc.getElementById('tdf-tagging-style')) {
    const style = doc.createElement('style');
    style.id = 'tdf-tagging-style';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  const ready = openDb({ indexedDB }).then(async (db) => {
    interval = await createSettings(db).get('likeIntervalSeconds');
    const created = createTagStore({ db, history: createHistory(db), roomID, me, codes });
    // The store holds inbound until its first rebuild completes.
    store = created;
    for (const fn of early.splice(0)) fn(created).catch(fail);
    await created.rebuildRoom();
    installReactionUi({ doc, win, store: created, queue, codes });
  });
  ready.catch(fail);
  return ready;
}
