// Pure reconciliation of own messages (Locked: own messages). The local echo is held as a
// pending record until its send settles (engine-hook.js). The live server never returns a
// sender's own messages in a poll, so a server copy with the same user and text replacing it
// is a fallback only. A pending record left unconfirmed past PENDING_TTL_MS is kept and
// marked unconfirmed.

/** How long a pending own message waits for its send to settle. */
export const PENDING_TTL_MS = 60_000;

/**
 * @typedef {object} Pending
 * @property {string} id         provisional id `local-<receivedAt>-<seq>`
 * @property {string} user
 * @property {string} text
 * @property {number} receivedAt epoch ms
 */

/**
 * @param {{ receivedAt: number }} pending
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function isExpired(pending, now) {
  return now - pending.receivedAt > PENDING_TTL_MS;
}

/**
 * The oldest unexpired pending record the server record confirms, or null.
 * @template {Pending} P
 * @param {{ user: string, text: string }} server
 * @param {readonly P[]} pendings
 * @param {number} now epoch ms
 * @returns {P | null}
 */
export function findPending(server, pendings, now) {
  const user = server.user.toLowerCase();
  /** @type {P | null} */
  let match = null;
  for (const p of pendings) {
    if (isExpired(p, now)) continue;
    if (p.user.toLowerCase() !== user || p.text !== server.text) continue;
    if (match === null || p.receivedAt < match.receivedAt) match = p;
  }
  return match;
}

/**
 * Provisional id for a pending own message.
 * @param {number} receivedAt
 * @param {number} seq
 * @returns {string}
 */
export function provisionalId(receivedAt, seq) {
  return `local-${receivedAt}-${seq}`;
}
