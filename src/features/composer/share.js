// Image upload through the engine's Share Files plugin (plugins/share/), the route its own
// "Share Files" window uses. The plugin's form is read live for its action, hidden fields
// and the shareID radio values, so only the field names come from reference/ANALYSIS.md:
// `shareID` (public/private), `shareWithUser` and `uploadedfile`.

import { shareRefusal } from './sharetext.js';

const BASE = 'plugins/share/';

// A stalled plugin would otherwise hold the composer busy until a reload.
const TIMEOUT_MS = 30000;

/**
 * Upload `file`, privately to `toUser` when one is given, otherwise to the room. The plugin
 * posts the image message itself; rejects with the reason on any refusal.
 * @param {File} file
 * @param {string} [toUser]
 * @returns {Promise<void>}
 */
export async function uploadShare(file, toUser = '') {
  const formUrl = new URL(toUser ? `${BASE}?shareWithUser=${encodeURIComponent(toUser)}` : BASE, location.href);
  const page = await shareFetch(formUrl, {});
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
  // A native submit sends its named button, and the plugin may test for it.
  const submit = /** @type {HTMLInputElement | null} */ (form.querySelector('input[type=submit][name]'));
  if (submit) data.set(submit.name, submit.value);
  data.set('shareID', scope(form, Boolean(toUser)));
  data.set('shareWithUser', toUser);
  data.set('uploadedfile', file, file.name);

  const action = new URL(form.getAttribute('action') || '', formUrl);
  const response = await shareFetch(action, { method: 'POST', body: data });
  const body = await response.text();
  const refusal = shareRefusal(response.status, body);
  if (refusal) throw new Error(refusal);
}

/**
 * A plugin request that never follows a redirect (a signed-out session is sent to a sign-in
 * page, whose own form must not be mistaken for the plugin's) and gives up after TIMEOUT_MS.
 * @param {URL} url
 * @param {RequestInit} init
 */
async function shareFetch(url, init) {
  try {
    return await fetch(url, {
      ...init,
      credentials: 'same-origin',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (/** @type {any} */ (error)?.name === 'TimeoutError') {
      throw new Error(`Upload failed: the Share Files plugin did not answer within ${TIMEOUT_MS / 1000} s`);
    }
    throw error;
  }
}

/**
 * The form's own shareID value for a private or public share, matched on the radio's value,
 * id, a label naming only that radio, or the text of a parent holding only that radio — the live
 * plugin's form uses values 1/2 with bare text beside each radio in its own table cell. A private
 * share fails closed: with no radio that names it, the upload is refused rather than risk posting
 * a whispered image to the room.
 * @param {HTMLFormElement} form
 * @param {boolean} isPrivate
 */
function scope(form, isPrivate) {
  const want = isPrivate ? /priv/i : /pub/i;
  const radios = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('input[name=shareID]')]);
  const labels = [...form.querySelectorAll('label')];
  // A label or parent wrapping both radios names both, so it names neither.
  /** @param {Element} el */
  const namesOne = (el) => el.querySelectorAll('input[name=shareID]').length <= 1;
  /** @param {HTMLInputElement} radio */
  const labelText = (radio) =>
    labels
      .filter(namesOne)
      .filter((label) => label === radio.closest('label') || (radio.id && label.htmlFor === radio.id))
      .map((label) => label.textContent ?? '')
      .join(' ');
  /** @param {HTMLInputElement} radio */
  const parentText = (radio) => {
    const parent = radio.parentElement;
    return parent && namesOne(parent) ? (parent.textContent ?? '') : '';
  };
  const match = radios.find(
    (r) => want.test(r.value) || want.test(r.id) || want.test(labelText(r)) || want.test(parentText(r)),
  );
  if (match) return match.value;
  if (radios.length || isPrivate) {
    throw new Error(`Upload failed: the Share Files form has no ${isPrivate ? 'private' : 'public'} choice`);
  }
  return 'public';
}
