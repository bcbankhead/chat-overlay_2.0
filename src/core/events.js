// Inbound-message subscription (TDF-0009 Shared Contract, extension points). Feature
// slices attach here instead of editing the engine hook.

/** @typedef {(record: import('./history.js').MessageRecord) => void} InboundListener */

/** @type {Set<InboundListener>} */
const listeners = new Set();

/**
 * Subscribe to every message the hook stores, once per stored record.
 * @param {InboundListener} listener
 * @returns {() => void} unsubscribe
 */
export function onInbound(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Deliver a record to every listener. One failing listener does not starve the others;
 * every failure is rethrown together afterwards for the caller to surface.
 * @param {import('./history.js').MessageRecord} record
 */
export function emitInbound(record) {
  /** @type {unknown[]} */
  const errors = [];
  for (const listener of listeners) {
    try {
      listener(record);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'inbound listener failed');
}
