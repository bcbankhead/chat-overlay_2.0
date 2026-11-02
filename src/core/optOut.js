// Turning Chat 2.0 off (TDF-0037). The choice is read synchronously at the top of the bundle,
// ahead of the cloak, the engine hook, the database and every feature's start, so it lives in
// localStorage rather than the async IndexedDB settings store. The core and each feature entry
// check chat2Off first, after their own `__tdfChat2*` flag (build.mjs's checkEntriesGated
// fails the build on an entry that does not). Off, the only thing the script adds to the page
// is the Switch to Chat 2.0 link. This module is the one reader and writer of the key.

import { describeError } from './errors.js';
import { MAIN_DIV } from './parse.js';
import { whenDomReady } from './ready.js';

/** The localStorage key; `'1'` means off, absent means on. */
export const OFF_KEY = 'tdfChat2.off';

/** The switch link's id, which keeps it to one per page. */
export const SWITCH_ID = 'tdf-chat2-switch';

/**
 * Each window's answer, read once. The core and every feature entry ask in turn while the
 * bundle evaluates; another tab writing the key between those reads would otherwise let them
 * disagree, and a feature could start with no core under it.
 * @type {WeakMap<Window, boolean>}
 */
const decided = new WeakMap();

/**
 * Whether the user has turned Chat 2.0 off, as first read on this page. Storage that is
 * missing or throws (blocked site data, a sandboxed frame) reads as on, so a failure can only
 * leave the overlay as it was.
 * @param {Window} win
 * @returns {boolean}
 */
export function chat2Off(win) {
  const known = decided.get(win);
  if (known !== undefined) return known;
  const off = readOff(win);
  decided.set(win, off);
  return off;
}

/**
 * @param {Window} win
 * @returns {boolean}
 */
function readOff(win) {
  try {
    return win.localStorage?.getItem(OFF_KEY) === '1';
  } catch {
    // Expected where the browser blocks site data, and harmless: setChat2Off fails there too,
    // and reports it, so 2.0 cannot have been turned off on this storage.
    return false;
  }
}

/**
 * Record Chat 2.0 as off or on. Throws when storage is missing or refuses the write, for the
 * caller to report rather than reload into the same state.
 * @param {Window} win
 * @param {boolean} off
 */
export function setChat2Off(win, off) {
  const storage = win.localStorage;
  if (!storage) throw new Error('browser storage is unavailable');
  if (off) storage.setItem(OFF_KEY, '1');
  else storage.removeItem(OFF_KEY);
  decided.set(win, off);
}

/**
 * Add the Switch to Chat 2.0 link to the original chat, once the markup is parsed. Only a page
 * with the chat gets it, and only one per page. Clicking it records 2.0 as on and reloads; a
 * failed write says so on the link instead of reloading into the original chat again.
 * @param {Document} doc
 * @param {Window} win
 */
export function installSwitchLink(doc, win) {
  whenDomReady(doc, () => {
    if (!doc.getElementById(MAIN_DIV) || doc.getElementById(SWITCH_ID)) return;
    const link = doc.createElement('a');
    link.id = SWITCH_ID;
    link.href = '#';
    link.textContent = 'Switch to Chat 2.0';
    link.title = 'Turn TDF Chat 2.0 back on and reload';
    link.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:2147483647;padding:4px 10px;border-radius:999px;' +
      'font:12px system-ui,sans-serif;color:#fff;background:#0969da;text-decoration:none;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        setChat2Off(win, false);
      } catch (err) {
        link.textContent = `Could not switch: ${describeError(err)}`;
        return;
      }
      win.location.reload();
    });
    doc.body.appendChild(link);
  });
}
