// Re-post (TDF-0038, TDF-0043): a gallery tile action that puts its image in the chat input box
// as the waiting attachment (composer/api.js stageAttachment), the same thumbnail a dropped file
// gets, and closes the flyout. Nothing is uploaded at the click: the member posts it with Enter or
// Send, where the composer applies the whisper rule, and can add text or drop it with ×. The
// source is the stored original when one was kept, else the share fetched again. Before the
// hand-off, the hash of the exact bytes sent is registered in the Re-post ledger (reposted.js)
// with the tile's id, whatever the upload route, so capture recognises the share it produces and
// does not store the image again (TDF-0063); a refused hand-off withdraws it, and so does the
// composer's discard signal when the waiting attachment is removed with × or replaced unposted.
// One left waiting in the box stays registered until it is posted or dropped. A hash failure is
// reported and the Re-post goes ahead unregistered. Every I/O is injected; start.js wires the
// real ones.

import { baseType } from './reencode.js';

/** @typedef {import('./reposted.js').RepostLedger} RepostLedger */

/** Shown as the button's title, and the reason Re-post is disabled, on a tile with nothing to send. */
export const POST_UNAVAILABLE = 'Image unavailable from server';

/**
 * The fields of a gallery record (store.js ImageRecord) Re-post reads.
 * @typedef {object} RepostItem
 * @property {string} id
 * @property {string} contentType
 * @property {Blob} [blob]
 * @property {boolean} broken
 */

/**
 * @typedef {object} RepostDeps
 * @property {(file: File, onDiscard: () => void) => string | null} stage  composer/api.js stageAttachment: a refusal reason, or null when staged; onDiscard runs if the staged file is removed or replaced unposted
 * @property {(id: string) => Promise<{ blob: Blob, contentType: string }>} fetchShare
 * @property {(item: RepostItem) => boolean} isUnavailable  open.js isUnavailable
 * @property {() => void} closeGallery  closes the gallery flyout, moving no focus
 * @property {() => unknown} galleryView  the open flyout's render, or null while closed: changed across the fetch, the flyout closed
 * @property {(blob: Blob) => Promise<string>} hash  hash.js sha256Hex: the content hash capture computes
 * @property {RepostLedger} ledger  shared with capture.js, which takes what is registered here
 * @property {(err: unknown) => void} report
 */

/**
 * @typedef {object} RepostAction
 * @property {string} id
 * @property {string} label  rendered as the button's text (no icon), title and accessible name
 * @property {(item: RepostItem) => string | null} disabled
 * @property {(item: RepostItem) => Promise<void>} onSelect
 */

/**
 * The file extension for a MIME type: its subtype, `jpg` for JPEG, without a `+xml` suffix.
 * @param {string} type
 * @returns {string}
 */
export function extensionFor(type) {
  const base = baseType(type);
  const match = /^[a-z]+\/([a-z0-9.-]+)/.exec(base);
  if (!match) return 'bin';
  const sub = match[1];
  return sub === 'jpeg' ? 'jpg' : sub;
}

/**
 * @param {RepostDeps} deps
 * @returns {RepostAction}
 */
export function createRepostAction({ stage, fetchShare, isUnavailable, closeGallery, galleryView, hash, ledger, report }) {
  return {
    id: 'post',
    label: 'Re-post',
    disabled: (item) => (isUnavailable(item) ? POST_UNAVAILABLE : null),
    onSelect: async (item) => {
      if (isUnavailable(item)) throw new Error(`gallery: ${POST_UNAVAILABLE.toLowerCase()}`);
      const view = galleryView();
      const source = item.blob ? { blob: item.blob, contentType: item.contentType } : await fetchShare(item.id);
      const type = source.blob.type || source.contentType;
      const file = new File([source.blob], `${item.id}.${extensionFor(type)}`, { type: baseType(type) });
      /** @type {string | null} */
      let sent = null;
      try {
        sent = await hash(file);
      } catch (err) {
        // Never blocks the Re-post: unregistered, its share is captured as any own share is.
        report(new Error(`gallery: re-post of image ${item.id} not registered: ${err instanceof Error ? err.message : String(err)}`));
      }
      // Closed during the fetch: staging now would replace the box's attachment and take focus.
      // Checked after hashing, so nothing is registered for a Re-post that is not handed off.
      if (galleryView() !== view) return;
      if (sent !== null) ledger.register(sent, item.id);
      // A refusal marks the button failed with the reason (view.js) and leaves the flyout open.
      const reason = stage(file, () => {
        // Removed with its × or replaced in the box, never posted: no share will come to take it.
        if (sent !== null) ledger.take(sent);
      });
      if (reason) {
        if (sent !== null) ledger.take(sent);
        throw new Error(reason);
      }
      // The box already holds focus (attach.js); closing moves none.
      closeGallery();
    },
  };
}
