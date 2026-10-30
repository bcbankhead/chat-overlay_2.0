// Pure rules behind the Settings flyout's Storage section: what a typed value means, which
// records a limit removes, and how a stored sender is shown. No I/O; limits.js applies them to
// the stores.

import { safeDecodeURIComponent } from '../../core/parse.js';

export const DAY_MS = 86_400_000;
export const MB_BYTES = 1_048_576;

/**
 * A field's typed value: the setting it would store, or not one at all.
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false }} Parsed
 */

/**
 * Messages received before the returned time are deleted. 0 keeps none (every line), a stored
 * legacy null keeps everything.
 * @param {number | null} days
 * @param {number} now
 * @returns {number | null} null when nothing expires
 */
export function historyCutoff(days, now) {
  if (days === null) return null;
  if (days === 0) return Infinity;
  return now - days * DAY_MS;
}

/**
 * Chat history (days): a whole number, 0 or more.
 * @param {string} input
 * @returns {Parsed<number>}
 */
export function parseDays(input) {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return { ok: false };
  return { ok: true, value: Number(text) };
}

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
