// The one way a slice waits for the chat markup (TDF-0018). The userscript runs at
// document-idle, when the markup already exists; the site include runs wherever its tag sits,
// and in <head> the body has not been parsed yet. Every entry that reads the chat markup
// starts through here, so placement never decides whether it starts.

/**
 * Call `fn` once the document has been parsed: at DOMContentLoaded while it is still
 * loading, otherwise right away.
 * @param {Document} doc
 * @param {() => void} fn
 */
export function whenDomReady(doc, fn) {
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => fn(), { once: true });
  else fn();
}
