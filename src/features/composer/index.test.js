import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { adapt, THEME_BG } from '../../core/ink.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const settle = () => new Promise((r) => setTimeout(r, 20));

const SMILIES = [':)', ';)', ':P', ':7', ';(', ':(', ':V', '[(', '[x', ':h', '*R', '8)', ':d', ':L', ':o'];

/** @type {string} */
let bundle;
/** @type {string} */
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tdf-composer-'));
  const outfile = path.join(dir, 'composer.js');
  // The composer, plus the shell's mount (bootstrap's job in the real bundle) and the
  // picker's export, reachable from the test.
  await esbuild.build({
    stdin: {
      contents: [
        "import { mount } from '../../core/shell.js';",
        "import './index.js';",
        "import { openSmileyPicker } from './smilies.js';",
        'window.__test = { mount, openSmileyPicker };',
      ].join('\n'),
      resolveDir: here,
      sourcefile: 'harness.js',
    },
    bundle: true,
    format: 'iife',
    loader: { '.css': 'text' },
    outfile,
    logLevel: 'warning',
  });
  bundle = readFileSync(outfile, 'utf8');
});

after(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in theme with the createTheme surface shell.js uses. */
function fakeTheme(initial = 'dark') {
  let current = initial;
  const listeners = new Set();
  return {
    current: () => current,
    onChange(/** @type {any} */ fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async toggle() {},
    /** @param {'light' | 'dark'} next */
    set(next) {
      current = next;
      for (const fn of listeners) fn(next);
    },
  };
}

/**
 * A page with the engine's composer and the globals the composer touches. `sent` counts
 * submitenter's sends, `clicks` the Send button's.
 */
function page({ chat = true, theme = /** @type {'light' | 'dark' | null} */ ('dark') } = {}) {
  const window = new Window({ url: 'https://chat.example.com/forum/chat/' });
  const { document } = window;
  document.body.innerHTML = `${chat ? '<div id="chatContainer"></div>' : ''}
    <div id="optionsContainer">
      <div id="optionsIcons"></div>
      <textarea id="optionsBar"></textarea>
      <input id="optionsSend" type="button" value="Send">
      <div class="optionsSelectStatus"><input id="whisperID" value=""></div>
      <span id="optionsLogout"></span>
    </div>`;
  const bar = /** @type {any} */ (document.getElementById('optionsBar'));
  const state = { sent: 0, clicks: 0, whisperCalls: 0 };
  // Stands in for the inline onkeypress="return submitenter(...)", which sends on any Enter.
  bar.addEventListener('keypress', (/** @type {any} */ e) => {
    if (e.keyCode === 13) {
      state.sent += 1;
      e.preventDefault();
    }
  });
  document.getElementById('optionsSend')?.addEventListener('click', () => {
    state.clicks += 1;
  });

  // The engine's globals, as functions.js.php / message.js.php / userlist.js.php define them.
  const win = /** @type {any} */ (window);
  win.mySmilies = [...SMILIES, ''];
  // :d keeps its real file name, so the picker shows its cleaned copy (smiliefix.js).
  win.mySmiliesImg = SMILIES.map((code, i) => `<img src='smilies/${code === ':d' ? 'biggrin' : i}.gif' border='0'>`);
  win.addsmiley = (/** @type {string} */ id, /** @type {string} */ code) => {
    const el = /** @type {any} */ (document.getElementById(id));
    el.value += code;
  };
  win.whisperUser = (/** @type {string} */ name) => {
    state.whisperCalls += 1;
    /** @type {any} */ (document.getElementById('whisperID')).value = name;
  };
  win.clearWhisper = () => {
    /** @type {any} */ (document.getElementById('whisperID')).value = '';
  };
  win.textColor = '#000080';
  win.changeMessBoxStyle = (/** @type {string} */ id) => {
    /** @type {any} */ (document.getElementById(id)).style.color = win.textColor;
  };

  if (theme) document.documentElement.dataset.tdfTheme = theme;
  window.eval(bundle);
  const fake = fakeTheme(theme ?? 'dark');
  if (theme) win.__test.mount(fake);
  return { window, document, bar, state, win, theme: fake };
}

/** @param {any} window @param {any} bar @param {boolean} shiftKey */
function enter(window, bar, shiftKey) {
  const event = new window.KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, shiftKey, bubbles: true, cancelable: true });
  bar.dispatchEvent(event);
  return event;
}

/** @param {any} window @param {any} bar @param {string} text */
function paste(window, bar, text) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  bar.dispatchEvent(event);
  return event;
}

/** @param {any} window @param {any} bar @param {any} file */
function drop(window, bar, file) {
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  bar.dispatchEvent(event);
  return event;
}

/** The colour string happy-dom stores for `color`. */
function painted(/** @type {any} */ document, /** @type {string} */ color) {
  const el = document.createElement('span');
  el.style.color = color;
  return el.style.color;
}

const FORM = `<form action="index.php" method="post" enctype="multipart/form-data">
  <input type="hidden" name="MAX_FILE_SIZE" value="5000000">
  <label><input type="radio" name="shareID" value="1" checked> Public</label>
  <label><input type="radio" name="shareID" value="2"> Private</label>
  <input type="text" name="shareWithUser" value="">
  <input type="file" name="uploadedfile">
</form>`;

/**
 * Stub the plugin: GET answers the form, POST `postBody`. Records each call.
 * @param {any} win
 * @param {{ postBody?: string, postStatus?: number, formBody?: string }} [opts]
 */
function stubShare(win, { postBody = 'File shared.', postStatus = 200, formBody = FORM } = {}) {
  /** @type {{ url: string, method: string, body: any }[]} */
  const calls = [];
  win.fetch = async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: String(url), method, body: init.body });
    const isPost = method === 'POST';
    return new win.Response(isPost ? postBody : formBody, { status: isPost ? postStatus : 200 });
  };
  return calls;
}

test('Shift+Enter does not send and keeps the native newline', () => {
  const { window, bar, state } = page();
  const event = enter(window, bar, true);
  assert.equal(state.sent, 0);
  assert.equal(event.defaultPrevented, false);
});

test('Enter alone still sends', () => {
  const { window, bar, state } = page();
  enter(window, bar, false);
  assert.equal(state.sent, 1);
});

test('a URL pasted over a selection becomes a labelled link', () => {
  const { window, bar } = page();
  bar.value = 'read the docs now';
  bar.setSelectionRange(9, 13);
  const event = paste(window, bar, ' https://example.com/a(b) ');
  assert.equal(event.defaultPrevented, true);
  assert.equal(bar.value, 'read the [[a href=//example.com/a%28b%29 target=_blank]]docs[[/a]] now');
});

test('a URL pasted with nothing selected pastes as before', () => {
  const { window, bar } = page();
  bar.value = 'see ';
  bar.setSelectionRange(4, 4);
  const event = paste(window, bar, 'https://example.com/');
  assert.equal(event.defaultPrevented, false);
  assert.equal(bar.value, 'see ');
});

test('non-URL text, or a label that cannot be carried, pastes as before', () => {
  const { window, bar } = page();
  bar.value = 'mail me@example.com';
  bar.setSelectionRange(5, 19);
  assert.equal(paste(window, bar, 'https://example.com/').defaultPrevented, false);
  bar.setSelectionRange(0, 4);
  assert.equal(paste(window, bar, 'not a url').defaultPrevented, false);
  assert.equal(bar.value, 'mail me@example.com');
});

test('a second copy of the script installs nothing twice', () => {
  const { window, document, bar, state } = page();
  window.eval(bundle);
  bar.value = 'docs';
  bar.setSelectionRange(0, 4);
  paste(window, bar, 'https://example.com/');
  assert.equal(bar.value, '[[a href=//example.com/ target=_blank]]docs[[/a]]');
  assert.equal(document.querySelectorAll('#tdf-composer-style').length, 1);
  assert.equal(document.querySelectorAll('.tdf-sm-button').length, 1);
  assert.equal(document.querySelectorAll('.tdf-whisper-chip').length, 1);
  /** @type {any} */ (window).whisperUser('Alice');
  assert.equal(state.whisperCalls, 1, 'wrapped once, so the engine runs once');
});

test('keys and pastes outside the composer, and other keys in it, are left alone', () => {
  const { window, document, bar, state } = page();
  const other = document.createElement('textarea');
  other.id = 'poptionsBar_x';
  document.body.appendChild(other);
  let otherSent = 0;
  other.addEventListener('keypress', (/** @type {any} */ e) => {
    if (e.keyCode === 13) otherSent += 1;
  });
  enter(window, other, true);
  assert.equal(otherSent, 1);
  other.value = 'docs';
  other.setSelectionRange(0, 4);
  assert.equal(paste(window, other, 'https://example.com/').defaultPrevented, false);
  assert.equal(other.value, 'docs');
  const key = new window.KeyboardEvent('keypress', { key: 'a', keyCode: 97, shiftKey: true, bubbles: true });
  bar.dispatchEvent(key);
  assert.equal(state.sent, 0);
});

test('a page without the chat installs nothing', () => {
  const { document } = page({ chat: false });
  assert.equal(document.getElementById('tdf-composer-style'), null);
  assert.equal(document.querySelector('.tdf-sm-button'), null);
  assert.equal(document.querySelector('.tdf-attach-icon'), null);
});

test('a paste the browser inserts through execCommand skips the fallback', () => {
  const { window, document, bar } = page();
  /** @type {any[]} */
  const calls = [];
  document.execCommand = (/** @type {any[]} */ ...args) => {
    calls.push(args);
    return true;
  };
  let inputs = 0;
  bar.addEventListener('input', () => {
    inputs += 1;
  });
  bar.value = 'docs';
  bar.setSelectionRange(0, 4);
  assert.equal(paste(window, bar, 'https://example.com/').defaultPrevented, true);
  assert.deepEqual(calls, [['insertText', false, '[[a href=//example.com/ target=_blank]]docs[[/a]]']]);
  // The stub inserts nothing, so an untouched value proves setRangeText did not run.
  assert.equal(bar.value, 'docs');
  assert.equal(inputs, 0);
});

test('the stylesheet restyles only under the root theme and hides the engine controls', () => {
  const { document } = page();
  const css = document.getElementById('tdf-composer-style')?.textContent ?? '';
  for (const selector of ['#optionsIcons', '.optionsSelectStatus', '#optionsLogout']) {
    assert.match(css, new RegExp(`:root\\[data-tdf-theme\\] ${selector.replace('.', '\\.')}`));
  }
  assert.match(css, /height: 75px/);
  assert.match(css, /#2da44e/);
  assert.match(css, /#dadae6/i);
  assert.match(css, /#444450/);
  assert.doesNotMatch(css, /data-tdf-ink/);
  // The engine's controls stay in the page, still read by it.
  assert.ok(document.getElementById('whisperID'));
  assert.ok(document.getElementById('optionsLogout'));
});

test('the smiley button opens a 5-wide picker of the 15 smilies; a pick inserts its code', () => {
  const { document, bar } = page();
  const button = /** @type {any} */ (document.querySelector('.tdf-sm-button'));
  assert.ok(button);
  button.click();
  const picker = /** @type {any} */ (document.querySelector('.tdf-sm-picker'));
  assert.equal(picker.hidden, false);
  const items = picker.querySelectorAll('.tdf-sm-item');
  assert.equal(items.length, 15, 'the empty trailing code is filtered out');
  assert.equal(items[0].querySelector('img').getAttribute('src'), 'smilies/0.gif');
  assert.match(items[12].querySelector('img').getAttribute('src'), /^data:image\/gif;base64,/, ':d shows its cleaned copy');
  assert.equal(items[12].dataset.src, 'smilies/biggrin.gif', 'a pick still reports the site source');
  bar.value = 'hi ';
  items[9].click();
  assert.equal(bar.value, 'hi :h');
  assert.equal(picker.hidden, true);
  button.click();
  button.click();
  assert.equal(picker.hidden, true, 'a second click on the button closes it');
});

test('openSmileyPicker takes a pick callback, and closes on Escape', () => {
  const { window, document, win } = page();
  /** @type {string[][]} */
  const picks = [];
  const close = win.__test.openSmileyPicker({
    x: 40,
    y: 300,
    onPick: (/** @type {string} */ code, /** @type {string} */ src) => picks.push([code, src]),
  });
  assert.equal(typeof close, 'function');
  const picker = /** @type {any} */ (document.querySelector('.tdf-sm-picker'));
  picker.querySelectorAll('.tdf-sm-item')[1].click();
  assert.deepEqual(picks, [[';)', 'smilies/1.gif']]);
  assert.equal(picker.hidden, true);

  win.__test.openSmileyPicker({ x: 0, y: 0, onPick: () => {} });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(picker.hidden, true);

  win.__test.openSmileyPicker({ x: 0, y: 0, onPick: () => {} })();
  assert.equal(picker.hidden, true, 'the returned close closes it');
});

test('openSmileyPicker sits above (x, y)', () => {
  const { document, win } = page();
  win.__test.openSmileyPicker({ x: 40, y: 300, onPick: () => {} });
  const picker = /** @type {any} */ (document.querySelector('.tdf-sm-picker'));
  picker.getBoundingClientRect = () => ({ width: 200, height: 120, top: 0, left: 0, right: 200, bottom: 120 });
  win.__test.openSmileyPicker({ x: 40, y: 300, onPick: () => {} });
  assert.equal(picker.style.top, `${300 - 120 + win.scrollY}px`, 'bottom edge at y');
  assert.equal(picker.style.left, `${40 + win.scrollX}px`);
});

test('whispering shows the chip and blue border; its × stops the whisper', () => {
  const { document, bar, win } = page();
  const chip = /** @type {any} */ (document.querySelector('.tdf-whisper-chip'));
  assert.equal(chip.hidden, true);
  assert.equal(bar.classList.contains('tdf-whisper'), false);
  win.whisperUser('Alice');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.tdf-whisper-name').textContent, 'Alice');
  assert.equal(bar.classList.contains('tdf-whisper'), true);
  chip.querySelector('.tdf-whisper-clear').click();
  assert.equal(/** @type {any} */ (document.getElementById('whisperID')).value, '');
  assert.equal(chip.hidden, true);
  assert.equal(bar.classList.contains('tdf-whisper'), false);
});

test('starting a whisper focuses the box; the chip stands on its top edge at the right', () => {
  const { document, bar, win } = page();
  const chip = /** @type {any} */ (document.querySelector('.tdf-whisper-chip'));
  for (const [key, value] of Object.entries({ offsetLeft: 20, offsetTop: 100, offsetWidth: 500 })) {
    Object.defineProperty(bar, key, { value, configurable: true });
  }
  for (const [key, value] of Object.entries({ offsetWidth: 120, offsetHeight: 22 })) {
    Object.defineProperty(chip, key, { value, configurable: true });
  }
  const other = document.getElementById('optionsSend');
  other?.focus();
  win.whisperUser('Alice');
  assert.ok(document.activeElement === bar);
  // Right edge on the whisper ring's outer edge (1px outside the box), bottom on the box's top.
  assert.equal(chip.style.left, `${20 + 500 + 1 - 120}px`);
  assert.equal(chip.style.top, `${100 - 22}px`);
  other?.focus();
  win.clearWhisper();
  assert.ok(document.activeElement === other, 'clearing a whisper does not move focus');
});

test('closing the last open menu or picker focuses the box', async () => {
  const { window, document, bar, win } = page();
  win.__test.openSmileyPicker({ x: 40, y: 300, onPick: () => {} });
  await settle();
  /** @type {any} */ (document.activeElement)?.blur?.();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.ok(document.activeElement === bar, 'the picker closed');

  // A menu another slice owns, closed while a flyout is still open: focus waits for both.
  const menu = document.createElement('div');
  menu.className = 'tdf-rail-menu';
  const flyout = document.createElement('div');
  flyout.className = 'tdf-rail-flyout tdf-open';
  document.body.append(menu, flyout);
  await settle();
  bar.blur();
  menu.hidden = true;
  await settle();
  assert.ok(document.activeElement !== bar, 'a flyout is still open');
  flyout.classList.remove('tdf-open');
  await settle();
  assert.ok(document.activeElement === bar, 'the flyout closed');
});

test('a close leaves focus with another field; with nothing closing, focus is never taken', async () => {
  const { document, bar } = page();
  const field = document.createElement('input');
  document.body.appendChild(field);
  const menu = document.createElement('div');
  menu.className = 'tdf-rail-menu';
  document.body.appendChild(menu);
  await settle();
  field.focus();
  menu.hidden = true;
  await settle();
  assert.ok(document.activeElement === field, 'the field keeps its typing');

  bar.blur();
  document.body.appendChild(document.createElement('p'));
  menu.className = 'tdf-other';
  await settle();
  assert.ok(document.activeElement !== bar, 'no menu closed, so nothing refocused');
});

test('a menu closed by a press outside it leaves focus alone; a pick inside it refocuses', async () => {
  const { window, document, bar } = page();
  const text = document.createElement('p');
  const menu = document.createElement('div');
  menu.className = 'tdf-rail-menu';
  const item = document.createElement('button');
  menu.appendChild(item);
  document.body.append(text, menu);
  await settle();
  bar.blur();
  text.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  menu.hidden = true;
  await settle();
  assert.ok(document.activeElement !== bar, 'a press on chat text does not take focus');

  menu.hidden = false;
  await settle();
  item.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  menu.hidden = true;
  await settle();
  assert.ok(document.activeElement === bar, 'a pick inside the menu refocuses');

  bar.blur();
  menu.hidden = false;
  await settle();
  text.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  menu.hidden = true;
  await settle();
  assert.ok(document.activeElement === bar, 'an Escape after the press still refocuses');
});

for (const [name, make] of /** @type {[string, (d: any) => any][]} */ ([
  ['a textarea', (d) => d.createElement('textarea')],
  ['a select', (d) => d.createElement('select')],
  [
    'a contenteditable element',
    (d) => {
      const el = d.createElement('div');
      el.contentEditable = 'true';
      el.tabIndex = 0;
      return el;
    },
  ],
])) {
  test(`a close leaves focus with ${name}`, async () => {
    const { document, bar } = page();
    const field = make(document);
    const menu = document.createElement('div');
    menu.className = 'tdf-rail-menu';
    document.body.append(field, menu);
    await settle();
    field.focus();
    assert.ok(document.activeElement === field);
    menu.hidden = true;
    await settle();
    assert.ok(document.activeElement === field, 'the field keeps its typing');
    assert.ok(document.activeElement !== bar);
  });
}

for (const type of ['checkbox', 'button']) {
  test(`a close takes focus back from a ${type} input`, async () => {
    const { document, bar } = page();
    const field = document.createElement('input');
    field.type = type;
    const menu = document.createElement('div');
    menu.className = 'tdf-rail-menu';
    document.body.append(field, menu);
    await settle();
    field.focus();
    assert.ok(document.activeElement === field);
    menu.hidden = true;
    await settle();
    assert.ok(document.activeElement === bar, 'a non-typing input does not hold focus');
  });
}

test('the box shows the chosen colour shifted per theme, and never changes the choice', () => {
  const { document, bar, win, theme } = page({ theme: 'dark' });
  win.changeMessBoxStyle('optionsBar');
  const darkShift = adapt('#000080', THEME_BG.dark);
  assert.notEqual(darkShift, '#000080');
  assert.equal(bar.style.color, painted(document, darkShift));
  theme.set('light');
  assert.equal(bar.style.color, painted(document, '#000080'), 'navy passes on light unchanged');
  theme.set('dark');
  assert.equal(bar.style.color, painted(document, darkShift));
  assert.equal(win.textColor, '#000080', 'the chosen colour is never written back');
});

test('a grey that fails contrast shows in the theme text colour', () => {
  const { bar, win } = page({ theme: 'dark' });
  win.textColor = '#222222';
  win.changeMessBoxStyle('optionsBar');
  assert.equal(bar.style.color, 'var(--tdf-fg)');
});

test('private boxes keep the engine styling', () => {
  const { document, bar, win } = page({ theme: 'dark' });
  const other = document.createElement('input');
  other.id = 'poptionsBar_x';
  document.body.appendChild(other);
  win.changeMessBoxStyle('optionsBar');
  const before = bar.style.color;
  win.textColor = '#cc0000';
  win.changeMessBoxStyle('poptionsBar_x');
  assert.equal(other.style.color, painted(document, '#cc0000'));
  assert.equal(bar.style.color, before, 'the main box is not re-shifted by a private box restyle');
});

test('the hint line is always present', () => {
  const { document } = page();
  assert.equal(document.querySelector('.tdf-attach-hint')?.textContent, 'Shift+Enter for newline · Drag and drop images');
});

test('a dropped image shows a thumbnail; × removes it; non-images are ignored', () => {
  const { window, document, bar } = page();
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  drop(window, bar, new window.File(['x'], 'notes.txt', { type: 'text/plain' }));
  assert.equal(thumb.hidden, true);
  const event = drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  assert.equal(event.defaultPrevented, true);
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.title, 'cat.png');
  assert.equal(bar.classList.contains('tdf-attach-has'), true);
  thumb.querySelector('.tdf-attach-remove').click();
  assert.equal(thumb.hidden, true);
  assert.equal(bar.classList.contains('tdf-attach-has'), false);
});

test('Enter with an image pending uploads it publicly, then sends the text through Send', async () => {
  const { window, document, bar, state, win } = page();
  const calls = stubShare(win);
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  bar.value = 'look';
  enter(window, bar, false);
  assert.equal(state.sent, 0, 'the engine never saw the Enter');
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/forum\/chat\/plugins\/share\/$/);
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].url, /\/forum\/chat\/plugins\/share\/index\.php$/);
  const body = calls[1].body;
  assert.equal(body.get('shareID'), '1');
  assert.equal(body.get('shareWithUser'), '');
  assert.equal(body.get('MAX_FILE_SIZE'), '5000000');
  assert.equal(body.get('uploadedfile').name, 'cat.png');
  assert.equal(/** @type {any} */ (document.querySelector('.tdf-attach-thumb')).hidden, true);
  assert.equal(state.clicks, 1, 'the text goes through the engine Send');
});

test('an image alone sends nothing through the engine', async () => {
  const { window, bar, state, win } = page();
  stubShare(win);
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(state.clicks, 0);
  assert.equal(state.sent, 0);
});

test('Send with an image pending uploads it privately to the whispered user', async () => {
  const { window, document, bar, state, win } = page();
  const calls = stubShare(win);
  win.whisperUser('Alice');
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  /** @type {any} */ (document.getElementById('optionsSend')).click();
  assert.equal(state.clicks, 0, 'the engine Send did not run for the image');
  await settle();
  assert.match(calls[0].url, /shareWithUser=Alice$/);
  assert.equal(calls[1].body.get('shareID'), '2');
  assert.equal(calls[1].body.get('shareWithUser'), 'Alice');
});

test('a failed upload sends nothing and keeps the text and the thumbnail, marked failed', async () => {
  const { window, document, bar, state, win } = page();
  stubShare(win, { postBody: 'no access<div></div>' });
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  bar.value = 'look';
  enter(window, bar, false);
  await settle();
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.classList.contains('tdf-attach-failed'), true);
  assert.equal(thumb.title, 'Upload refused: not signed in to the chat');
  assert.equal(bar.value, 'look');
  assert.equal(state.clicks, 0);
  assert.equal(state.sent, 0);
});

test('a failing status or a missing form is a failed upload too', async () => {
  const { window, document, bar, win } = page();
  stubShare(win, { postStatus: 500 });
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  assert.equal(thumb.title, 'Upload failed (HTTP 500)');
  stubShare(win, { formBody: '<p>maintenance</p>' });
  enter(window, bar, false);
  await settle();
  assert.equal(thumb.title, 'Upload failed: the Share Files form was not found');
});

test('a mousedown outside the picker closes it; one inside does not', () => {
  const { window, document, win } = page();
  win.__test.openSmileyPicker({ x: 0, y: 0, onPick: () => {} });
  const picker = /** @type {any} */ (document.querySelector('.tdf-sm-picker'));
  picker.querySelector('.tdf-sm-item').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(picker.hidden, false);
  document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(picker.hidden, true);
});

test('a pick with no engine addsmiley inserts nothing and does not throw', () => {
  const { document, bar, win } = page();
  delete win.addsmiley;
  /** @type {any} */ (document.querySelector('.tdf-sm-button')).click();
  /** @type {any} */ (document.querySelector('.tdf-sm-item')).click();
  assert.equal(bar.value, '');
});

test('without #whisperID no chip is added and the engine functions stay unwrapped', () => {
  const window = new Window({ url: 'https://chat.example.com/forum/chat/' });
  const { document } = window;
  document.body.innerHTML = '<div id="chatContainer"></div><div><textarea id="optionsBar"></textarea></div>';
  const win = /** @type {any} */ (window);
  const original = () => {};
  win.whisperUser = original;
  window.eval(bundle);
  assert.equal(document.querySelector('.tdf-whisper-chip'), null);
  assert.equal(win.whisperUser, original);
  assert.ok(document.querySelector('.tdf-attach-icon'), 'the other pieces still install');
});

test('before the theme mounts the box keeps the engine colour', () => {
  const { document, bar, win } = page({ theme: null });
  win.changeMessBoxStyle('optionsBar');
  assert.equal(bar.style.color, painted(document, '#000080'));
});

test('Shift+Enter with an image pending inserts a newline and uploads nothing', async () => {
  const { window, bar, state, win } = page();
  const calls = stubShare(win);
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  const event = enter(window, bar, true);
  await settle();
  assert.equal(event.defaultPrevented, false);
  assert.equal(calls.length, 0);
  assert.equal(state.sent, 0);
});

test('a drag carrying a file outlines the box until it leaves; other drags do not', () => {
  const { window, bar } = page();
  const drag = (/** @type {string} */ type, /** @type {any} */ dataTransfer) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    bar.dispatchEvent(event);
    return event;
  };
  assert.equal(drag('dragover', { items: [{ kind: 'string' }] }).defaultPrevented, false);
  assert.equal(bar.classList.contains('tdf-attach-over'), false);
  const over = drag('dragover', { items: [{ kind: 'file' }], dropEffect: 'none' });
  assert.equal(over.defaultPrevented, true);
  assert.equal(bar.classList.contains('tdf-attach-over'), true);
  drag('dragleave', {});
  assert.equal(bar.classList.contains('tdf-attach-over'), false);
});

test('a second image replaces the pending one; a drop with no file is left alone', () => {
  const { window, document, bar } = page();
  drop(window, bar, new window.File(['x'], 'one.png', { type: 'image/png' }));
  drop(window, bar, new window.File(['y'], 'two.png', { type: 'image/png' }));
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  assert.equal(thumb.title, 'two.png');
  const empty = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(empty, 'dataTransfer', { value: { files: [] } });
  bar.dispatchEvent(empty);
  assert.equal(empty.defaultPrevented, false);
  assert.equal(thumb.title, 'two.png');
});

test('the upload icon opens the file chooser, and a chosen image attaches', () => {
  const { window, document } = page();
  const input = /** @type {any} */ (document.querySelector('input[type=file]'));
  let opened = 0;
  input.click = () => (opened += 1);
  /** @type {any} */ (document.querySelector('.tdf-attach-icon')).click();
  assert.equal(opened, 1);
  Object.defineProperty(input, 'files', { value: [new window.File(['x'], 'pick.png', { type: 'image/png' })] });
  input.dispatchEvent(new window.Event('change'));
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.title, 'pick.png');
});

test('with no Send button the text goes out through addMessage', async () => {
  const { window, document, bar, win } = page();
  document.getElementById('optionsSend')?.remove();
  stubShare(win);
  /** @type {string[][]} */
  const sent = [];
  win.addMessage = (/** @type {string} */ input, /** @type {string} */ display) => sent.push([input, display]);
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  bar.value = 'look';
  enter(window, bar, false);
  await settle();
  assert.deepEqual(sent, [['optionsBar', 'chatContainer']]);
});

test('a refused form page fails the upload before anything is posted', async () => {
  const { window, document, bar, win } = page();
  const calls = stubShare(win, { formBody: 'no access<div></div>' });
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(/** @type {any} */ (document.querySelector('.tdf-attach-thumb')).title, 'Upload refused: not signed in to the chat');
});

test('shareID radios named only by their labels, or absent, still choose the scope', async () => {
  const { window, bar, win } = page();
  let calls = stubShare(win, { formBody: '<form action="up.php"><input type="file" name="uploadedfile"></form>' });
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(calls[1].body.get('shareID'), 'public', 'no radios: the plain value');
  assert.equal(calls[1].body.get('submit'), null, 'no named submit button: none is sent');
  assert.match(calls[1].url, /\/plugins\/share\/up\.php$/);

  calls = stubShare(win, { formBody: '<form><label>Private <input type="radio" name="shareID" value="p"></label></form>' });
  win.whisperUser('Bob');
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(calls[1].body.get('shareID'), 'p', 'matched by its label');
});

test('while an upload is in flight, × and a second Enter do nothing', async () => {
  const { window, document, bar, win } = page();
  /** @type {(value: any) => void} */
  let release = () => {};
  let posts = 0;
  win.fetch = async (/** @type {any} */ _url, /** @type {any} */ init = {}) => {
    if (init.method !== 'POST') return new win.Response(FORM);
    posts += 1;
    await new Promise((r) => (release = r));
    return new win.Response('ok');
  };
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  assert.equal(thumb.classList.contains('tdf-attach-busy'), true);
  thumb.querySelector('.tdf-attach-remove').click();
  enter(window, bar, false);
  drop(window, bar, new window.File(['y'], 'other.png', { type: 'image/png' }));
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.title, 'cat.png');
  release(undefined);
  await settle();
  assert.equal(posts, 1);
  assert.equal(thumb.hidden, true);
});

test('a file that cannot attach says why on the hint line', async () => {
  const { window, document, bar, win } = page();
  const hint = /** @type {any} */ (document.querySelector('.tdf-attach-hint'));
  drop(window, bar, new window.File(['x'], 'notes.txt', { type: 'text/plain' }));
  assert.equal(hint.textContent, 'Only images can be attached: notes.txt');
  assert.equal(hint.classList.contains('tdf-attach-refused'), true);

  win.fetch = () => new Promise(() => {});
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  drop(window, bar, new window.File(['y'], 'other.png', { type: 'image/png' }));
  assert.equal(hint.textContent, 'An image is still uploading');
});

test('a drop of several images keeps the first and says so', () => {
  const { window, document, bar } = page();
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  const files = [new window.File(['x'], 'a.png', { type: 'image/png' }), new window.File(['y'], 'b.png', { type: 'image/png' })];
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  bar.dispatchEvent(event);
  assert.equal(/** @type {any} */ (document.querySelector('.tdf-attach-thumb')).title, 'a.png');
  assert.equal(document.querySelector('.tdf-attach-hint')?.textContent, 'One image at a time: the first was kept');
});

test('before the theme mounts nothing attaches and Enter reaches the engine', () => {
  const { window, document, bar, state } = page({ theme: null });
  const event = drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  assert.equal(event.defaultPrevented, false);
  assert.equal(/** @type {any} */ (document.querySelector('.tdf-attach-thumb')).hidden, true);
  enter(window, bar, false);
  assert.equal(state.sent, 1);
});

test('share requests never follow a redirect, give up on a stall, and say so', async () => {
  const { window, document, bar, win } = page();
  /** @type {any[]} */
  const inits = [];
  win.fetch = async (/** @type {any} */ _url, /** @type {any} */ init = {}) => {
    inits.push(init);
    return { status: 0, type: 'opaqueredirect', text: async () => '' };
  };
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(inits[0].redirect, 'manual');
  assert.ok(inits[0].signal, 'a timeout signal is attached');
  assert.equal(thumb.title, 'Upload refused: the Share Files plugin redirected (signed out of the chat?)');

  win.fetch = async () => {
    throw new win.DOMException('The operation timed out.', 'TimeoutError');
  };
  enter(window, bar, false);
  await settle();
  assert.equal(thumb.title, 'Upload failed: the Share Files plugin did not answer within 30 s');
  assert.equal(thumb.classList.contains('tdf-attach-failed'), true);
});

test('shareID is matched on value, id or a label naming only that radio; a private share fails closed', async () => {
  const { window, document, bar, win } = page();
  const thumb = /** @type {any} */ (document.querySelector('.tdf-attach-thumb'));
  /** @param {string} formBody */
  const send = async (formBody) => {
    const calls = stubShare(win, { formBody });
    drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
    enter(window, bar, false);
    await settle();
    return calls;
  };

  let calls = await send('<form><input type="radio" name="shareID" value="pub"><input type="radio" name="shareID" value="priv"></form>');
  assert.equal(calls[1].body.get('shareID'), 'pub', 'by value');

  win.whisperUser('Bob');
  calls = await send('<form><input type="radio" name="shareID" id="s-pub" value="1"><input type="radio" name="shareID" id="s-priv" value="2"></form>');
  assert.equal(calls[1].body.get('shareID'), '2', 'by id');

  calls = await send('<form><input type="radio" name="shareID" id="a" value="1"><label for="a">Public</label><input type="radio" name="shareID" id="b" value="2"><label for="b">Private</label></form>');
  assert.equal(calls[1].body.get('shareID'), '2', 'by label[for]');

  calls = await send('<form><label><input type="radio" name="shareID" value="1"> Public <input type="radio" name="shareID" value="2"> Private</label></form>');
  assert.equal(calls.length, 1, 'a label naming both radios names neither: nothing is posted');
  assert.equal(thumb.title, 'Upload failed: the Share Files form has no private choice');

  calls = await send('<form><input type="file" name="uploadedfile"></form>');
  assert.equal(calls.length, 1, 'no radios while whispering: nothing is posted');
  assert.equal(thumb.title, 'Upload failed: the Share Files form has no private choice');

  win.clearWhisper();
  calls = await send('<form><input type="radio" name="shareID" value="1"><input type="radio" name="shareID" value="2"></form>');
  assert.equal(calls.length, 1, 'radios that name nothing: nothing is posted');
  assert.equal(thumb.title, 'Upload failed: the Share Files form has no public choice');
});

// The live plugin's form as served (2026-10-28): radios valued 1/2, each named only by bare text
// in its own table cell, and a named submit button.
const LIVE_FORM = `<form style="padding: 0 0 0 3px;" enctype="multipart/form-data" name="upload" action="index.php" method="post">
    <table>
    <tbody><tr><td>Select who to share files with,</td></tr>
    <tr><td><input type="radio" name="shareID" value="1" checked="">Public - Share file with the Room? </td></tr>
    <tr><td><input type="radio" name="shareID" value="2">Private - Share file with another User?</td></tr>
    <tr><td>Enter User: <input class="sInput" type="text" name="shareWithUser" value=""></td></tr>
    <tr><td>&nbsp;</td></tr>
    <tr><td>Select a file to share,</td></tr>
    <tr><td><input class="sInput" type="file" id="uploadedfile" name="uploadedfile" size="15"></td></tr>
    <tr><td><input class="button" type="submit" name="submit" value="Upload File"></td></tr>
    </tbody></table>
</form>`;

test('the live Share Files form: scope is read from each radio\'s own cell, and the named submit is sent', async () => {
  const { window, bar, win } = page();
  let calls = stubShare(win, { formBody: LIVE_FORM });
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(calls.length, 2, 'the upload is posted');
  assert.equal(calls[1].body.get('shareID'), '1', 'public');
  assert.equal(calls[1].body.get('submit'), 'Upload File');
  assert.match(calls[1].url, /\/plugins\/share\/index\.php$/);

  calls = stubShare(win, { formBody: LIVE_FORM });
  win.whisperUser('Bob');
  drop(window, bar, new window.File(['x'], 'cat.png', { type: 'image/png' }));
  enter(window, bar, false);
  await settle();
  assert.equal(calls[1].body.get('shareID'), '2', 'private');
  assert.equal(calls[1].body.get('shareWithUser'), 'Bob');
});
