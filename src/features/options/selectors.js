// Pure rules behind the Settings flyout's history and gallery limits (Media and Gallery
// Settings): what a typed value means, which records a limit removes, and how a stored sender is
// shown. No I/O; limits.js applies them to the stores.

import { safeDecodeURIComponent } from '../../core/parse.js';

// The Chat history rules live in core, which replay reads too; one copy.
export { HISTORY_ON, storageLines } from '../../core/retention.js';

export const MB_BYTES = 1_048_576;

/**
 * A field's typed value: the setting it would store, or not one at all.
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false }} Parsed
 */

/**
 * Gallery size limit (MB): empty is no limit, otherwise a whole number, 1 or more.
 * @param {string} input
 * @returns {Parsed<number | null>}
 */
export function parseMegabytes(input) {
  const text = input.trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d+$/.test(text) || Number(text) < 1) return { ok: false };
  return { ok: true, value: Number(text) };
}

/** @param {number} mb */
export function megabytesToBytes(mb) {
  return mb * MB_BYTES;
}

/**
 * A stored sender as the message view shows it. The raw value stays the key: it is what
 * `messages.user` holds.
 * @param {string} raw
 * @returns {string}
 */
export function senderLabel(raw) {
  return safeDecodeURIComponent(raw);
}
