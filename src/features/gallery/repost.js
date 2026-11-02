// Re-post (TDF-0038, TDF-0043): a gallery tile action that puts its image in the chat input box
// as the waiting attachment (composer/api.js stageAttachment), the same thumbnail a dropped file
// gets, and closes the flyout. Nothing is uploaded at the click: the member posts it with Enter or
// Send, where the composer applies the whisper rule, and can add text or drop it with ×. The
// source is the stored original when one was kept, else the share fetched again. Every I/O is
// injected; start.js wires the real ones.

import { baseType } from './reencode.js';

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
 * @property {(file: File) => string | null} stage  composer/api.js stageAttachment: a refusal reason, or null when staged
 * @property {(id: string) => Promise<{ blob: Blob, contentType: string }>} fetchShare
 * @property {(item: RepostItem) => boolean} isUnavailable  open.js isUnavailable
 * @property {() => void} closeGallery  closes the gallery flyout, moving no focus
 * @property {() => unknown} galleryView  the open flyout's render, or null while closed: changed across the fetch, the flyout closed
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
export function createRepostAction({ stage, fetchShare, isUnavailable, closeGallery, galleryView }) {
  return {
    id: 'post',
    label: 'Re-post',
    disabled: (item) => (isUnavailable(item) ? POST_UNAVAILABLE : null),
    onSelect: async (item) => {
      if (isUnavailable(item)) throw new Error(`gallery: ${POST_UNAVAILABLE.toLowerCase()}`);
      const view = galleryView();
      const source = item.blob ? { blob: item.blob, contentType: item.contentType } : await fetchShare(item.id);
      // Closed during the fetch: staging now would replace the box's attachment and take focus.
      if (galleryView() !== view) return;
      const type = source.blob.type || source.contentType;
      const file = new File([source.blob], `${item.id}.${extensionFor(type)}`, { type: baseType(type) });
      // A refusal marks the button failed with the reason (view.js) and leaves the flyout open.
      const reason = stage(file);
      if (reason) throw new Error(reason);
      // The box already holds focus (attach.js); closing moves none.
      closeGallery();
    },
  };
}
