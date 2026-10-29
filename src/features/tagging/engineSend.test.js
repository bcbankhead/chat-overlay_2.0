import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { engineSend, resetRepeat } from './engineSend.js';

/**
 * A page with the engine's composer fields and a stub addMessage that reads them the way the
 * engine does: text from #optionsBar, whisper from #whisperID, then clears and focuses the bar.
 * @param {{ refuse?: boolean }} [opts]
 */
function page({ refuse = false } = {}) {
  const win = /** @type {any} */ (new Window());
  const doc = win.document;
  doc.body.innerHTML = '<textarea id="optionsBar"></textarea><input id="whisperID"><input id="other">';
  /** @type {{ text: string, whisper: string, args: string[] }[]} */
  const calls = [];
  win.addMessage = (/** @type {string} */ input, /** @type {string} */ display) => {
    const bar = doc.getElementById(input);
    calls.push({ text: bar.value, whisper: doc.getElementById('whisperID').value, args: [input, display] });
    if (refuse) return false;
    bar.value = '';
    bar.focus();
    return undefined;
  };
  return { win, doc, calls, bar: doc.getElementById('optionsBar'), whisper: doc.getElementById('whisperID') };
}

test('a reaction goes out public, and the draft, selection, whisper target and focus come back', () => {
  const { win, doc, calls, bar, whisper } = page();
  bar.value = 'half a sentence';
  bar.focus();
  bar.setSelectionRange(2, 6);
  whisper.value = 'bob';
  assert.equal(engineSend({ doc, win }, ':h ^123456'), true);
  assert.deepEqual(calls, [{ text: ':h ^123456', whisper: '', args: ['optionsBar', 'chatContainer'] }]);
  assert.equal(bar.value, 'half a sentence');
  assert.deepEqual([bar.selectionStart, bar.selectionEnd], [2, 6]);
  assert.equal(whisper.value, 'bob');
  assert.equal(doc.activeElement, bar);
});

test('focus elsewhere stays elsewhere', () => {
  const { win, doc, bar } = page();
  const other = doc.getElementById('other');
  other.focus();
  engineSend({ doc, win }, ':h ^123456');
  assert.equal(doc.activeElement, other);
  assert.equal(bar.value, '');
});

test('an engine refusal is reported, and the fields still come back', () => {
  const { win, doc, bar, whisper } = page({ refuse: true });
  bar.value = 'draft';
  whisper.value = 'bob';
  assert.equal(engineSend({ doc, win }, ':h ^123456'), false);
  assert.equal(bar.value, 'draft');
  assert.equal(whisper.value, 'bob');
});

test('no engine, no send', () => {
  const { win, doc } = page();
  delete win.addMessage;
  assert.equal(engineSend({ doc, win }, ':h ^123456'), false);
});

test('resetRepeat clears the repeat filter only while it still holds that text', () => {
  const win = /** @type {any} */ ({ lastMessageTxt: ':h ^123456' });
  resetRepeat(win, ':L ^123456');
  assert.equal(win.lastMessageTxt, ':h ^123456');
  resetRepeat(win, ':h ^123456');
  assert.equal(win.lastMessageTxt, '');
});

test('with no whisper field and nothing focused, the bar does not keep focus', () => {
  const { win, doc, bar } = page();
  doc.getElementById('whisperID').remove();
  /** @type {string[]} */
  const texts = [];
  win.addMessage = (/** @type {string} */ input) => {
    texts.push(doc.getElementById(input).value);
    doc.getElementById(input).focus();
  };
  assert.equal(engineSend({ doc, win }, ':h ^123456'), true);
  assert.deepEqual(texts, [':h ^123456']);
  assert.notEqual(doc.activeElement, bar);
});
