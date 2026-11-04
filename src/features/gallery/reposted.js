// The Re-post ledger (TDF-0063): Re-post registers the hash of the exact bytes it sends, with the
// gallery record they came from, and capture takes a matching hash to recognise the share that
// upload produced, so a re-posted image is not stored in the gallery a second time. Keyed on the
// sent bytes, not the stored record: a compressed stored copy (TDF-0036) hashes differently from
// the record's own hash, which is why the content-hash dedupe (TDF-0009.13) missed it. Entries
// are counted per hash, so re-posting one tile twice registers twice; a match consumes one.
// Re-post registers before its upload and withdraws the registration when the upload is
// rejected (TDF-0062), so an entry is outstanding only while its upload is in flight, or once
// posted, until capture takes it.
// Held in memory only: nothing survives a reload.

/**
 * @typedef {object} RepostLedger
 * @property {(sentHash: string, sourceId: string) => void} register  record one re-post of `sourceId`'s bytes
 * @property {(hash: string) => string | null} take  consume one registration of `hash`: its source id, or null
 */

/**
 * @returns {RepostLedger}
 */
export function createRepostLedger() {
  /** @type {Map<string, string[]>} sent hash to the source ids registered under it, oldest first */
  const entries = new Map();
  return {
    register(sentHash, sourceId) {
      const sources = entries.get(sentHash);
      if (sources) sources.push(sourceId);
      else entries.set(sentHash, [sourceId]);
    },
    take(hash) {
      const sources = entries.get(hash);
      if (!sources) return null;
      const source = sources.shift() ?? null;
      if (sources.length === 0) entries.delete(hash);
      return source;
    },
  };
}
