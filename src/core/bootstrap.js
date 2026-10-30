// Entry point. The double-load guard is the first statement (TDF-0009 Shared Contract): a
// second copy — userscript plus site include — sets up nothing. Features open their own
// database connections, wrap engine globals and write the DOM themselves, so each guards
// itself with its own `__tdfChat2*` flag; build.mjs's checkSecondCopyInert verifies that a
// second copy touches nothing past those flags.

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
import { createView } from './view.js';

if (!(/** @type {any} */ (window).__tdfChat2Loaded)) {
  /** @type {any} */ (window).__tdfChat2Loaded = true;
  start().catch((err) => startFailed(describeError(err)));
}

async function start() {
  const win = /** @type {any} */ (window);
  const container = document.getElementById(MAIN_DIV);
  // Pages under the @match without a chat (login, transcripts) are expected: nothing to do.
  if (!container) return;
  const roomID = String(win.roomID ?? '');

  // The hook installs before the first await: what the engine renders during startup is
  // buffered and flushed after the replay, in order, rather than lost under the overlay.
  const hook = installEngineHook({ win, roomID });
  if (!hook) {
    startFailed('the chat engine was not recognised');
    return;
  }
  const visibility = container.style.visibility;
  const html = document.documentElement;
  /** @type {import('./theme.js').Theme | null} */
  let theme = null;
  /** @type {Array<() => void>} */
  const unsubscribe = [];
  try {
    const db = await openDb();
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

    const view = createView({ doc: document, win, container, css });
    unsubscribe.push(
      onDeleted((ids) => view.removeById(ids)),
      onClearView(() => view.clear()),
    );
    replay(view, records);
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
  const banner = document.createElement('div');
  banner.setAttribute('role', 'status');
  banner.textContent = `TDF Chat 2.0 did not start (${reason}); showing the original chat.`;
  banner.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483647;max-width:360px;padding:6px 10px;' +
    'font:12px system-ui,sans-serif;color:#1f2328;background:#fff8c5;' +
    'border-left:3px solid #d1242f;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer';
  banner.title = 'Click to dismiss';
  banner.addEventListener('click', () => banner.remove());
  document.body.appendChild(banner);
}
