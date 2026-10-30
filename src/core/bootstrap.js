// Entry point. The double-load guard is the first statement (TDF-0009 Shared Contract): a
// second copy — userscript plus site include — sets up nothing. Features open their own
// database connections, wrap engine globals and write the DOM themselves, so each guards
// itself with its own `__tdfChat2*` flag; build.mjs's checkSecondCopyInert verifies that a
// second copy touches nothing past those flags. The flag is set at once, but the start waits
// for the chat markup (ready.js): the site include may run from <head>, before the body is
// parsed. Placed there, the body is cloaked until the page is laid out and the core and every
// feature have reported ready (reveal.js), then fades in (cloak.js).

import { createAvatarResolver } from './avatarResolver.js';
import { CLOAK_MS, cloak } from './cloak.js';
import { openDb } from './db.js';
import { installEngineHook } from './engine-hook.js';
import { describeError } from './errors.js';
import { emitConfirmChange, onClearView, onDeleted } from './events.js';
import { createHistory } from './history.js';
import { MAIN_DIV } from './parse.js';
import { createSettings, onSettingChange } from './settings.js';
import { mount, unmount } from './shell.js';
import { FADE_CLASS, createTheme } from './theme.js';
import css from './theme.css';
import { whenDomReady } from './ready.js';
import { expectReady, pendingNames, whenAllReady } from './reveal.js';
import { createView } from './view.js';

if (!(/** @type {any} */ (window).__tdfChat2Loaded)) {
  /** @type {any} */ (window).__tdfChat2Loaded = true;
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
    // Chat history at 0 days keeps nothing: the hook stores nothing, and the replay shows
    // nothing left from before the limit was set. Followed live, as Settings writes it.
    let retentionDays = await settings.get('retentionDays');
    unsubscribe.push(
      onSettingChange((key, value) => {
        if (key === 'retentionDays') retentionDays = /** @type {number | null} */ (value);
      }),
    );
    const { expired, pending } = await history.expirePending(roomID);
    const records = retentionDays === 0 ? [] : await history.recent(roomID);

    // Published for the rail and the profile flyout, which show the same avatars.
    const avatars = createAvatarResolver({ win, db });
    win.__tdfChat2Avatars = avatars;
    const view = createView({ doc: document, win, container, css, avatars });
    unsubscribe.push(
      onDeleted((ids) => view.removeById(ids)),
      onClearView(() => view.clear()),
    );
    replay(view, records);
    shown = view;
    coreReady();
    hook.attach({ history, view, pending, replayed: records, storing: () => retentionDays !== 0 });
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
