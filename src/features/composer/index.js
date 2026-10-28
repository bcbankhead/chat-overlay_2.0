// Composer input modifications on the engine's own textarea#optionsBar: Shift+Enter inserts a
// newline, a URL pasted over a selection becomes a labelled link, and the textarea is restyled
// in place. Sending is untouched — the inline submitenter still calls addMessage, so whisper,
// silence, the length limit and the repeat filter keep applying.

import { MAIN_DIV } from '../../core/parse.js';
import { inkClass } from '../../core/view.js';
import css from './composer.css';
import { buildLabelledLink, isSingleHttpUrl } from './link.js';

const BAR = 'optionsBar';
// A copy of names theme.css owns; index.test.js fails when the two drift.
const TOKENS = ['--tdf-bg', '--tdf-fg', '--tdf-muted', '--tdf-border', '--tdf-link', '--tdf-chip-bg'];

const win = /** @type {any} */ (window);
if (!win.__tdfChat2Composer) {
  win.__tdfChat2Composer = true;
  // Window capture phase runs before the textarea's inline onkeypress, and needs no wait for
  // the element to exist.
  window.addEventListener('keypress', onKeypress, true);
  window.addEventListener('paste', onPaste, true);
  installTheme();
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

/**
 * Restyle the composer with the overlay's theme. The theme is data-tdf-theme on <html>; the
 * resolved token values are copied into this feature's stylesheet whenever it changes. Until
 * the overlay mounts — or if it never does — the composer keeps the engine's look.
 */
function installTheme() {
  // Pages under the @match without a chat never mount the overlay: nothing to wait for.
  if (!document.getElementById(MAIN_DIV)) return;
  const style = document.createElement('style');
  style.id = 'tdf-composer-style';
  document.head.appendChild(style);

  const root = document.documentElement;
  let mounted = false;
  /** @type {HTMLTextAreaElement | null} */
  let bar = null;

  const ink = () => {
    if (bar) bar.dataset.tdfInk = inkClass(getComputedStyle(bar).color) ?? '';
  };

  const sync = () => {
    if (!mounted || !bar || !root.dataset.tdfTheme) return;
    const computed = getComputedStyle(root);
    const tokens = TOKENS.map((name) => `${name}: ${computed.getPropertyValue(name).trim()};`).join(' ');
    style.textContent = `#${BAR}[data-tdf-theme] { ${tokens} }\n${css}`;
    bar.dataset.tdfTheme = root.dataset.tdfTheme;
    ink();
  };

  const find = () => {
    // #tdf-chat is only the signal that the overlay mounted.
    const foundBar = document.getElementById(BAR);
    if (!document.getElementById('tdf-chat') || !isBar(foundBar)) return false;
    mounted = true;
    bar = foundBar;
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-tdf-theme'] });
    // The engine restyles the composer inline when the sender's colour or font changes.
    new MutationObserver(ink).observe(bar, { attributes: true, attributeFilter: ['style'] });
    sync();
    return true;
  };

  if (find()) return;
  const finder = new MutationObserver(() => {
    if (find()) finder.disconnect();
  });
  finder.observe(document.body, { childList: true, subtree: true });
}
