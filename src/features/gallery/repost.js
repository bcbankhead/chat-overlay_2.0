// Post (TDF-0038): a gallery tile action that reposts its image into the chat. The image is
// re-uploaded through the Share Files plugin (composer/share.js uploadShare), the route composer
// attach uses, so the destination follows the same whisper rule: privately to the user in
// #whisperID while whispering, otherwise to the room. The source is the stored original when one
// was kept, else the share fetched again. Every I/O is injected; start.js wires the real ones.

import { baseType } from './reencode.js';

/** Shown as the button's title, and the reason Post is disabled, on a tile with nothing to send. */
export const POST_UNAVAILABLE = 'Image unavailable from server';

/** How long a tile's Post stays disabled after a successful post. */
export const POST_COOLDOWN_MS = 5000;

/** A paper plane, stroked like the tile's trash (view.js ICONS). */
const POST_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>';

/**
 * The fields of a gallery record (store.js ImageRecord) Post reads.
 * @typedef {object} RepostItem
 * @property {string} id
 * @property {string} contentType
 * @property {Blob} [blob]
 * @property {boolean} broken
 */

/**
 * @typedef {object} RepostDeps
 * @property {(file: File, toUser: string) => Promise<void>} upload  uploadShare: rejects with the refusal's reason
 * @property {(id: string) => Promise<{ blob: Blob, contentType: string }>} fetchShare
 * @property {() => string} whisperTo  the user being whispered, '' for the room
 * @property {(item: RepostItem) => boolean} isUnavailable  open.js isUnavailable
 */

/**
 * @typedef {object} RepostAction
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {number} cooldownMs
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
export function createRepostAction({ upload, fetchShare, whisperTo, isUnavailable }) {
  return {
    id: 'post',
    label: 'Post',
    icon: POST_ICON,
    cooldownMs: POST_COOLDOWN_MS,
    disabled: (item) => (isUnavailable(item) ? POST_UNAVAILABLE : null),
    onSelect: async (item) => {
      if (isUnavailable(item)) throw new Error(`gallery: ${POST_UNAVAILABLE.toLowerCase()}`);
      // Read at the click, before any await, so a whisper ended mid-upload still goes where it was aimed.
      const toUser = whisperTo();
      const source = item.blob ? { blob: item.blob, contentType: item.contentType } : await fetchShare(item.id);
      const type = source.blob.type || source.contentType;
      const file = new File([source.blob], `${item.id}.${extensionFor(type)}`, { type: baseType(type) });
      await upload(file, toUser);
    },
  };
}
