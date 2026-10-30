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
  if (typeof err === 'bigint') return `${err}n`;
  try {
    return JSON.stringify(err, safeReplacer()) ?? 'unknown error';
  } catch {
    // A throwing toJSON or getter still needs some description.
    return describeShape(err);
  }
}

/** A JSON replacer that marks repeated references and spells out BigInts instead of throwing. */
function safeReplacer() {
  const seen = new WeakSet();
  return (/** @type {string} */ _key, /** @type {unknown} */ value) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/** @param {unknown} err */
function describeShape(err) {
  if (err === null || typeof err !== 'object') return String(err);
  let keys = '';
  try {
    keys = Object.keys(err).join(', ');
  } catch {
    // A hostile Proxy can refuse even this; the constructor name alone will do.
  }
  const name = typeof err.constructor?.name === 'string' && err.constructor.name ? err.constructor.name : 'Object';
  return keys ? `${name} { ${keys} }` : name;
}
