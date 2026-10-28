// Text rules for the Share Files plugin (plugins/share/). Pure: no DOM, no network.

/**
 * Why an upload response is a refusal, or null when it is not. Outside a chat session the
 * plugin answers 200 with the bare text "no access", so the status alone proves nothing.
 * Requests are sent with `redirect: 'manual'`, so a redirect arrives as status 0 (an opaque
 * redirect) or a 3xx: the plugin sending the session elsewhere, never an upload.
 * @param {number} status
 * @param {string} body
 * @returns {string | null}
 */
export function shareRefusal(status, body) {
  if (status === 0 || (status >= 300 && status < 400)) {
    return 'Upload refused: the Share Files plugin redirected (signed out of the chat?)';
  }
  if (status < 200 || status >= 300) return `Upload failed (HTTP ${status})`;
  if (/^\s*no access\b/i.test(String(body))) return 'Upload refused: not signed in to the chat';
  return null;
}
