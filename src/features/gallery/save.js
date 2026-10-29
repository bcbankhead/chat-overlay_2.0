// Save (Locked decision): the stored Blob, else a fresh fetch of the share (fetchShare); the
// save dialog through showSaveFilePicker where the browser has it, else an `<a download>`.
// A failed fetch marks the image broken, opens no dialog, and rejects with its reason; a
// fetch that succeeds clears an earlier broken state.

import { fetchShare } from './fetchShare.js';
import { buildFilename, extFromType } from './shareParse.js';

/**
 * @typedef {object} SaveDeps
 * @property {import('./store.js').ImageStore} store
 * @property {Window & typeof globalThis} win
 * @property {Document} doc
 * @property {typeof globalThis.fetch} fetch
 */

/** The picker needs a fresh click; after a slow fetch the browser refuses it with these. */
const ACTIVATION_LOST = new Set(['SecurityError', 'NotAllowedError']);

/**
 * @param {import('./store.js').ImageRecord} item
 * @param {SaveDeps} deps
 * @returns {Promise<'saved' | 'cancelled'>}
 */
export async function saveImage(item, { store, win, doc, fetch }) {
  /** @type {Blob} */
  let blob;
  let contentType = item.contentType;
  if (item.blob) {
    blob = item.blob;
    contentType ||= blob.type;
  } else {
    try {
      ({ blob, contentType } = await fetchShare(item.id, { base: win.location.href, fetch }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await store.markBroken(item.id, reason);
      throw new Error(`gallery: could not save image ${item.id}: ${reason}`);
    }
    if (item.broken) await store.repair(item.id);
  }
  const suggestedName = buildFilename({
    sender: item.user,
    mTime: item.mTime,
    receivedAt: item.receivedAt,
    id: item.id,
    contentType,
  });

  const picker = /** @type {any} */ (win).showSaveFilePicker;
  if (typeof picker === 'function') {
    const ext = extFromType(contentType);
    const type = String(contentType).split(';')[0].trim();
    try {
      const handle = await picker.call(win, {
        suggestedName,
        ...(ext !== 'bin' && type ? { types: [{ description: 'Image', accept: { [type]: [`.${ext}`] } }] } : {}),
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      const name = /** @type {{ name?: string }} */ (err)?.name;
      // The user closed the dialog: nothing failed.
      if (name === 'AbortError') return 'cancelled';
      // Refused for want of a fresh click: the download below needs none.
      if (!name || !ACTIVATION_LOST.has(name)) throw err;
    }
  }

  const url = win.URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60_000);
  return 'saved';
}
