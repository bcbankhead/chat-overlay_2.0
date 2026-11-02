import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { OFF_KEY, SWITCH_ID, chat2Off, installSwitchLink, setChat2Off } from '../src/core/optOut.js';

/** A window whose localStorage is replaced by `storage` (undefined removes it). */
function withStorage(/** @type {unknown} */ storage) {
  const win = /** @type {any} */ (new Window());
  Object.defineProperty(win, 'localStorage', { configurable: true, get: () => storage });
  return win;
}

/** A chat page, with location.reload recorded. */
function chatPage({ chat = true } = {}) {
  const win = /** @type {any} */ (new Window());
  win.document.body.innerHTML = chat ? '<div id="chatContainer"></div>' : '<p>login</p>';
  let reloads = 0;
  win.location.reload = () => {
    reloads += 1;
  };
  return { win, doc: win.document, reloads: () => reloads };
}

test('absent, 2.0 is on; setChat2Off writes the flag and clears it', () => {
  const win = /** @type {any} */ (new Window());
  assert.equal(chat2Off(win), false);
  setChat2Off(win, true);
  assert.equal(win.localStorage.getItem(OFF_KEY), '1');
  assert.equal(chat2Off(win), true);
  setChat2Off(win, false);
  assert.equal(win.localStorage.getItem(OFF_KEY), null);
  assert.equal(chat2Off(win), false);
});

test('only the exact value 1 reads as off', () => {
  for (const value of ['0', 'true', '', ' 1']) {
    const win = /** @type {any} */ (new Window());
    win.localStorage.setItem(OFF_KEY, value);
    assert.equal(chat2Off(win), false, JSON.stringify(value));
  }
});

test('the first read holds for the page, whatever another tab writes after it', () => {
  const win = /** @type {any} */ (new Window());
  assert.equal(chat2Off(win), false);
  win.localStorage.setItem(OFF_KEY, '1');
  assert.equal(chat2Off(win), false);

  const off = /** @type {any} */ (new Window());
  off.localStorage.setItem(OFF_KEY, '1');
  assert.equal(chat2Off(off), true);
  off.localStorage.removeItem(OFF_KEY);
  assert.equal(chat2Off(off), true);
});

test('a read that throws is not retried on the same page', () => {
  let reads = 0;
  const win = withStorage({
    getItem() {
      reads += 1;
      throw new Error('denied');
    },
  });
  assert.equal(chat2Off(win), false);
  assert.equal(chat2Off(win), false);
  assert.equal(reads, 1);
});

test('storage that is missing or throws reads as on', () => {
  assert.equal(chat2Off(withStorage(undefined)), false);
  assert.equal(chat2Off(withStorage(null)), false);
  const throwing = /** @type {any} */ (new Window());
  Object.defineProperty(throwing, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });
  assert.equal(chat2Off(throwing), false);
  const getItemThrows = withStorage({
    getItem() {
      throw new Error('denied');
    },
  });
  assert.equal(chat2Off(getItemThrows), false);
});

test('setChat2Off throws when storage is missing or refuses the write', () => {
  assert.throws(() => setChat2Off(withStorage(undefined), true), /storage is unavailable/);
  const refusing = withStorage({
    setItem() {
      throw new Error('quota exceeded');
    },
  });
  assert.throws(() => setChat2Off(refusing, true), /quota exceeded/);
});

test('the switch link is added once, in a fixed corner, on a chat page only', () => {
  const { win, doc } = chatPage();
  installSwitchLink(doc, win);
  installSwitchLink(doc, win);
  const links = doc.querySelectorAll(`#${SWITCH_ID}`);
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'Switch to Chat 2.0');
  assert.match(links[0].getAttribute('style') ?? '', /position:\s*fixed/);

  const other = chatPage({ chat: false });
  installSwitchLink(other.doc, other.win);
  assert.equal(other.doc.getElementById(SWITCH_ID), null);
});

test('while loading, the link waits for the markup', () => {
  const { win, doc } = chatPage();
  Object.defineProperty(doc, 'readyState', { configurable: true, get: () => 'loading' });
  installSwitchLink(doc, win);
  assert.equal(doc.getElementById(SWITCH_ID), null);
  doc.dispatchEvent(new win.Event('DOMContentLoaded'));
  assert.ok(doc.getElementById(SWITCH_ID));
});

test('clicking the link clears the flag and reloads', () => {
  const { win, doc, reloads } = chatPage();
  setChat2Off(win, true);
  installSwitchLink(doc, win);
  const link = /** @type {HTMLAnchorElement} */ (doc.getElementById(SWITCH_ID));
  const click = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(win.localStorage.getItem(OFF_KEY), null);
  assert.equal(reloads(), 1);
});

test('a link click whose write fails says so and does not reload', () => {
  const { win, doc, reloads } = chatPage();
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => '1',
      setItem: () => {},
      removeItem: () => {
        throw new Error('denied');
      },
    },
  });
  installSwitchLink(doc, win);
  const link = /** @type {HTMLAnchorElement} */ (doc.getElementById(SWITCH_ID));
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(reloads(), 0);
  assert.equal(link.textContent, 'Could not switch: denied');
});

test('a link click whose write throws a non-Error says so readably', () => {
  const { win, doc, reloads } = chatPage();
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => '1',
      setItem: () => {},
      removeItem: () => {
        throw { code: 22 };
      },
    },
  });
  installSwitchLink(doc, win);
  const link = /** @type {HTMLAnchorElement} */ (doc.getElementById(SWITCH_ID));
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(reloads(), 0);
  assert.equal(link.textContent, 'Could not switch: {"code":22}');
});
