// Entry point. The double-load guard is the first statement (TDF-0009 Shared Contract): a
// second copy â€” userscript plus site include â€” sets up nothing. Features open their own
// database connections, wrap engine globals and write the DOM themselves, so each guards
// itself with its own `__tdfChat2*` flag; build.mjs's checkSecondCopyInert verifies that a
// second copy touches nothing past those flags. The flag is set at once, but the start waits
// for the chat markup (ready.js): the site include may run from <head>, before the body is
// parsed. Placed there, the body is cloaked until the page is laid out and the core and every
// feature have reported ready (reveal.js), then fades in (cloak.js). Turned off by the user
// (optOut.js, TDF-0037), the script only adds the Switch to Chat 2.0 link: no cloak, no engine
// hook, no database; the flag is set first, so a second copy adds no second link.

import { createAvatarResolver } from './avatarResolver.js';
import { createBlockState } from './blockState.js';
import { CLOAK_MS, cloak } from './cloak.js';
import { openDb } from './db.js';
import { installEngineHook, presenceLineKind } from './engine-hook.js';
import { describeError } from './errors.js';
import { emitConfirmChange, onClearView, onDeleted } from './events.js';
import { createHistory } from './history.js';
import { createHistoryDelete } from './historyDelete.js';
import { setHistoryOff } from './historyMirror.js';
import { MAIN_DIV } from './parse.js';
import { parseHistoryCount } from './retention.js';
import { chat2Off, installSwitchLink } from './optOut.js';
import { createSeenUsers } from './seenUsers.js';
import { parseHidden } from './hiddenSenders.js';
import { createSettings, onSettingChange } from './settings.js';
import { mount, unmount } from './shell.js';
import { FADE_CLASS, createTheme } from './theme.js';
import css from './theme.css';
import { whenDomReady } from './ready.js';
import { expectReady, pendingNames, whenAllReady } from './reveal.js';
import { createView } from './view.js';

if (!(/** @type {any} */ (window).__tdfChat2Loaded)) {
  /** @type {any} */ (window).__tdfChat2Loaded = true;
  if (chat2Off(window)) installSwitchLink(document, window);
  else startOverlay();
}

/** The overlay's start: the cloak while loading, then the core once the markup is parsed. */
function startOverlay() {
  // Registered before any feature's entry runs, so the gate cannot open before the core does.
  const coreReady = expectReady('core');
  // A tag just before </body> also runs while loading, but the chat has painted by then.
  const cloaked = document.readyState === 'loading' && !document.body;
  // Cloaked only while loading, so window load is always still to come.
  let loaded = false;
  const lift = cloaked
    ? cloak(document, window, CLOAK_MS, () => {
        const waiting = [...pendingNames(), ...(loaded ? [] : ['window load'])];
        console.warn(`TDF Chat 2.0: still starting after ${CLOAK_MS / 1000} s (waiting on ${waiting.join(', ')}); showing the page.`);
      })
    : () => {};
  if (cloaked) revealWhenSettled();
  whenDomReady(document, () => {
    start(lift, coreReady).catch((err) => {
      lift();
      coreReady();
      startFailed(describeError(err));
    });
  });

  /**
   * Fade the page in once every participant is ready and the engine has laid it out: its
   * window.onload runs initAll, whose resizeDivs sizes the chat's containers. The tick after
   * `load` lets an onload handler assigned after this listener run first.
   */
  function revealWhenSettled() {
    let ready = false;
    const settled = () => {
      if (ready && loaded) window.setTimeout(lift, 0);
    };
    whenAllReady(() => {
      ready = true;
      settled();
    });
    window.addEventListener(
      'load',
      () => {
        loaded = true;
        settled();
      },
      { once: true },
    );
  }
}

/**
 * @param {() => void} lift  reveals the page at once; called on every way out that leaves the
 *   original chat showing
 * @param {() => void} coreReady  reports the core ready to the reveal gate
 */
async function start(lift, coreReady) {
  const win = /** @type {any} */ (window);
  const container = document.getElementById(MAIN_DIV);
  // Pages under the @match without a chat (login, transcripts) are expected: nothing to do.
  if (!container) {
    lift();
    return;
  }
  const roomID = String(win.roomID ?? '');

  // The hook installs before the first await: what the engine renders during startup is
  // buffered and flushed after the replay, in order, rather than lost under the overlay.
  const hook = installEngineHook({ win, roomID });
  if (!hook) {
    lift();
    startFailed('the chat engine was not recognised');
    return;
  }
  const visibility = container.style.visibility;
  const html = document.documentElement;
  /** @type {import('./theme.js').Theme | null} */
  let theme = null;
  /** @type {import('./view.js').View | null} */
  let shown = null;
  /** @type {Array<() => void>} */
  const unsubscribe = [];
  try {
    // Before the view mounts, a closed connection fails the start, and the banner says so.
    // An open blocked by an older build's tab waits for it to close. Meanwhile the original
    // chat shows, with a banner saying why, and the overlay mounts once the open goes through.
    /** @type {HTMLElement | null} */
    let waiting = null;
    /** @type {IDBDatabase} */
    let db;
    try {
      db = await openDb({
        onVersionChange: () => shown?.notice('TDF Chat was updated in another tab; reload this tab to keep saving history.'),
        onBlocked: () => {
          lift();
          waiting = banner('TDF Chat 2.0 is waiting for another TDF Chat tab to close.');
        },
      });
    } finally {
      /** @type {HTMLElement | null} */ (waiting)?.remove();
    }
    const history = createHistory(db);
    const settings = createSettings(db);
    theme = createTheme({ win, settings, root: html });
    await theme.load();
    mount(theme);
    // Chat buffer (last HISTORY_ON, TDF-0033.5, TDF-0084): a stored Chat history (days) value is retired
    // first, so this read sees its migrated count. Off keeps nothing: the hook stores nothing,
    // and the replay shows nothing left from before it was turned off. Followed live, as
    // Settings writes it.
    await settings.migrateHistory();
    let historyCount = await settings.get('historyCount');
    // The engine hook reads this synchronous copy while the next load's first polls arrive,
    // before IndexedDB can answer (TDF-0054). A failed write is not worth failing the start over:
    // it is said once the view is up.
    const mirrorWriteFailed = mirrorHistoryOff(win, historyCount);
    const mirrorFailed = mirrorWriteFailed === null ? null : mirrorFailedNotice(historyCount, mirrorWriteFailed);
    unsubscribe.push(
      onSettingChange((key, value) => {
        if (key !== 'historyCount') return;
        historyCount = parseHistoryCount(value);
        const failed = mirrorHistoryOff(win, historyCount);
        if (failed !== null) shown?.notice(mirrorFailedNotice(historyCount, failed));
      }),
    );
    // Entry and exit lines stored by earlier loads are never replayed: the chat shows only this
    // session's (TDF-0066). They count toward neither the stored nor the replayed lines.
    const presenceLang = { publicEntry: String(win.publicEntry ?? ''), publicExit: String(win.publicExit ?? '') };
    /** @param {import('./history.js').MessageRecord} r */
    const replayable = (r) => presenceLineKind(r.kind, r.text, presenceLang) === null;
    // Storage keeps each room's newest STORAGE_LINES lines, none with Chat buffer off (TDF-0057, TDF-0084),
    // bounded here before replay reads, so replay and storage agree when it does: nothing it shows
    // is deleted by the bound. Nothing has mounted yet, so a failure is said once the view is up
    // rather than failing the start.
    /** @type {string | null} */
    let pruneFailed = null;
    await createHistoryDelete(db)
      .pruneHistory(historyCount, replayable)
      .catch((err) => {
        pruneFailed = describeError(err);
      });
    const { expired, pending } = await history.expirePending(roomID);
    // Replay shows the newest historyCount lines; the view keeps at most LIVE_CEILING either way.
    const records = historyCount === 0 ? [] : await history.recent(roomID, historyCount, replayable);

    // Published for the rail and the profile flyout, which show the same avatars.
    const avatars = createAvatarResolver({ win, db });
    win.__tdfChat2Avatars = avatars;
    // Published for the rail: who has been seen online, so a Recently online row can open the
    // profile after a reload (TDF-0075). It loads itself and tells the rail when it has.
    // A failed read or write is not worth failing the start over: under profileRef 2 those rows
    // open the profile by name when the engine has a profileUrl, else View Profile is disabled
    // (TDF-0078), and a notice says why (the view shows each distinct text once). One raised
    // before the view exists is held until it does.
    /** @type {import('./view.js').View | null} */
    let seenView = null;
    /** @type {string[]} */
    const seenHeld = [];
    win.__tdfChat2Seen = createSeenUsers({
      db,
      report: (err) => {
        console.error('Seen users:', err);
        const text = `Recently online profiles storage failed: ${describeError(err)}`;
        if (seenView) seenView.notice(text);
        else seenHeld.push(text);
      },
    });
    // Each server-history block's collapsed state (TDF-0033.2), read once; a block's first state
    // and each toggle update the loaded copy and store it, except with Chat history off, when
    // the block's records are not stored.
    const blockState = createBlockState(db);
    // A failed read is not worth failing the start over: blocks arrive in the setting's state,
    // and say why.
    /** @type {string | null} */
    let blockStatesFailed = null;
    /** @type {import('./blockState.js').BlockStates} */
    const blockStates = await blockState.load().catch((err) => {
      blockStatesFailed = describeError(err);
      return {};
    });
    /** @type {import('./view.js').View | null} */
    let blockView = null;
    /** @param {string} id @param {boolean} collapsed */
    const storeBlock = (id, collapsed) => {
      blockStates[id] = collapsed;
      if (historyCount === 0) return;
      blockState
        .set(id, collapsed)
        .catch((err) => blockView?.notice(`Server history block state not saved: ${describeError(err)}`));
    };
    /** @type {import('./view.js').BlockStates} */
    const blocks = {
      collapsed: (id) => blockStates[id],
      toggle: storeBlock,
      // A block's first state is stored too, so a later change of the setting does not flip it
      // (TDF-0033.3); not after a failed block-state read, where it would overwrite a state never
      // read, nor after a failed read of the setting, whose fallback is no member's choice.
      settle: (id, collapsed) => {
        if (blockStatesFailed === null && autoCollapseFailed === null) storeBlock(id, collapsed);
      },
    };
    // Whether a block with no stored state arrives collapsed (TDF-0033.3), followed live; every
    // tick collapses the blocks now open, and unticking leaves every block as it is.
    // A failed read is not worth failing the start over either: blocks arrive expanded, and say why.
    /** @type {string | null} */
    let autoCollapseFailed = null;
    let autoCollapse = await settings.get('autoCollapseServerHistory').then(
      (value) => value === true,
      (err) => {
        autoCollapseFailed = describeError(err);
        return false;
      },
    );
    unsubscribe.push(
      onSettingChange((key, value) => {
        if (key !== 'autoCollapseServerHistory') return;
        autoCollapse = value === true;
        if (autoCollapse) blockView?.collapseAll();
      }),
    );
    // The senders hidden by Settings' Hide messages by user (TDF-0082), followed live; each
    // change hides or shows their rows already on screen. A failed read hides nothing, and says why.
    /** @type {string | null} */
    let hiddenFailed = null;
    let hidden = new Set(
      await settings.get('hiddenSenders').then(parseHidden, (err) => {
        hiddenFailed = describeError(err);
        return [];
      }),
    );
    unsubscribe.push(
      onSettingChange((key, value) => {
        if (key !== 'hiddenSenders') return;
        hidden = new Set(parseHidden(value));
        blockView?.setHidden(hidden);
      }),
    );
    const view = createView({
      doc: document,
      win,
      container,
      css,
      avatars,
      blocks,
      autoCollapse: () => autoCollapse,
      hidden: () => hidden,
    });
    blockView = view;
    if (autoCollapseFailed !== null) {
      view.notice(`Collapse server history automatically not read; blocks arrive expanded (${autoCollapseFailed})`);
    }
    if (hiddenFailed !== null) view.notice(`Hidden senders not read; every sender is shown (${hiddenFailed})`);
    if (mirrorFailed !== null) view.notice(mirrorFailed);
    if (pruneFailed !== null) view.notice(`Stored chat history not trimmed on load (${pruneFailed})`);
    if (blockStatesFailed !== null) {
      const shownAs = autoCollapse ? 'collapsed' : 'expanded';
      view.notice(`Server history blocks shown ${shownAs}: their state was not read (${blockStatesFailed})`);
    }
    seenView = view;
    for (const text of seenHeld.splice(0)) view.notice(text);
    unsubscribe.push(
      onDeleted((ids) => view.removeById(ids)),
      onClearView(() => view.clear()),
    );
    replay(view, records);
    shown = view;
    coreReady();
    hook.attach({ history, view, pending, replayed: records, storing: () => historyCount !== 0 });
    // Expired with no inbound event; a feature that read the room before the expiry follows it.
    if (expired.length) {
      try {
        emitConfirmChange({ roomID, ids: expired, confirm: 'unconfirmed' });
      } catch (err) {
        view.notice(`A chat feature failed: ${describeError(err)}`);
      }
    }
  } catch (err) {
    // Undo whatever had mounted, so the banner's "showing the original chat" holds.
    for (const off of unsubscribe) off();
    hook.abandon();
    delete win.__tdfChat2Avatars;
    delete win.__tdfChat2Seen;
    unmount();
    theme?.stop();
    delete html.dataset.tdfTheme;
    html.classList.remove(FADE_CLASS);
    document.getElementById('tdf-chat')?.remove();
    document.getElementById('tdf-chat-style')?.remove();
    container.style.visibility = visibility;
    throw err;
  }
}

/**
 * Record whether Chat history is off in its synchronous mirror. Storage that is missing or that
 * the browser blocks is passed over; any other failed write is returned, for a notice.
 * @param {Window} win
 * @param {number} historyCount
 * @returns {string | null}  why the mirror was not written, or null when there is nothing to say
 */
function mirrorHistoryOff(win, historyCount) {
  try {
    // Missing storage (a sandboxed frame) is expected and harmless, as is the SecurityError the
    // browser throws for blocked site data below: the hook's read fails there too and reads
    // history as on, as before the mirror existed, and IndexedDB still holds the setting.
    if (!win.localStorage) return null;
    setHistoryOff(win, historyCount === 0);
    return null;
  } catch (err) {
    // Duck-typed, not `instanceof`: the DOMException can come from another realm.
    if (/** @type {{ name?: unknown } | null} */ (err)?.name === 'SecurityError') return null;
    return describeError(err);
  }
}

/**
 * The notice for a mirror write that failed: the next load reads whatever the mirror last held.
 * @param {number} historyCount
 * @param {string} reason
 */
const mirrorFailedNotice = (historyCount, reason) =>
  `Chat history ${historyCount === 0 ? 'off' : 'on'} not recorded for the next page load, which may ` +
  `${historyCount === 0 ? 'show' : 'hide'} messages sent before it loads (${reason})`;

/**
 * Replay stored records. A record that will not render is skipped with a notice, rather
 * than failing the start once the view has mounted.
 * @param {import('./view.js').View} view
 * @param {import('./history.js').MessageRecord[]} records
 */
function replay(view, records) {
  try {
    view.replay(records);
    return;
  } catch {
    // Fall back to one record at a time to find the ones that fail.
  }
  let failed = 0;
  let reason = '';
  for (const record of records) {
    try {
      view.replay([record]);
    } catch (err) {
      if (!failed) reason = describeError(err);
      failed += 1;
    }
  }
  if (failed) view.notice(`${failed} stored message${failed === 1 ? '' : 's'} could not be shown: ${reason}`);
}

/**
 * Tell the user the overlay is off and why; the original chat stays in place.
 * @param {string} reason
 */
function startFailed(reason) {
  banner(`TDF Chat 2.0 did not start (${reason}); showing the original chat.`);
}

/**
 * A dismissable status line in the page's corner, outside the overlay.
 * @param {string} text
 * @returns {HTMLElement}
 */
function banner(text) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483647;max-width:360px;padding:6px 10px;' +
    'font:12px system-ui,sans-serif;color:#1f2328;background:#fff8c5;' +
    'border-left:3px solid #d1242f;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer';
  el.title = 'Click to dismiss';
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  return el;
}
