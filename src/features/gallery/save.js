// Save (Locked decision): the stored Blob, else a fresh same-origin fetch of the share; the
// save dialog through showSaveFilePicker where the browser has it, else an `<a download>`.
// A failed fetch marks the image broken and opens no dialog.

import { buildFilename, extFromType, shareUrl } from './shareParse.js';

/**
 * @typedef {object} SaveDeps
 * @property {import('./store.js').ImageStore} store
 * @property {Window & typeof globalThis} win
 * @property {Document} doc
 * @property {typeof globalThis.fetch} fetch
 */

/**
 * @param {import('./store.js').ImageRecord} item
 * @param {SaveDeps} deps
 * @returns {Promise<'saved' | 'broken' | 'cancelled'>}
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
      const res = await fetch(shareUrl(item.id, win.location.href), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
      contentType = res.headers.get('content-type') ?? blob.type ?? contentType;
    } catch {
      await store.markBroken(item.id);
      return 'broken';
    }
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
      // The user closed the dialog: nothing failed.
      if (/** @type {{ name?: string }} */ (err)?.name === 'AbortError') return 'cancelled';
      throw err;
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
