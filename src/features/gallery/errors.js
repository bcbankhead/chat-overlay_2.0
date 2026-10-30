// The gallery's failures, kept for the flyout to show: capture runs with no flyout open, so
// a failure is recorded here and listed in the gallery's header when it next opens, as well
// as logged. The newest few are kept; the list is cleared from the flyout.

import { describeError } from '../../core/errors.js';

const MAX = 5;

/** @type {string[]} */
let messages = [];
/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      // A listener that fails cannot be shown by the surface it failed to update.
      console.error('Gallery: error listener failed', err);
    }
  }
}

/**
 * Record a failure for the flyout, and log it.
 * @param {unknown} err
 */
export function reportGalleryError(err) {
  console.error('Gallery:', err);
  messages = [...messages, describeError(err)].slice(-MAX);
  notify();
}

/** The recorded failures, oldest first. */
export function listGalleryErrors() {
  return [...messages];
}

export function clearGalleryErrors() {
  messages = [];
  notify();
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onGalleryErrors(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
