import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const settle = () => new Promise((r) => setTimeout(r, 20));

/** @type {string} */
let bundle;
/** @type {string} */
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tdf-composer-'));
  const outfile = path.join(dir, 'composer.js');
  await esbuild.build({
    entryPoints: [path.join(here, 'index.js')],
    bundle: true,
    format: 'iife',
    loader: { '.css': 'text' },
    outfile,
    logLevel: 'warning',
  });
  bundle = readFileSync(outfile, 'utf8');
});

after(() => rmSync(dir, { recursive: true, force: true }));

/** A page with the engine's composer; `sent` counts submitenter's sends. */
function page({ overlay = false, chat = true } = {}) {
  const window = new Window({ url: 'https://dollforum.com/forum/chat/' });
  const { document } = window;
  document.body.innerHTML = chat ? '<div id="chatContainer"></div><textarea id="optionsBar"></textarea>' : '<textarea id="optionsBar"></textarea>';
  const bar = /** @type {any} */ (document.getElementById('optionsBar'));
  const state = { sent: 0 };
  // Stands in for the inline onkeypress="return submitenter(...)", which sends on any Enter.
  bar.addEventListener('keypress', (/** @type {any} */ e) => {
    if (e.keyCode === 13) {
      state.sent += 1;
      e.preventDefault();
    }
  });
  if (overlay) {
    const root = document.createElement('div');
    root.id = 'tdf-chat';
    document.documentElement.dataset.tdfTheme = 'dark';
    document.body.appendChild(root);
  }
  window.eval(bundle);
  return { window, document, bar, state };
}

/** @param {any} window @param {boolean} shiftKey */
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

test('the composer takes the overlay theme once #tdf-chat mounts, and follows it on <html>', async () => {
  const { document, bar } = page();
  const html = document.documentElement;
  html.dataset.tdfTheme = 'light';
  await settle();
  assert.equal(bar.dataset.tdfTheme, undefined, 'not themed before the overlay mounts');
  const root = document.createElement('div');
  root.id = 'tdf-chat';
  document.body.appendChild(root);
  await settle();
  assert.equal(bar.dataset.tdfTheme, 'light');
  assert.ok(document.getElementById('tdf-composer-style')?.textContent?.includes('#optionsBar[data-tdf-theme]'));
  html.dataset.tdfTheme = 'dark';
  await settle();
  assert.equal(bar.dataset.tdfTheme, 'dark');
});

test('a second copy of the script installs nothing twice', () => {
  const { window, bar } = page({ overlay: true });
  window.eval(bundle);
  bar.value = 'docs';
  bar.setSelectionRange(0, 4);
  paste(window, bar, 'https://example.com/');
  assert.equal(bar.value, '[[a href=//example.com/ target=_blank]]docs[[/a]]');
  assert.equal(window.document.querySelectorAll('#tdf-composer-style').length, 1);
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

test('the composer is not themed while <html> has no theme', async () => {
  const { document, bar } = page();
  const root = document.createElement('div');
  root.id = 'tdf-chat';
  document.body.appendChild(root);
  await settle();
  assert.equal(bar.dataset.tdfTheme, undefined);
  document.documentElement.dataset.tdfTheme = 'dark';
  await settle();
  assert.equal(bar.dataset.tdfTheme, 'dark');
});

test('a page without the chat installs no theme and observes nothing', async () => {
  const { document, bar } = page({ chat: false });
  const root = document.createElement('div');
  root.id = 'tdf-chat';
  document.documentElement.dataset.tdfTheme = 'dark';
  document.body.appendChild(root);
  await settle();
  assert.equal(bar.dataset.tdfTheme, undefined);
  assert.equal(document.getElementById('tdf-composer-style'), null);
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

test('every theme token the composer copies is defined by both themes in theme.css', () => {
  const source = readFileSync(path.join(here, 'index.js'), 'utf8');
  const list = /const TOKENS = \[([^\]]*)\]/.exec(source)?.[1];
  assert.ok(list, 'TOKENS not found in index.js');
  const tokens = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(tokens.length > 0);
  const theme = readFileSync(path.join(here, '..', '..', 'core', 'theme.css'), 'utf8');
  for (const name of ['light', 'dark']) {
    const block = new RegExp(`:root\\[data-tdf-theme="${name}"\\] \\{([^}]*)\\}`).exec(theme)?.[1];
    assert.ok(block, `no ${name} block in theme.css`);
    for (const token of tokens) assert.match(block, new RegExp(`${token}:`), `${token} missing from ${name}`);
  }
});

test('the sender colour sets the ink class, and follows the engine restyling it', async () => {
  const { bar } = page({ overlay: true });
  bar.style.color = '#000000';
  await settle();
  assert.equal(bar.dataset.tdfInk, 'tdf-ink-dark');
  bar.style.color = '#ffffff';
  await settle();
  assert.equal(bar.dataset.tdfInk, 'tdf-ink-light');
  bar.style.color = '#808080';
  await settle();
  assert.equal(bar.dataset.tdfInk, '');
});
