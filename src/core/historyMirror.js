// A synchronous copy of whether Chat history is off (TDF-0054). The setting itself lives in the
// async IndexedDB settings store, which the engine hook cannot read while the engine is already
// rendering the page load's first polls. bootstrap.js writes this mirror on every start and on
// every live change of `historyCount`; the hook reads it until it is attached. It is a cache:
// IndexedDB stays the source of truth, and a mirror that is missing or unreadable reads as on,
// which leaves the chat as it was before this mirror existed. This module is the one reader
// and writer of the key.

/** The localStorage key; `'1'` means history is off, absent means on. */
export const HISTORY_OFF_KEY = 'tdfChat2.historyOff';

/**
 * Whether Chat history was off as last recorded. Read afresh on every call, so a change
 * recorded on this page is seen at once. Storage that is missing or throws reads as on.
 * @param {Window} win
 * @returns {boolean}
 */
export function historyOffNow(win) {
  try {
    return win.localStorage?.getItem(HISTORY_OFF_KEY) === '1';
  } catch {
    // Expected where the browser blocks site data: setHistoryOff cannot have written there.
    return false;
  }
}

/**
 * Record Chat history as off or on. Throws when storage is missing or refuses the write; the
 * caller may ignore that, since the mirror is only a cache.
 * @param {Window} win
 * @param {boolean} off
 */
export function setHistoryOff(win, off) {
  const storage = win.localStorage;
  if (!storage) throw new Error('browser storage is unavailable');
  if (off) storage.setItem(HISTORY_OFF_KEY, '1');
  else storage.removeItem(HISTORY_OFF_KEY);
}
