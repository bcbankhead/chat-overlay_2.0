// Who was recently in each room, read from the entry and exit lines the server sends in its
// polls (TDF-0058). In memory for this page load only: every load re-reads the history poll, so
// nothing is stored. The engine hook ingests every poll's lines, drawn or not; the rail reads them.

/**
 * One entry or exit line, as the hook read it from a server record.
 * @typedef {object} PresenceLine
 * @property {string} uuID  the sender's chat id, the record's field [1]
 * @property {string} name  the sender's name, decoded
 * @property {string} rawName the sender's name as the record carries it, still encoded: the form
 *   the engine passes to viewProfile
 * @property {'entry' | 'exit'} kind
 * @property {string} mTime server unix time, seconds
 */

/**
 * @typedef {object} Presence
 * @property {(roomID: string, lines: readonly PresenceLine[]) => void} ingest keep each user's
 *   newest line; subscribers are told when anything changed
 * @property {(roomID: string) => PresenceLine[]} seen the room's users, newest line first
 * @property {(fn: () => void) => () => void} subscribe returns unsubscribe
 */

/**
 * @param {string} mTime
 * @returns {number}
 */
const seconds = (mTime) => {
  const n = Number(mTime);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A fresh store. A user's newest line of either kind decides their place (TDF-0058 Locked
 * decisions, Recency). A line older than the one kept is ignored; at the same second the later
 * one ingested wins, as polls list lines oldest first.
 * @returns {Presence}
 */
export function createPresence() {
  /** @type {Map<string, Map<string, PresenceLine>>} roomID → uuID → newest line */
  const rooms = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();

  return {
    ingest(roomID, lines) {
      let room = rooms.get(roomID);
      let changed = false;
      for (const line of lines) {
        if (!line.uuID) continue;
        if (!room) {
          room = new Map();
          rooms.set(roomID, room);
        }
        const kept = room.get(line.uuID);
        if (kept && seconds(kept.mTime) > seconds(line.mTime)) continue;
        if (kept && kept.mTime === line.mTime && kept.kind === line.kind && kept.name === line.name && kept.rawName === line.rawName) continue;
        room.set(line.uuID, { ...line });
        changed = true;
      }
      if (!changed) return;
      for (const fn of [...listeners]) fn();
    },
    seen(roomID) {
      const room = rooms.get(roomID);
      if (!room) return [];
      return [...room.values()].map((l) => ({ ...l })).sort((a, b) => seconds(b.mTime) - seconds(a.mTime));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The page's store: the hook writes it from install, so the rail reads what came before it mounted. */
export const presence = createPresence();
