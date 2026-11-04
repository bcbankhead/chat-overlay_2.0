// The composer's extension point (TDF-0062): uploadAttachment with whisperTo, which post a file
// at once through the box's own upload route and whisper rule. attach.js installs the one
// uploader while the box is mounted. A module-level registry, independent of feature import
// order: build.mjs emits one bundle, so every feature sees the same one. Other slices import from
// this file, never from the composer's other modules.

/**
 * The reason a file could not be attached or uploaded: the box is not mounted, or the root theme
 * is not yet.
 */
export const COMPOSER_NOT_READY = 'The chat input box is not ready';

/**
 * The composer's own upload route and whisper rule (TDF-0062), lent to a feature that posts a
 * file at once rather than staging it.
 * @typedef {object} Uploader
 * @property {() => string} whisperTo  the user being whispered to, or '' for the room
 * @property {(file: File, toUser: string) => Promise<void>} upload  posts the file privately to toUser when given, else to the room; rejects with the reason
 */

/** @type {Uploader | null} installed by attach.js while the box is mounted */
let uploader = null;

/**
 * Called by the composer's attach on install; whisperTo and uploadAttachment reach it until the
 * returned function runs.
 * @param {Uploader} next
 * @returns {() => void} uninstall, which clears only an uploader still current
 */
export function installUploader(next) {
  uploader = next;
  return () => {
    if (uploader === next) uploader = null;
  };
}

/**
 * Who a post made now would go to: the whispered user, or '' for the room (and while the box is
 * not mounted). Read it before any await, so a whisper changed mid-fetch does not redirect it.
 * @returns {string}
 */
export function whisperTo() {
  return uploader ? uploader.whisperTo() : '';
}

/**
 * Post a file at once through the composer's upload route, privately to `toUser` when given,
 * otherwise to the room. Nothing is staged in the box.
 * @param {File} file
 * @param {string} toUser
 * @returns {Promise<void>} rejects with the reason, or COMPOSER_NOT_READY while the box is not mounted
 */
export async function uploadAttachment(file, toUser) {
  if (!uploader) throw new Error(COMPOSER_NOT_READY);
  await uploader.upload(file, toUser);
}
