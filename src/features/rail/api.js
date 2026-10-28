/// <reference lib="dom" />
// The rail's extension points (TDF-0009 Shared Contract): registerRailPanel and
// registerUserMenuAction. The registry is module-level and independent of the rail being
// mounted, so feature import order does not matter; the rail re-renders on every change.
// Other slices import from this file, never from the rail's index.js.

import { describeError } from '../../core/errors.js';

/** @typedef {void | (() => void)} Cleanup */

/**
 * @typedef {object} RailPanel
 * @property {string} id                 a duplicate id replaces the earlier registration
 * @property {string} title
 * @property {string} icon               short text or emoji shown on the rail button
 * @property {number} [order]            lower first; default 100
 * @property {(container: HTMLElement) => Cleanup} render          fills the flyout when opened
 * @property {(el: HTMLElement) => Cleanup} [renderRailSlot]       always-visible slot under the button
 */

/**
 * @typedef {object} UserMenuAction
 * @property {string} id                 a duplicate id replaces the earlier registration
 * @property {string} label
 * @property {string} [icon]
 * @property {number} [order]            lower first, after the built-in actions; default 100
 * @property {(user: import('./rowParse.js').RailUser) => boolean} [isVisible]
 * @property {(user: import('./rowParse.js').RailUser) => void} run
 */

const DEFAULT_ORDER = 100;

/**
 * @template {{ id: string, order?: number }} T
 * @typedef {{ item: T, seq: number }} Entry
 */

let seq = 0;
/** @type {Map<string, Entry<RailPanel>>} */
const panels = new Map();
/** @type {Map<string, Entry<UserMenuAction>>} */
const actions = new Map();
/** @type {Map<() => void, (err: unknown) => void>} listener → where its failures go */
const listeners = new Map();

// A failing listener neither skips the rest nor throws out of the registering caller, whose
// registration has already gone through.
function notify() {
  for (const [fn, onError] of listeners) {
    try {
      fn();
    } catch (err) {
      onError(err);
    }
  }
}

/**
 * @template {{ id: string, order?: number }} T
 * @param {Map<string, Entry<T>>} map
 * @param {T} item
 * @param {string} kind
 * @returns {() => void}
 */
function register(map, item, kind) {
  if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`${kind} needs a string id`);
  const entry = { item, seq: seq++ };
  map.set(item.id, entry);
  notify();
  return () => {
    if (map.get(item.id) !== entry) return;
    map.delete(item.id);
    notify();
  };
}

/**
 * @template {{ id: string, order?: number }} T
 * @param {Map<string, Entry<T>>} map
 * @returns {T[]}
 */
function sorted(map) {
  return [...map.values()]
    .sort((a, b) => (a.item.order ?? DEFAULT_ORDER) - (b.item.order ?? DEFAULT_ORDER) || a.seq - b.seq)
    .map((e) => e.item);
}

/**
 * Add a panel to the rail.
 * @param {RailPanel} panel
 * @returns {() => void} unregister
 */
export function registerRailPanel(panel) {
  if (typeof panel?.render !== 'function') throw new TypeError('rail panel needs a render function');
  return register(panels, panel, 'rail panel');
}

/**
 * Add an action to every user's menu, after the built-in ones.
 * @param {UserMenuAction} action
 * @returns {() => void} unregister
 */
export function registerUserMenuAction(action) {
  if (typeof action?.run !== 'function') throw new TypeError('user menu action needs a run function');
  return register(actions, action, 'user menu action');
}

/** Registered panels, in rail order. */
export function listPanels() {
  return sorted(panels);
}

/**
 * Registered actions visible for this user, in menu order. An `isVisible` that throws hides
 * its action, not the whole menu, and is reported.
 * @param {import('./rowParse.js').RailUser} user
 * @param {(err: unknown) => void} onError
 */
export function listUserMenuActions(user, onError) {
  return sorted(actions).filter((action) => {
    if (!action.isVisible) return true;
    try {
      return Boolean(action.isVisible(user));
    } catch (err) {
      onError(new Error(`user menu action ${action.id}: ${describeError(err)}`));
      return false;
    }
  });
}

/**
 * Called after every registration and unregistration.
 * @param {() => void} fn
 * @param {(err: unknown) => void} onError  receives what `fn` throws
 * @returns {() => void} unsubscribe
 */
export function onRegistryChange(fn, onError) {
  listeners.set(fn, onError);
  return () => {
    listeners.delete(fn);
  };
}
