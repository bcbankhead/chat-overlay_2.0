// The sound board: a list of the engine's own sound effects (mySFX, settings.js.php), opened from
// an outline speaker button beside the smiley button. It restores the engine's Play SFX icon,
// which the composer's restyle dropped with the icon row (TDF-0079). Each row's speaker previews
// the sound locally through the engine's doSound and sends nothing; its name sends `/play <name>`
// through the engine's addMessage, as the engine's addSFX does, so the name check, the `** **`
// rewrite, the usfx parameter, the whisper branch and the repeat filter all stay the engine's.

import { engineSend } from '../tagging/engineSend.js';
import { closeOnOutside, showAbove } from './popup.js';

const SPEAKER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

const PREVIEW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';

/** @type {HTMLElement | null} */
let picker = null;
/** @type {((name: string) => void) | null} */
let onPicked = null;

/**
 * `{ file, name }` for each sound in the engine's mySFX; `name` is what `/play` takes, the file
 * without its `.mp3`. Only a lowercase `.mp3` is listed: the engine's `/play` check looks for
 * `name + ".mp3"` case-sensitively, so any other entry would be refused.
 * @returns {{ file: string, name: string }[]}
 */
function sounds() {
  const win = /** @type {any} */ (window);
  const list = Array.isArray(win.mySFX) ? win.mySFX : [];
  return list.flatMap((/** @type {unknown} */ file) => {
    if (typeof file !== 'string' || !file.endsWith('.mp3') || file === '.mp3') return [];
    return [{ file, name: file.slice(0, -'.mp3'.length) }];
  });
}

function build() {
  const el = document.createElement('div');
  el.className = 'tdf-sfx-picker';
  el.hidden = true;
  for (const s of sounds()) {
    const row = document.createElement('div');
    row.className = 'tdf-sfx-row';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'tdf-sfx-preview';
    preview.title = `Preview ${s.name}`;
    preview.setAttribute('aria-label', `Preview ${s.name}`);
    preview.dataset.file = s.file;
    preview.innerHTML = PREVIEW_ICON;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tdf-sfx-item';
    item.title = `Play ${s.name} to the room`;
    item.dataset.name = s.name;
    item.textContent = s.name;
    row.append(preview, item);
    el.appendChild(row);
  }
  el.addEventListener('click', (event) => {
    const target = /** @type {Element} */ (event.target);
    const preview = /** @type {HTMLElement | null} */ (target.closest('.tdf-sfx-preview'));
    if (preview) {
      const win = /** @type {any} */ (window);
      if (typeof win.doSound === 'function') win.doSound(`sfx/${preview.dataset.file ?? ''}`);
      return;
    }
    const item = /** @type {HTMLElement | null} */ (target.closest('.tdf-sfx-item'));
    if (!item || !onPicked) return;
    const pick = onPicked;
    closePicker();
    pick(item.dataset.name ?? '');
  });
  closeOnOutside(el, '.tdf-sfx-button', closePicker);
  document.body.appendChild(el);
  return el;
}

function closePicker() {
  if (picker) picker.hidden = true;
  onPicked = null;
}

/**
 * Open the sound board with its bottom-left corner at viewport point (x, y), kept on screen.
 * @param {{ x: number, y: number, onPick: (name: string) => void }} options
 * @returns {() => void} close
 */
export function openSoundPicker({ x, y, onPick }) {
  picker ??= build();
  onPicked = onPick;
  showAbove(picker, x, y);
  return closePicker;
}

/**
 * The composer's sound button, beside the smiley button. Absent when the engine defines no
 * sounds, as the engine leaves out its own Play SFX icon then.
 * @param {HTMLTextAreaElement} bar
 */
export function installSoundButton(bar) {
  if (sounds().length === 0) return;
  const icons = document.getElementById('optionsIcons');
  const host = icons?.parentElement ?? bar.parentElement;
  if (!host) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tdf-sfx-button';
  button.title = 'Play SFX';
  button.setAttribute('aria-label', 'Play SFX');
  button.innerHTML = SPEAKER_ICON;
  host.appendChild(button);
  button.addEventListener('click', () => {
    if (picker && !picker.hidden) return closePicker();
    const rect = button.getBoundingClientRect();
    openSoundPicker({
      x: rect.left,
      y: rect.top - 6,
      // A refused /play (no such sound, silenced, a repeat) is reported by the engine itself,
      // through its own info box, so the result needs no handling here.
      onPick: (name) => {
        engineSend({ doc: document, win: window }, `/play ${name}`, { keepWhisper: true });
      },
    });
  });
}
