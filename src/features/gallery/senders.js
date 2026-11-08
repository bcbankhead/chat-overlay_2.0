// The set of senders the gallery holds images from, kept in memory so the user menu's
// synchronous `isVisible` can ask it (TDF-0075.2). Re-read whole after each change, coalesced:
// one read in flight, at most one queued behind it. Nothing is known until the first read
// lands, so `has` is false until then; a failed read keeps the last good set and is reported.

/**
 * @typedef {object} SenderSet
 * @property {(user: string) => boolean} has  whether a read has seen an image from `user`
 * @property {() => Promise<void>} refresh     settles once the read it joined or queued has
 */

/**
 * @param {{
 *   read: () => Promise<Set<string>>,
 *   report: (err: unknown) => void,
 * }} deps
 * @returns {SenderSet}
 */
export function createSenderSet({ read, report }) {
  /** @type {Set<string>} */
  let users = new Set();
  /** @type {Promise<void> | null} */
  let running = null;
  /** @type {Promise<void> | null} */
  let queued = null;

  /** @returns {Promise<void>} */
  function run() {
    /** @type {Promise<Set<string>>} */
    let pending;
    try {
      pending = read();
    } catch (err) {
      pending = Promise.reject(err);
    }
    return pending.then(
      (next) => {
        users = next;
      },
      (err) => {
        report(err);
      },
    );
  }

  /** @returns {Promise<void>} */
  function refresh() {
    if (!running) {
      const current = run().finally(() => {
        running = null;
      });
      running = current;
      return current;
    }
    // A change landed during the read in flight, which may not see it: read once more after.
    if (!queued) {
      const after = running.then(() => {
        queued = null;
        return refresh();
      });
      queued = after;
    }
    return queued;
  }

  return {
    has: (user) => users.has(user),
    refresh,
  };
}
