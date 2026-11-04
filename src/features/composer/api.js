// The composer's extension point (TDF-0043): stageAttachment, which hands a file to the message
// box as its waiting attachment, exactly as a drop does. attach.js installs the one stager while
// the box is mounted. A module-level registry, independent of feature import order: build.mjs
// emits one bundle, so every feature sees the same one. Other slices import from this file,
// never from the composer's other modules.

/** The reason nothing could be staged: the box is not mounted, or the root theme is not yet. */
export const COMPOSER_NOT_READY = 'The chat input box is not ready for an attachment';

/**
 * Stages a file as the box's waiting attachment: a refusal reason, or null when it is staged.
 * `onDiscard` runs once if the staged file is then dropped unposted: removed with its ×, or
 * replaced by another attachment. A post, or a refusal, never runs it.
 * @typedef {(file: File, onDiscard?: () => void) => string | null} Stager
 */

/** @type {Stager | null} installed by attach.js while the box is mounted */
let stager = null;

/**
 * Called by the composer's attach on install; stageAttachment reaches it until the returned
 * function runs.
 * @param {Stager} fn
 * @returns {() => void} uninstall, which clears only a stager still current
 */
export function installStager(fn) {
  stager = fn;
  return () => {
    if (stager === fn) stager = null;
  };
}

/**
 * Put a file in the message box as the waiting attachment, replacing any waiting one. Posting
 * it is left to the member's Enter or Send.
 * @param {File} file
 * @param {() => void} [onDiscard]  run once if the file is dropped unposted (see Stager)
 * @returns {string | null} why it was not staged, or null when it was
 */
export function stageAttachment(file, onDiscard) {
  if (!stager) return COMPOSER_NOT_READY;
  return stager(file, onDiscard);
}
