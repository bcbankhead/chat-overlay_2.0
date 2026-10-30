// Open (TDF-0023, reversing A4): a tile click shows the full image in a new tab. The stored
// original when Store images offline kept one and it is a raster type, else the share's own
// URL. Synchronous, so `win.open` runs inside the click and the browser does not block the
// tab. A share URL opened this way is then probed in the background (fetchShare), and a
// failure marks the image broken. A broken record with nothing to open is retried instead:
// a probe that loads repairs it, so the next click opens it; one that fails keeps it broken
// with the new reason. Saving is done from the tab.

import { fetchShare } from './fetchShare.js';
import { shareUrl } from './shareParse.js';

/** How long a stored original's object URL outlives the open, so the new tab has loaded it. */
export const REVOKE_MS = 60_000;

/**
 * Types a stored original may open as. A `blob:` URL carries the chat page's origin, so an
 * SVG (or anything else that can run script) is never opened from one; the share URL is.
 */
export const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

/** @typedef {'opened' | 'blocked' | 'unavailable'} OpenResult */

/**
 * @typedef {object} OpenDeps
 * @property {Window & typeof globalThis} win
 * @property {import('./store.js').ImageStore | Promise<import('./store.js').ImageStore>} store
 * @property {typeof globalThis.fetch} fetch
 * @property {(err: unknown) => void} report
 */

/** @param {unknown} err */
const reasonOf = (err) => (err instanceof Error ? err.message : String(err));

/**
 * The stored original, when it may open as an object URL. Blob.type is what the tab renders
 * the URL as, so that is what is checked, not the record's contentType.
 * @param {Pick<import('./store.js').ImageRecord, 'blob'>} item
 * @returns {Blob | null}
 */
function rasterBlob(item) {
  const type = item.blob?.type.split(';')[0].trim().toLowerCase();
  return item.blob && type && RASTER_TYPES.has(type) ? item.blob : null;
}

/**
 * Nothing to show: the server copy failed and no openable original was kept. The view fades
 * such a tile from this same predicate, so a tile cannot look unavailable and still open.
 * @param {Pick<import('./store.js').ImageRecord, 'broken' | 'blob'>} item
 * @returns {boolean}
 */
export function isUnavailable(item) {
  return item.broken && !rasterBlob(item);
}

/**
 * @param {import('./store.js').ImageRecord} item
 * @param {OpenDeps} deps
 * @returns {OpenResult}
 */
export function openImage(item, { win, store, fetch, report }) {
  if (isUnavailable(item)) return 'unavailable';
  const blob = rasterBlob(item);
  if (blob) {
    const url = win.URL.createObjectURL(blob);
    const tab = win.open(url, '_blank');
    if (!tab) {
      win.URL.revokeObjectURL(url);
      return 'blocked';
    }
    tab.opener = null;
    win.setTimeout(() => win.URL.revokeObjectURL(url), REVOKE_MS);
    return 'opened';
  }
  const tab = win.open(shareUrl(item.id, win.location.href), '_blank');
  if (!tab) return 'blocked';
  tab.opener = null;
  // Not awaited: the tab is already open. Its own failure shows in the tab and, through
  // markBroken, on the tile; only a store that cannot record it is reported.
  void (async () => {
    try {
      await fetchShare(item.id, { base: win.location.href, fetch });
    } catch (err) {
      await (await store).markBroken(item.id, reasonOf(err));
    }
  })().catch(report);
  return 'opened';
}

/**
 * Probe an unavailable image's share again, for a failure that may have been transient.
 * Loading repairs the record, so the tile opens on its next click (opening here, after an
 * await, would be blocked); failing keeps it broken with the new reason, and rejects.
 * @param {import('./store.js').ImageRecord} item
 * @param {Omit<OpenDeps, 'report'>} deps
 * @returns {Promise<void>}
 */
export async function retryImage(item, { win, store, fetch }) {
  const s = await store;
  try {
    await fetchShare(item.id, { base: win.location.href, fetch });
  } catch (err) {
    const reason = reasonOf(err);
    await s.markBroken(item.id, reason);
    throw new Error(`gallery: image ${item.id} is still unavailable from server: ${reason}`);
  }
  await s.repair(item.id);
}
