// Image upload through the engine's Share Files plugin (plugins/share/), the route its own
// "Share Files" window uses. The plugin's form is read live for its action, hidden fields
// and the shareID radio values, so only the field names come from reference/ANALYSIS.md:
// `shareID` (public/private), `shareWithUser` and `uploadedfile`.

import { shareRefusal } from './sharetext.js';

const BASE = 'plugins/share/';

/**
 * Upload `file`, privately to `toUser` when one is given, otherwise to the room. The plugin
 * posts the image message itself; rejects with the reason on any refusal.
 * @param {File} file
 * @param {string} [toUser]
 * @returns {Promise<void>}
 */
export async function uploadShare(file, toUser = '') {
  const formUrl = new URL(toUser ? `${BASE}?shareWithUser=${encodeURIComponent(toUser)}` : BASE, location.href);
  const page = await fetch(formUrl, { credentials: 'same-origin' });
  const pageText = await page.text();
  const pageRefusal = shareRefusal(page.status, pageText);
  if (pageRefusal) throw new Error(pageRefusal);

  const form = new DOMParser().parseFromString(pageText, 'text/html').querySelector('form');
  if (!form) throw new Error('Upload failed: the Share Files form was not found');
  const data = new FormData();
  for (const input of form.querySelectorAll('input[type=hidden][name]')) {
    const hidden = /** @type {HTMLInputElement} */ (input);
    data.set(hidden.name, hidden.value);
  }
  data.set('shareID', scope(form, Boolean(toUser)));
  data.set('shareWithUser', toUser);
  data.set('uploadedfile', file, file.name);

  const action = new URL(form.getAttribute('action') || '', formUrl);
  const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
  const body = await response.text();
  const refusal = shareRefusal(response.status, body);
  if (refusal) throw new Error(refusal);
}

/**
 * The form's own shareID value for a private or public share.
 * @param {HTMLFormElement} form
 * @param {boolean} isPrivate
 */
function scope(form, isPrivate) {
  const want = isPrivate ? /priv/i : /pub/i;
  const radios = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[name=shareID]')]);
  const match = radios.find((r) => want.test(r.value) || want.test(r.id) || want.test(r.parentElement?.textContent ?? ''));
  return match ? match.value : isPrivate ? 'private' : 'public';
}
