// Core's subscriptions (TDF-0009 Shared Contract, extension points). Feature slices attach
// here instead of editing the engine hook or the view, and reach the view only through them.

/** @typedef {import('./history.js').MessageRecord} MessageRecord */

/**
 * A pending own message became unconfirmed with no inbound event: its send failed, its wait
 * ran out, or a new page expired it (history.expirePending). A confirmation is not emitted: a
 * confirmed record counts as its pending one did.
 * @typedef {{ roomID: string, ids: string[], confirm: 'unconfirmed' }} ConfirmChange
 */

/**
 * You liked another member's posted image: the share id, the id of the message that shared
 * it, and that row's own sender and mTime (`''` when it has none). A listener reads the stored
 * record first; the row's fields stand in when history has none (retention off, or pruned).
 * @typedef {{ shareId: string, messageId: string, user: string, mTime: string }} Liked
 */

/**
 * A set of listeners. One failing listener does not starve the others; every failure is
 * rethrown together afterwards for the caller to surface.
 * @template T
 * @param {string} what
 */
function channel(what) {
  /** @type {Set<(value: T) => void>} */
  const listeners = new Set();
  return {
    /**
     * @param {(value: T) => void} listener
     * @returns {() => void} unsubscribe
     */
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** @param {T} value */
    emit(value) {
      /** @type {unknown[]} */
      const errors = [];
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `${what} listener failed`);
    },
  };
}

/** @type {ReturnType<typeof channel<MessageRecord>>} */
const inbound = channel('inbound');
/** @type {ReturnType<typeof channel<string[]>>} */
const deleted = channel('deleted');
/** @type {ReturnType<typeof channel<ConfirmChange>>} */
const confirmChanged = channel('confirm change');
/** @type {ReturnType<typeof channel<void>>} */
const cleared = channel('clear');
/** @type {ReturnType<typeof channel<Liked>>} */
const liked = channel('liked');

/** Every message the hook records, once per record. */
export const onInbound = inbound.on;
export const emitInbound = inbound.emit;

/**
 * Stored messages were deleted, from any room: by a Storage limit, Clear history now, Delete
 * messages by user, or an admin delete. The view drops their rows; tagging re-derives without
 * them.
 */
export const onDeleted = deleted.on;
export const emitDeleted = deleted.emit;

/** A record's confirm state changed (see ConfirmChange). */
export const onConfirmChange = confirmChanged.on;
export const emitConfirmChange = confirmChanged.emit;

/** Clear chat buffer: the view empties; stored history is kept. */
export const onClearView = cleared.on;
export const clearView = () => cleared.emit(undefined);

/**
 * You liked another member's posted image (see Liked). Emitted when the like is queued,
 * whether or not it later sends; a failed like's retry emits again.
 */
export const onLiked = liked.on;
export const emitLiked = liked.emit;
