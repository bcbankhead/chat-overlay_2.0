// Readable text for an unknown thrown value, for messages shown to the user. Duck-typed,
// not `instanceof`: page code and DOMExceptions can come from another realm.

/**
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object') {
    const e = /** @type {{ errors?: unknown, message?: unknown, name?: unknown }} */ (err);
    if (Array.isArray(e.errors)) return e.errors.map(describeError).join('; ');
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.name === 'string' && e.name && typeof e.message === 'string') return e.name;
  }
  try {
    return JSON.stringify(err) ?? 'unknown error';
  } catch {
    // An unserialisable value (a cycle, a BigInt) still needs some description.
    return Object.prototype.toString.call(err);
  }
}
