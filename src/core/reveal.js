// The ready gate behind the load fade-in (TDF-0026). The core and each feature register as a
// participant when their entry runs, and report done on every way out of their start; the
// bootstrap reveals the page once all of them have reported (and the engine has laid the page
// out). Module state only, never a window global: a second copy of the script has its own
// gate, and build.mjs's second-copy check sees nothing touched.

/**
 * @typedef {object} ReadyGate
 * @property {(name: string) => () => void} expectReady
 *   register a participant; returns its `done`, which is safe to call more than once
 * @property {(fn: () => void) => void} whenAllReady
 *   call `fn` once, when every registered participant has reported (at once if they have)
 * @property {() => string[]} pendingNames  the participants still outstanding, in order
 */

/** @returns {ReadyGate} */
export function createReadyGate() {
  /** @type {Set<{ name: string }>} */
  const pending = new Set();
  /** @type {Array<() => void>} */
  let waiting = [];

  const settle = () => {
    if (pending.size) return;
    const fns = waiting;
    waiting = [];
    for (const fn of fns) fn();
  };

  return {
    expectReady(name) {
      const entry = { name };
      pending.add(entry);
      return () => {
        if (!pending.delete(entry)) return;
        settle();
      };
    },
    whenAllReady(fn) {
      waiting.push(fn);
      settle();
    },
    pendingNames() {
      return [...pending].map((entry) => entry.name);
    },
  };
}

const gate = createReadyGate();

/** Register a participant with the shared gate; returns its idempotent `done`. */
export const expectReady = gate.expectReady;
/** Call `fn` once every participant registered with the shared gate has reported. */
export const whenAllReady = gate.whenAllReady;
/** The shared gate's outstanding participants. */
export const pendingNames = gate.pendingNames;
