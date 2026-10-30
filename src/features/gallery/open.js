// Open (TDF-0023, reversing A4): a tile click shows the full image in a new tab. The stored
// original when Store images offline kept one, else the share's own URL, which needs no fetch.
// Synchronous, so `win.open` runs inside the click and the browser does not block the tab.
// A broken record with no stored original has nothing to open; saving is done from the tab.

import { shareUrl } from './shareParse.js';

/** How long a stored original's object URL outlives the open, so the new tab has loaded it. */
export const REVOKE_MS = 60_000;

/** @typedef {'opened' | 'blocked' | 'unavailable'} OpenResult */

/**
 * Nothing to show: the server copy failed and no original was kept. The view fades such a
 * tile from this same predicate, so a tile cannot look unavailable and still open.
 * @param {Pick<import('./store.js').ImageRecord, 'broken' | 'blob'>} item
 * @returns {boolean}
 */
export function isUnavailable(item) {
  return item.broken && !item.blob;
}

/**
 * @param {import('./store.js').ImageRecord} item
 * @param {{ win: Window & typeof globalThis }} deps
 * @returns {OpenResult}
 */
export function openImage(item, { win }) {
  if (isUnavailable(item)) return 'unavailable';
  if (item.blob) {
    const url = win.URL.createObjectURL(item.blob);
    const tab = win.open(url, '_blank');
    if (!tab) {
      win.URL.revokeObjectURL(url);
      return 'blocked';
    }
    win.setTimeout(() => win.URL.revokeObjectURL(url), REVOKE_MS);
    return 'opened';
  }
  return win.open(shareUrl(item.id, win.location.href), '_blank') ? 'opened' : 'blocked';
}
