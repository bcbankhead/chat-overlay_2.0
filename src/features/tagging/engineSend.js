// The only code in this slice that touches the engine. A reaction goes out through the
// engine's own addMessage, so silence, the length limit and the repeat filter still apply.
// addMessage reads #optionsBar, then clears and focuses it, and makes any message a whisper
// while #whisperID is set; so the draft, its selection, the whisper target and focus are
// saved and put back around one synchronous call (A11).

const BAR = 'optionsBar';
const WHISPER = 'whisperID';
const MAIN_DIV = 'chatContainer';

/**
 * Send `text` to the public room. Returns false when the engine refused it (addMessage
 * returns false on every refusal path, undefined when it accepts) or is missing.
 * @param {{ doc: Document, win: any }} deps
 * @param {string} text
 * @returns {boolean}
 */
export function engineSend({ doc, win }, text) {
  const bar = /** @type {HTMLTextAreaElement | null} */ (doc.getElementById(BAR));
  const whisper = /** @type {HTMLInputElement | null} */ (doc.getElementById(WHISPER));
  if (!bar || typeof win.addMessage !== 'function') return false;

  const draft = bar.value;
  const { selectionStart, selectionEnd, selectionDirection } = bar;
  const target = whisper ? whisper.value : '';
  const active = /** @type {HTMLElement | null} */ (doc.activeElement);

  let result;
  try {
    bar.value = text;
    if (whisper) whisper.value = '';
    result = win.addMessage(BAR, MAIN_DIV);
  } finally {
    bar.value = draft;
    bar.setSelectionRange(selectionStart ?? draft.length, selectionEnd ?? draft.length, selectionDirection ?? undefined);
    if (whisper) whisper.value = target;
    if (active && active !== doc.body && active !== bar && typeof active.focus === 'function') active.focus();
    else if (active !== bar) bar.blur();
  }
  return result !== false;
}

/**
 * Let the engine's repeat filter pass `text` again, only while it is still the last message
 * the engine recorded (A6). The filter compares the escaped text; a reaction holds no
 * character the engine escapes, so the two are equal.
 * @param {any} win
 * @param {string} text
 */
export function resetRepeat(win, text) {
  if (win.lastMessageTxt === text) win.lastMessageTxt = '';
}
