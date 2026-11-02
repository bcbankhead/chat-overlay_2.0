import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { HISTORY_OFF_KEY, historyOffNow, setHistoryOff } from '../src/core/historyMirror.js';

/** A window whose localStorage is replaced by `storage` (undefined removes it). */
function withStorage(/** @type {unknown} */ storage) {
  const win = /** @type {any} */ (new Window());
  Object.defineProperty(win, 'localStorage', { configurable: true, get: () => storage });
  return win;
}

test('absent, history reads as on; setHistoryOff writes the flag and clears it', () => {
  const win = /** @type {any} */ (new Window());
  assert.equal(historyOffNow(win), false);
  setHistoryOff(win, true);
  assert.equal(win.localStorage.getItem(HISTORY_OFF_KEY), '1');
  assert.equal(historyOffNow(win), true);
  setHistoryOff(win, false);
  assert.equal(win.localStorage.getItem(HISTORY_OFF_KEY), null);
  assert.equal(historyOffNow(win), false);
});

test('every read is fresh: a change on the page is seen at once', () => {
  const win = /** @type {any} */ (new Window());
  assert.equal(historyOffNow(win), false);
  win.localStorage.setItem(HISTORY_OFF_KEY, '1');
  assert.equal(historyOffNow(win), true);
});

test('only the exact value 1 reads as off', () => {
  for (const value of ['0', 'true', '', ' 1']) {
    const win = /** @type {any} */ (new Window());
    win.localStorage.setItem(HISTORY_OFF_KEY, value);
    assert.equal(historyOffNow(win), false, JSON.stringify(value));
  }
});

test('storage that is missing or throws reads as on', () => {
  assert.equal(historyOffNow(withStorage(undefined)), false);
  assert.equal(historyOffNow(withStorage(null)), false);
  const throwing = /** @type {any} */ (new Window());
  Object.defineProperty(throwing, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });
  assert.equal(historyOffNow(throwing), false);
  const getItemThrows = withStorage({
    getItem() {
      throw new Error('denied');
    },
  });
  assert.equal(historyOffNow(getItemThrows), false);
});

test('setHistoryOff throws when storage is missing or refuses the write', () => {
  assert.throws(() => setHistoryOff(withStorage(undefined), true), /storage is unavailable/);
  const refusing = withStorage({
    setItem() {
      throw new Error('quota exceeded');
    },
  });
  assert.throws(() => setHistoryOff(refusing, true), /quota exceeded/);
});
