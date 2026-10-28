// Image attach on the message box. An image dropped on the box, or chosen with the grey upload
// icon at its right edge, waits as a 44 px thumbnail where the text starts until Enter or Send
// posts it; its × drops it. One image at a time. The always-shown hint line sits in the box's
// lower right.
//
// Posting uploads the image through the Share Files plugin (share.js), which posts the image
// message to the room itself — the observed share message has the plugin's 5 fields, not the
// engine's 7. Any typed text then goes out through the engine's own Send, so whisper,
// silence, length and repeat checks still apply to it. A failed upload sends nothing and keeps
// both the text and the thumbnail, marked failed with the reason as its title.

import { describeError } from '../../core/errors.js';
import { MAIN_DIV } from '../../core/parse.js';
import { uploadShare } from './share.js';

const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';

const HINT = 'Shift+Enter for newline · Drag and drop images';

/**
 * @param {HTMLTextAreaElement} bar
 * @param {HTMLElement} host positioned ancestor the icon, thumbnail and hint are placed in
 */
export function installAttach(bar, host) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;

  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'tdf-attach-icon';
  icon.title = 'Add an image';
  icon.setAttribute('aria-label', 'Add an image');
  icon.innerHTML = UPLOAD_ICON;

  // A textarea's placeholder cannot sit in a corner and hides while typing; composer.css
  // keeps a bottom strip of the box clear for this line instead.
  const hint = document.createElement('div');
  hint.className = 'tdf-attach-hint';
  hint.textContent = HINT;

  const thumb = document.createElement('div');
  thumb.className = 'tdf-attach-thumb';
  thumb.hidden = true;
  const img = document.createElement('img');
  img.alt = '';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tdf-attach-remove';
  remove.title = 'Remove image';
  remove.setAttribute('aria-label', 'Remove image');
  remove.textContent = '×';
  thumb.append(img, remove);

  host.append(input, icon, thumb, hint);

  /** @type {{ file: File, url: string, busy: boolean } | null} */
  let pending = null;

  const place = () => {
    const h = bar.offsetHeight;
    // Slightly above centre, leaving air above the hint line.
    icon.style.top = `${bar.offsetTop + (h - icon.offsetHeight) / 2 - 8}px`;
    icon.style.left = `${bar.offsetLeft + bar.offsetWidth - icon.offsetWidth - 8}px`;
    hint.style.top = `${bar.offsetTop + h - hint.offsetHeight - 5}px`;
    hint.style.left = `${bar.offsetLeft + bar.offsetWidth - hint.offsetWidth - 10}px`;
    thumb.style.top = `${bar.offsetTop + 8}px`;
    thumb.style.left = `${bar.offsetLeft + 8}px`;
  };

  /** @param {string} url */
  const revoke = (url) => {
    if (url) URL.revokeObjectURL(url);
  };

  /** @param {File | null | undefined} file */
  const attach = (file) => {
    if (!file || !/^image\//.test(file.type) || pending?.busy) return;
    if (pending) revoke(pending.url);
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
    pending = { file, url, busy: false };
    img.src = url;
    thumb.title = file.name;
    thumb.classList.remove('tdf-attach-failed', 'tdf-attach-busy');
    thumb.hidden = false;
    bar.classList.add('tdf-attach-has');
    place();
    bar.focus();
  };

  const clear = () => {
    if (pending) revoke(pending.url);
    pending = null;
    thumb.hidden = true;
    thumb.classList.remove('tdf-attach-failed', 'tdf-attach-busy');
    bar.classList.remove('tdf-attach-has');
  };

  const sendText = () => {
    const button = document.getElementById('optionsSend');
    if (button) button.click();
    else {
      const win = /** @type {any} */ (window);
      if (typeof win.addMessage === 'function') win.addMessage(bar.id, MAIN_DIV);
    }
  };

  const post = async () => {
    if (!pending || pending.busy) return;
    const current = pending;
    current.busy = true;
    thumb.classList.remove('tdf-attach-failed');
    thumb.classList.add('tdf-attach-busy');
    // Private to the whispered user while whispering; to the room otherwise.
    const toUser = /** @type {HTMLInputElement | null} */ (document.getElementById('whisperID'))?.value ?? '';
    try {
      await uploadShare(current.file, toUser);
    } catch (error) {
      current.busy = false;
      thumb.classList.remove('tdf-attach-busy');
      thumb.classList.add('tdf-attach-failed');
      thumb.title = describeError(error);
      return;
    }
    if (pending === current) clear();
    if (bar.value.trim()) sendText();
  };

  icon.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    attach(input.files?.[0]);
    input.value = '';
  });
  remove.addEventListener('click', () => {
    if (pending?.busy) return;
    clear();
    bar.focus();
  });

  bar.addEventListener('dragover', (event) => {
    const items = event.dataTransfer?.items;
    if (!items || ![...items].some((item) => item.kind === 'file')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    bar.classList.add('tdf-attach-over');
  });
  bar.addEventListener('dragleave', () => bar.classList.remove('tdf-attach-over'));
  bar.addEventListener('drop', (event) => {
    bar.classList.remove('tdf-attach-over');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    attach(file);
  });

  // With an image pending, Enter and Send post it instead of reaching the engine. Window
  // capture runs before the box's inline submitenter and the button's inline onclick.
  window.addEventListener(
    'keypress',
    (event) => {
      // Shift+Enter is a newline. index.js's own capture listener, added first, already stops
      // it before this one; the check keeps that from depending on listener order.
      if (!pending || event.target !== bar || event.shiftKey) return;
      if (event.key !== 'Enter' && event.keyCode !== 13) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void post();
    },
    true,
  );
  window.addEventListener(
    'click',
    (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!pending || target?.id !== 'optionsSend') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void post();
    },
    true,
  );

  // The box's size and position come from the engine's layout and composer.css, which can
  // settle after this runs; follow it rather than placing once.
  window.addEventListener('resize', place);
  if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(bar);
  place();
}
