// Composer modifications on the engine's own textarea#optionsBar: Shift+Enter inserts a
// newline, a URL pasted over a selection becomes a labelled link, and the composer is restyled
// in place (composer.css, from data-tdf-theme on <html>) with a smiley picker, image attach and
// a whisper chip. Text still goes out through the engine — the inline submitenter calls
// addMessage — so whisper, silence, the length limit and the repeat filter keep applying.

import { MAIN_DIV } from '../../core/parse.js';
import { whenDomReady } from '../../core/ready.js';
import { installAttach } from './attach.js';
import { installBox } from './box.js';
import css from './composer.css';
import { buildLabelledLink, isSingleHttpUrl } from './link.js';
import { installSmileyButton } from './smilies.js';
import { installWhisper } from './whisper.js';

const BAR = 'optionsBar';

const win = /** @type {any} */ (window);
if (!win.__tdfChat2Composer) {
  win.__tdfChat2Composer = true;
  // Window capture phase runs before the textarea's inline onkeypress, and needs no wait for
  // the element to exist.
  window.addEventListener('keypress', onKeypress, true);
  window.addEventListener('paste', onPaste, true);
  whenDomReady(document, install);
}

/**
 * Add the composer's own pieces beside the engine's. Pages under the @match without a chat
 * have nothing to restyle. composer.css styles only under :root[data-tdf-theme], so until the
 * overlay mounts its theme — or if it never does — the engine's composer looks as it did.
 */
function install() {
  if (!document.getElementById(MAIN_DIV)) return;
  const style = document.createElement('style');
  style.id = 'tdf-composer-style';
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.getElementById(BAR);
  if (!isBar(bar)) return;

  // The chip, icon, thumbnail and hint are placed against the box's container.
  const host = bar.parentElement ?? document.body;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  installBox(bar);
  installSmileyButton(bar);
  installWhisper(bar, host);
  installAttach(bar, host);
}

/**
 * @param {EventTarget | null} target
 * @returns {target is HTMLTextAreaElement}
 */
function isBar(target) {
  return target instanceof HTMLTextAreaElement && target.id === BAR;
}

/**
 * submitenter sends on keyCode 13 whatever the modifiers (message.js.php:1266). Shift+Enter
 * is kept from it, without preventDefault, so the browser inserts the newline natively and
 * undo still works. addMessage then sets addLineBreaks for the multi-line text.
 * @param {KeyboardEvent} event
 */
function onKeypress(event) {
  if (!isBar(event.target)) return;
  if ((event.key === 'Enter' || event.keyCode === 13) && event.shiftKey) event.stopImmediatePropagation();
}

/**
 * A single http(s) URL pasted over a non-empty selection replaces it with a link labelled by
 * the selection. Anything else — no selection, other text, a URL or label that cannot be
 * carried intact — pastes as it always has.
 * @param {ClipboardEvent} event
 */
function onPaste(event) {
  const bar = event.target;
  if (!isBar(bar)) return;
  const { selectionStart: start, selectionEnd: end } = bar;
  if (start === end) return;
  const url = (event.clipboardData?.getData('text/plain') ?? '').trim();
  if (!isSingleHttpUrl(url)) return;
  const link = buildLabelledLink(url, bar.value.slice(start, end));
  if (link === null) return;
  event.preventDefault();
  insert(bar, link);
}

/**
 * Replace the selection, through the editing stack when the browser allows it so the paste
 * can be undone.
 * @param {HTMLTextAreaElement} bar
 * @param {string} text
 */
function insert(bar, text) {
  bar.focus();
  // execCommand is deprecated; where it is missing or declines, setRangeText inserts the same
  // text, losing only the paste's undo step.
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;
  bar.setRangeText(text, bar.selectionStart, bar.selectionEnd, 'end');
  bar.dispatchEvent(new Event('input', { bubbles: true }));
}
