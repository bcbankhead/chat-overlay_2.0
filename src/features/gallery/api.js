// The gallery's extension points (TDF-0009 Shared Contract): registerGalleryItemAction and
// registerGalleryItemDecoration. Module-level registries, independent of the flyout being
// open, so feature import order does not matter; an open gallery re-renders on every change.
// Other slices import from this file, never from the gallery's index.js.

import { reportGalleryError } from './errors.js';

/**
 * @typedef {object} GalleryItemAction
 * @property {string} id                 a duplicate id replaces the earlier registration
 * @property {string} label
 * @property {string} [icon]             an `<svg` markup string, or short text; the label otherwise
 * @property {(item: import('./store.js').ImageRecord) => void | Promise<void>} onSelect
 *   a returned Promise shows the button busy until it settles; a rejection marks it failed,
 *   titled with the reason, and is reported
 * @property {(item: import('./store.js').ImageRecord) => string | null} [disabled]
 *   the reason the action is unavailable for this item, used as the button's title and
 *   aria-label; null when it is enabled. Read each time the tile is drawn
 * @property {number} [cooldownMs]       after a resolved Promise, the button stays disabled this long
 */

/** @typedef {(item: import('./store.js').ImageRecord, el: HTMLElement) => void} GalleryItemDecoration */

/** @type {Map<string, GalleryItemAction>} */
const actions = new Map();
/** @type {Set<GalleryItemDecoration>} */
const decorations = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      reportGalleryError(err);
    }
  }
}

/**
 * Add an action to every gallery item.
 * @param {GalleryItemAction} action
 * @returns {() => void} unregister
 */
export function registerGalleryItemAction(action) {
  if (!action || typeof action.id !== 'string' || !action.id) throw new TypeError('gallery item action needs a string id');
  if (typeof action.onSelect !== 'function') throw new TypeError('gallery item action needs an onSelect function');
  const { cooldownMs } = action;
  if (cooldownMs !== undefined && (typeof cooldownMs !== 'number' || !Number.isFinite(cooldownMs) || cooldownMs < 0)) {
    const shown = typeof cooldownMs === 'string' ? JSON.stringify(cooldownMs) : String(cooldownMs);
    throw new TypeError(`gallery item action cooldownMs must be a finite, non-negative number, got ${shown}`);
  }
  actions.set(action.id, action);
  notify();
  return () => {
    if (actions.get(action.id) !== action) return;
    actions.delete(action.id);
    notify();
  };
}

/**
 * Add a decoration, called with each gallery item and its tile element whenever the tile is drawn.
 * @param {GalleryItemDecoration} decorate
 * @returns {() => void} unregister
 */
export function registerGalleryItemDecoration(decorate) {
  if (typeof decorate !== 'function') throw new TypeError('gallery item decoration must be a function');
  decorations.add(decorate);
  notify();
  return () => {
    if (decorations.delete(decorate)) notify();
  };
}

/** Registered actions, in registration order. */
export function listGalleryItemActions() {
  return [...actions.values()];
}

/** Registered decorations, in registration order. */
export function listGalleryItemDecorations() {
  return [...decorations];
}

/**
 * Called after every registration and unregistration.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onGalleryRegistryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
