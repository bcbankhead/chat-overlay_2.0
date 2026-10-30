// The smiley picker: a 5-wide grid of the engine's own smilies (mySmilies / mySmiliesImg,
// settings.js.php). The composer opens it from one outline smiley button in place of the
// engine's icon row.

import { fixedSmilieSrc } from '../../core/smiliefix.js';

const SMILEY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M8 14.5s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3"/></svg>';

/** @type {HTMLElement | null} */
let picker = null;
/** @type {((code: string, src: string) => void) | null} */
let onPicked = null;

/** `{ code, src }` for each smilie, from the engine's globals. */
function smilies() {
  const win = /** @type {any} */ (window);
  const codes = Array.isArray(win.mySmilies) ? win.mySmilies : [];
  const imgs = Array.isArray(win.mySmiliesImg) ? win.mySmiliesImg : [];
  return codes.flatMap((/** @type {unknown} */ code, /** @type {number} */ i) => {
    if (typeof code !== 'string' || !code) return [];
    const src = /src=['"]([^'"]+)['"]/.exec(String(imgs[i] ?? ''))?.[1] ?? '';
    return [{ code, src }];
  });
}

function build() {
  const el = document.createElement('div');
  el.className = 'tdf-sm-picker';
  el.hidden = true;
  for (const s of smilies()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tdf-sm-item';
    item.title = s.code;
    item.dataset.code = s.code;
    item.dataset.src = s.src;
    const img = document.createElement('img');
    img.alt = s.code;
    img.src = fixedSmilieSrc(s.src);
    item.appendChild(img);
    el.appendChild(item);
  }
  el.addEventListener('click', (event) => {
    const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.tdf-sm-item'));
    if (!item || !onPicked) return;
    const pick = onPicked;
    closePicker();
    pick(item.dataset.code ?? '', item.dataset.src ?? '');
  });
  document.addEventListener(
    'mousedown',
    (event) => {
      const target = /** @type {Element} */ (event.target);
      if (!el.hidden && !el.contains(target) && !target.closest?.('.tdf-sm-button')) closePicker();
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePicker();
  });
  document.body.appendChild(el);
  return el;
}

function closePicker() {
  if (picker) picker.hidden = true;
  onPicked = null;
}

/**
 * Open the picker with its bottom-left corner at viewport point (x, y), kept on screen.
 * @param {{ x: number, y: number, onPick: (code: string, src: string) => void }} options
 * @returns {() => void} close
 */
export function openSmileyPicker({ x, y, onPick }) {
  picker ??= build();
  onPicked = onPick;
  picker.hidden = false;
  const rect = picker.getBoundingClientRect();
  const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
  const top = Math.min(Math.max(8, y - rect.height), window.innerHeight - rect.height - 8);
  picker.style.left = `${left + window.scrollX}px`;
  picker.style.top = `${top + window.scrollY}px`;
  return closePicker;
}

/**
 * The composer's smiley button, where the engine's icon row was (the row itself is hidden by
 * composer.css). A pick inserts through the engine's own addsmiley.
 * @param {HTMLTextAreaElement} bar
 */
export function installSmileyButton(bar) {
  const icons = document.getElementById('optionsIcons');
  const host = icons?.parentElement ?? bar.parentElement;
  if (!host) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tdf-sm-button';
  button.title = 'Smilies';
  button.setAttribute('aria-label', 'Smilies');
  button.innerHTML = SMILEY_ICON;
  host.appendChild(button);
  button.addEventListener('click', () => {
    if (picker && !picker.hidden) return closePicker();
    const rect = button.getBoundingClientRect();
    openSmileyPicker({
      x: rect.left,
      y: rect.top - 6,
      onPick: (code) => {
        const win = /** @type {any} */ (window);
        if (typeof win.addsmiley === 'function') win.addsmiley(bar.id, code);
      },
    });
  });
}
