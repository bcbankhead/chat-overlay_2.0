// Re-post (TDF-0038, TDF-0043, TDF-0062): a gallery tile action that posts its image at the
// click, through the composer's upload route (composer/api.js uploadAttachment): to the room, or
// privately to the whispered user while whispering, read at the click before any await. The
// source is the stored original when one was kept, else the share fetched again. After a post
// the button cools down for POST_COOLDOWN_MS, so repeated clicks on that tile cannot post the
// same image twice within it; a failure is shown on the button and can be retried at once. The
// flyout stays open, and a post already begun completes if it closes mid-fetch. Before the
// upload, the hash of the exact bytes sent is registered in the Re-post ledger (reposted.js) with
// the tile's id, so capture recognises the share it produces and does not store the image again
// (TDF-0063); a rejected upload withdraws it. A hash failure is reported and the Re-post goes
// ahead unregistered. Every I/O is injected; start.js wires the real ones.

import { baseType } from './reencode.js';

/** @typedef {import('./reposted.js').RepostLedger} RepostLedger */

/** How long the button stays unavailable after a successful post. */
export const POST_COOLDOWN_MS = 5000;

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
 * @property {(file: File, toUser: string) => Promise<void>} upload  composer/api.js uploadAttachment: rejects with the reason
 * @property {() => string} whisperTo  composer/api.js whisperTo: the whispered user, or '' for the room
 * @property {(id: string) => Promise<{ blob: Blob, contentType: string }>} fetchShare
 * @property {(item: RepostItem) => boolean} isUnavailable  open.js isUnavailable
 * @property {(blob: Blob) => Promise<string>} hash  hash.js sha256Hex: the content hash capture computes
 * @property {RepostLedger} ledger  shared with capture.js, which takes what is registered here
 * @property {(err: unknown) => void} report
 */

/**
 * @typedef {object} RepostAction
 * @property {string} id
 * @property {string} label  rendered as the button's text (no icon), title and accessible name
 * @property {number} cooldownMs  view.js holds the button unavailable this long after a post
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
export function createRepostAction({ upload, whisperTo, fetchShare, isUnavailable, hash, ledger, report }) {
  return {
    id: 'post',
    label: 'Re-post',
    cooldownMs: POST_COOLDOWN_MS,
    disabled: (item) => (isUnavailable(item) ? POST_UNAVAILABLE : null),
    onSelect: async (item) => {
      if (isUnavailable(item)) throw new Error(`gallery: ${POST_UNAVAILABLE.toLowerCase()}`);
      // Read before the fetch, so a whisper started or ended meanwhile does not redirect the post.
      const toUser = whisperTo();
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
      // Registered before the upload, so the share it produces is recognised however soon it echoes.
      if (sent !== null) ledger.register(sent, item.id);
      try {
        await upload(file, toUser);
      } catch (err) {
        // Nothing was posted, so no share will come to take it. A rejection marks the button
        // failed with the reason (view.js), retryable at once.
        if (sent !== null) ledger.take(sent);
        throw err;
      }
    },
  };
}
