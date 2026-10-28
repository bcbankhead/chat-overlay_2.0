// Text rules for the Share Files plugin (plugins/share/). Pure: no DOM, no network.

/**
 * Why an upload response is a refusal, or null when it is not. Outside a chat session the
 * plugin answers 200 with the bare text "no access", so the status alone proves nothing.
 * @param {number} status
 * @param {string} body
 * @returns {string | null}
 */
export function shareRefusal(status, body) {
  if (status < 200 || status >= 300) return `Upload failed (HTTP ${status})`;
  if (/^\s*no access\b/i.test(String(body))) return 'Upload refused: not signed in to the chat';
  return null;
}
