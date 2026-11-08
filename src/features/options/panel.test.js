import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { openDb } from '../../core/db.js';
import { onClearView, onDeleted } from '../../core/events.js';
import { createLimits } from './limits.js';
import { renderSettings } from './panel.js';
import { MB_BYTES } from './selectors.js';

const settle = () => new Promise((r) => setTimeout(r, 20));

// The Media and Gallery Settings switch rows, in DOM order. The Chat section's switches (Use Chat
// 2.0, Auto-scroll, Collapse server history automatically) are tested on their own.
function mediaSwitches(/** @type {HTMLElement} */ container) {
  const media = container.querySelectorAll('.tdf-opt-section')[1];
  /** @type {HTMLInputElement[]} */
  const boxes = [];
  for (let node = media?.nextElementSibling; node; node = node.nextElementSibling) {
    const box = node.matches('label.tdf-opt-row') ? node.querySelector('input.tdf-opt-switch') : null;
    if (box) boxes.push(/** @type {HTMLInputElement} */ (box));
  }
  return boxes;
}
const AUTOSCROLL = 'input.tdf-opt-autoscroll';
const HISTORY = 'Chat history (last 25)';

/** A settings stand-in over a plain object; `fail` makes every read reject, `failWrite` every write. */
function stubSettings(values = {}, { fail = false, failWrite = false } = {}) {
  /** @type {Record<string, unknown>} */
  const store = {
    historyCount: 25,
    galleryLimitMB: null,
    includeMyImages: false,
    storeImagesOffline: false,
    autoCollapseServerHistory: false,
    compressStoredImages: false,
    useMediaQuickview: true,
    ...values,
  };
  /** @type {unknown[][]} */
  const writes = [];
  return {
    writes,
    store,
    async get(/** @type {string} */ key) {
      if (fail) throw new Error('read failed');
      return store[key];
    },
    async set(/** @type {string} */ key, /** @type {unknown} */ value) {
      if (failWrite) throw new Error('write failed');
      writes.push([key, value]);
      store[key] = value;
    },
  };
}

/**
 * The checkbox of the row with this label: rows are told apart by label, not position.
 * @param {HTMLElement} container
 * @param {string} label
 */
function boxFor(container, label) {
  const row = [...container.querySelectorAll('label.tdf-opt-row')].find((r) => r.textContent === label);
  return /** @type {HTMLInputElement} */ (row?.querySelector('input.tdf-opt-switch'));
}

/**
 * A limits stand-in: gallery previews report `images`, prunes and deletions are recorded.
 * `stored` is the saved history's line count by sender, which Clear and delete-by-user empty.
 */
function stubLimits({ images = 0, failPrune = false, stored = {}, failDelete = false } = {}) {
  /** @type {unknown[][]} */
  const calls = [];
  /** @type {Record<string, number>} */
  const history = { ...stored };
  const total = () => Object.values(history).reduce((a, b) => a + b, 0);
  const ids = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => String(i));
  return {
    calls,
    async countAll() {
      calls.push(['countAll']);
      return total();
    },
    async clearHistory() {
      calls.push(['clearHistory']);
      if (failDelete) throw new Error('delete failed');
      const n = total();
      for (const user of Object.keys(history)) delete history[user];
      return ids(n);
    },
    async senders() {
      calls.push(['senders']);
      return Object.entries(history).map(([user, count]) => ({ user, count }));
    },
    async countByUser(/** @type {string} */ user) {
      calls.push(['countByUser', user]);
      return history[user] ?? 0;
    },
    async deleteByUser(/** @type {string} */ user) {
      calls.push(['deleteByUser', user]);
      if (failDelete) throw new Error('delete failed');
      const n = history[user] ?? 0;
      delete history[user];
      return ids(n);
    },
    async pruneHistory(/** @type {number | null} */ days) {
      calls.push(['pruneHistory', days]);
      if (failPrune) throw new Error('prune failed');
      return [];
    },
    async previewGallery(/** @type {number | null} */ mb) {
      calls.push(['previewGallery', mb]);
      return { used: 3 * MB_BYTES, preview: mb === null ? null : { ids: [], count: images, bytes: images * MB_BYTES } };
    },
    async pruneGallery(/** @type {number | null} */ mb) {
      calls.push(['pruneGallery', mb]);
      return [];
    },
  };
}

function setup({ settings = stubSettings(), limits = stubLimits(), engine = true, loadFailure = undefined, prepare = (/** @type {any} */ _win) => {} } = {}) {
  const win = /** @type {any} */ (new Window());
  prepare(win);
  const doc = win.document;
  doc.body.innerHTML =
    (engine ? '<input type="checkbox" id="autoScrollID" checked>' : '') +
    '<div id="tdf-chat"><div class="tdf-list"><div class="tdf-msg" data-id="a"></div><div class="tdf-msg" data-id="b"></div></div></div>';
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const cleanup = renderSettings(container, {
    doc,
    win,
    settings: /** @type {any} */ (settings),
    limits: /** @type {any} */ (limits),
    ...(loadFailure ? { loadFailure } : {}),
  });
  // The Chat history switch (Chat, TDF-0033.5) precedes the gallery limit (Media and Gallery
  // Settings) in the DOM (TDF-0044); the gallery limit is the one number field left.
  const history = boxFor(container, HISTORY);
  const gallery = /** @type {HTMLInputElement} */ (container.querySelector('.tdf-opt-field input'));
  const hints = () => [history, gallery].map((input) => input.closest('label')?.nextElementSibling?.textContent);
  /** Tick or untick Chat history, as the member does. @param {boolean} on */
  const toggle = (on) => {
    history.checked = on;
    history.dispatchEvent(new win.Event('change'));
  };
  /** @param {HTMLInputElement} input @param {string} value @param {'input' | 'change'} type */
  const type = (input, value, typeName = 'input') => {
    input.value = value;
    input.dispatchEvent(new win.Event(typeName));
  };
  return { win, doc, container, cleanup, history, gallery, hints, type, toggle, settings, limits };
}

// TDF-0033.5, TDF-0056: Chat history (last 25), a switch over historyCount.

const ON_HINT = 'Replays the newest 25 lines on reload.';
const OFF_HINT = 'No chat history is kept or replayed.';

test('Chat history is a switch, on, replaying the newest 25 with no deletion count, whatever is stored', async () => {
  const { history, gallery, hints } = setup({
    settings: stubSettings({ historyCount: 25, galleryLimitMB: 50 }),
    limits: stubLimits({ stored: { a: 2, b: 1 } }),
  });
  await settle();
  assert.equal(history.type, 'checkbox');
  assert.ok(history.classList.contains('tdf-opt-switch'));
  assert.equal(history.checked, true);
  assert.equal(gallery.value, '50');
  assert.deepEqual(hints(), [
    ON_HINT,
    '3.0 MB used; favorites kept; oldest over-limit purged when set and on reload.',
  ]);
});

test('Chat history stored off shows the switch unticked: nothing is kept', async () => {
  const { history, hints } = setup({ settings: stubSettings({ historyCount: 0 }), limits: stubLimits({ stored: { a: 2 } }) });
  await settle();
  assert.equal(history.checked, false);
  assert.equal(hints()[0], OFF_HINT);
});

test('a settings read that fails is shown under both the Chat history switch and the gallery field', async () => {
  const { history, gallery, hints } = setup({ settings: stubSettings({}, { fail: true }) });
  await settle();
  // The rows sit in different sections (TDF-0044), so each must say why it is empty.
  assert.deepEqual(hints(), ['Could not read settings: read failed', 'Could not read settings: read failed']);
  for (const input of [history, gallery]) {
    assert.ok(input.closest('label')?.nextElementSibling?.classList.contains('tdf-warn'));
  }
});

test('unticking Chat history writes 0, then deletes every saved line, and says nothing is kept', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { hints, toggle, settings } = setup({ limits });
  await settle();
  limits.calls.length = 0;
  toggle(false);
  await settle();
  assert.deepEqual(settings.writes, [['historyCount', 0]]);
  assert.deepEqual(deletions(limits), [['clearHistory']]);
  assert.ok(!limits.calls.some(([name]) => name === 'pruneHistory'));
  assert.equal(hints()[0], OFF_HINT);
});

test('ticking Chat history writes 25 and deletes nothing', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { hints, toggle, settings } = setup({ settings: stubSettings({ historyCount: 0 }), limits });
  await settle();
  toggle(true);
  await settle();
  assert.deepEqual(settings.writes, [['historyCount', 25]]);
  assert.deepEqual(deletions(limits), []);
  assert.equal(hints()[0], ON_HINT);
});

test('a refused Chat history write puts the switch back, deletes nothing and says so', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { history, hints, toggle } = setup({ settings: stubSettings({}, { failWrite: true }), limits });
  await settle();
  toggle(false);
  await settle();
  assert.equal(history.checked, true);
  assert.deepEqual(deletions(limits), []);
  assert.equal(hints()[0], 'Could not apply: write failed');
});

test('a quick off-then-on writes both, and the stale untick deletes nothing', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { history, toggle, settings } = setup({ limits });
  await settle();
  toggle(false);
  toggle(true);
  await settle();
  assert.deepEqual(settings.writes, [['historyCount', 0], ['historyCount', 25]]);
  assert.deepEqual(deletions(limits), []);
  assert.equal(history.checked, true);
});

test('refused writes on a quick off-then-on leave the switch showing the stored value', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { history, toggle } = setup({ settings: stubSettings({}, { failWrite: true }), limits });
  await settle();
  toggle(false);
  toggle(true);
  await settle();
  assert.equal(history.checked, true, 'stored 25: on');
  assert.deepEqual(deletions(limits), []);
});

test('a deletion that fails on unticking says so under the switch', async () => {
  const { hints, toggle } = setup({ limits: stubLimits({ stored: { a: 2 }, failDelete: true }) });
  await settle();
  toggle(false);
  await settle();
  assert.equal(hints()[0], 'Could not apply: delete failed');
});

test('typing a gallery limit previews what would be deleted and writes nothing', async () => {
  const { gallery, hints, type, settings, limits } = setup({ limits: stubLimits({ images: 2 }) });
  await settle();
  type(gallery, '10');
  await settle();
  assert.equal(hints()[1], '3.0 MB used; favorites kept; oldest over-limit purged when set and on reload. Removes 2 images (2.0 MB) now.');
  assert.ok(gallery.closest('label')?.nextElementSibling?.classList.contains('tdf-warn'));
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('an invalid gallery limit is refused in the hint, and committing it does nothing', async () => {
  const { gallery, hints, type, settings, limits } = setup();
  await settle();
  type(gallery, '0');
  await settle();
  assert.equal(hints()[1], 'Enter 1 MB or more, or leave empty for no limit.');
  type(gallery, '0', 'change');
  await settle();
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('a number the browser cannot parse is refused, not read as empty', async () => {
  const { gallery, hints, type, settings, limits } = setup({ settings: stubSettings({ galleryLimitMB: 50 }) });
  await settle();
  Object.defineProperty(gallery, 'validity', { value: { badInput: true } });
  type(gallery, '');
  await settle();
  assert.equal(hints()[1], 'Enter 1 MB or more, or leave empty for no limit.');
  type(gallery, '', 'change');
  await settle();
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('committing the gallery limit writes the setting, then applies the limit', async () => {
  const { gallery, type, settings, limits } = setup();
  await settle();
  type(gallery, '', 'change');
  await settle();
  assert.deepEqual(settings.writes, [['galleryLimitMB', null]]);
  assert.ok(limits.calls.some(([n, v]) => n === 'pruneGallery' && v === null));
});

test('Auto-scroll mirrors the engine checkbox both ways, and stops following on close', async () => {
  const { win, doc, container, cleanup } = setup();
  const mine = /** @type {HTMLInputElement} */ (container.querySelector(AUTOSCROLL));
  const engine = /** @type {HTMLInputElement} */ (doc.getElementById('autoScrollID'));
  assert.equal(mine.checked, true);
  let engineChanges = 0;
  engine.addEventListener('change', () => engineChanges++);

  mine.checked = false;
  mine.dispatchEvent(new win.Event('change'));
  assert.equal(engine.checked, false);
  assert.equal(engineChanges, 1);

  engine.checked = true;
  engine.dispatchEvent(new win.Event('change'));
  assert.equal(mine.checked, true);

  cleanup();
  engine.checked = false;
  engine.dispatchEvent(new win.Event('change'));
  assert.equal(mine.checked, true);
});

test('without the engine checkbox the Auto-scroll switch is disabled', () => {
  const { container } = setup({ engine: false });
  assert.equal(/** @type {HTMLInputElement} */ (container.querySelector(AUTOSCROLL)).disabled, true);
});

test('Clear chat buffer calls the engine clrScreen and clears the view through core', (t) => {
  const { win, doc, container } = setup();
  let cleared = 0;
  win.clrScreen = () => cleared++;
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  /** @type {HTMLButtonElement} */ (container.querySelector('.tdf-opt-clear')).click();
  assert.equal(cleared, 1);
  assert.equal(viewCleared, 1);
  // The panel no longer removes the view's rows behind its back.
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 2);
});

test('Clear chat buffer without the engine clrScreen still clears the view', (t) => {
  const { container } = setup();
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  /** @type {HTMLButtonElement} */ (container.querySelector('.tdf-opt-clear')).click();
  assert.equal(viewCleared, 1);
});

test('the gallery hint makes one usage read per keystroke', async () => {
  const { gallery, type, limits } = setup({ settings: stubSettings({ galleryLimitMB: 50 }) });
  await settle();
  limits.calls.length = 0;
  type(gallery, '10');
  await settle();
  assert.deepEqual(limits.calls, [['previewGallery', 10]]);
});

test('a load-time limit failure is shown at the top of the flyout; none shows nothing', () => {
  const failed = setup({ loadFailure: () => 'disk full' });
  const warn = failed.container.querySelector('.tdf-opt-title + .tdf-opt-hint.tdf-warn');
  assert.equal(warn?.textContent, 'The storage limits did not run on load: disk full');
  const fine = setup();
  assert.equal(fine.container.querySelector('.tdf-opt-title + .tdf-opt-hint'), null);
});

test('a hint read that resolves after close is not written', async () => {
  const { cleanup, hints, gallery, type } = setup();
  await settle();
  const shown = hints();
  type(gallery, '3');
  cleanup();
  await settle();
  assert.deepEqual(hints(), shown);
});

test('Include my images is a switch row opening Media and Gallery Settings, showing the stored value', async () => {
  for (const on of [false, true]) {
    const { container } = setup({ settings: stubSettings({ includeMyImages: on }) });
    await settle();
    const box = /** @type {HTMLInputElement} */ (boxFor(container, 'Include my images'));
    assert.equal(box.type, 'checkbox');
    assert.equal(box.classList.contains('tdf-opt-switch'), true);
    assert.equal(box.checked, on);
    const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
    assert.equal(row.textContent, 'Include my images');
    // Directly after the section header.
    const before = row.previousElementSibling;
    assert.ok(before?.classList.contains('tdf-opt-section'));
    assert.equal(before?.textContent, 'Media and Gallery Settings');
  }
});

test('toggling Include my images writes the setting; a failed write says so', async () => {
  const settings = stubSettings();
  const { win, container } = setup({ settings });
  await settle();
  const box = /** @type {HTMLInputElement} */ (boxFor(container, 'Include my images'));
  box.checked = true;
  box.dispatchEvent(new win.Event('change'));
  await settle();
  assert.deepEqual(settings.writes, [['includeMyImages', true]]);

  settings.set = async () => {
    throw new Error('write failed');
  };
  box.checked = false;
  box.dispatchEvent(new win.Event('change'));
  await settle();
  const hint = /** @type {HTMLElement} */ (box.closest('label')?.nextElementSibling);
  assert.equal(hint.textContent, 'Could not apply: write failed');
});

test('an Include my images read that fails says so under the checkbox row', async () => {
  const { container } = setup({ settings: stubSettings({}, { fail: true }) });
  await settle();
  const box = /** @type {HTMLInputElement} */ (boxFor(container, 'Include my images'));
  const hint = /** @type {HTMLElement} */ (box.closest('label')?.nextElementSibling);
  assert.equal(hint.textContent, 'Could not read settings: read failed');
});

test('an Include my images read or failed write that settles after close is not written', async () => {
  /** @type {(v: boolean) => void} */
  let resolveRead = () => {};
  /** @type {(e: Error) => void} */
  let rejectWrite = () => {};
  const settings = stubSettings();
  const read = settings.get;
  settings.get = async (key) => (key === 'includeMyImages' ? new Promise((r) => (resolveRead = r)) : read(key));
  settings.set = () => new Promise((_, reject) => (rejectWrite = reject));
  const { win, container, cleanup } = setup({ settings });
  await settle();
  const box = /** @type {HTMLInputElement} */ (boxFor(container, 'Include my images'));
  const hint = /** @type {HTMLElement} */ (box.closest('label')?.nextElementSibling);
  box.dispatchEvent(new win.Event('change'));
  cleanup();
  resolveRead(true);
  rejectWrite(new Error('write failed'));
  await settle();
  assert.equal(box.checked, false);
  assert.equal(hint.textContent, '');
});

test('Store images offline is a checkbox row after Include my images, showing and writing the setting', async () => {
  const settings = stubSettings({ storeImagesOffline: true });
  const { win, container } = setup({ settings });
  await settle();
  const mine = boxFor(container, 'Include my images');
  const offline = boxFor(container, 'Store images offline');
  const row = /** @type {HTMLElement} */ (offline.closest('label.tdf-opt-row'));
  assert.equal(row.textContent, 'Store images offline');
  assert.equal(row.previousElementSibling?.previousElementSibling, mine.closest('label'));
  assert.equal(offline.checked, true);
  offline.checked = false;
  offline.dispatchEvent(new win.Event('change'));
  await settle();
  assert.deepEqual(settings.writes, [['storeImagesOffline', false]]);

  settings.set = async () => {
    throw new Error('write failed');
  };
  offline.checked = true;
  offline.dispatchEvent(new win.Event('change'));
  await settle();
  assert.equal(/** @type {HTMLElement} */ (row.nextElementSibling).textContent, 'Could not apply: write failed');
});

test('Compress stored images is a checkbox row after Store images offline, showing and writing the setting', async () => {
  for (const on of [true, false]) {
    const settings = stubSettings({ compressStoredImages: on });
    const { win, container } = setup({ settings });
    await settle();
    const boxes = mediaSwitches(container);
    const box = boxes[2];
    const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
    assert.equal(row.textContent, 'Compress stored images');
    assert.equal(row.previousElementSibling?.previousElementSibling, boxes[1].closest('label'));
    assert.equal(box.checked, on);
    box.checked = !on;
    box.dispatchEvent(new win.Event('change'));
    await settle();
    assert.deepEqual(settings.writes, [['compressStoredImages', !on]]);
  }
});

test('Use media quickview is a switch row after Compress stored images, followed by the gallery limit, showing and writing it', async () => {
  for (const on of [true, false]) {
    const settings = stubSettings({ useMediaQuickview: on });
    const { win, container, gallery } = setup({ settings });
    await settle();
    const boxes = mediaSwitches(container);
    assert.equal(boxes.length, 4);
    const box = boxes[3];
    const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
    assert.equal(row.textContent, 'Use media quickview');
    assert.equal(row.previousElementSibling?.previousElementSibling, boxes[2].closest('label'));
    assert.equal(row.nextElementSibling?.nextElementSibling, gallery.closest('label'));
    assert.equal(box.checked, on);
    box.checked = !on;
    box.dispatchEvent(new win.Event('change'));
    await settle();
    assert.deepEqual(settings.writes, [['useMediaQuickview', !on]]);
  }
});

/** @param {HTMLElement} container @param {string} text */
const button = (container, text) =>
  /** @type {HTMLButtonElement} */ ([...container.querySelectorAll('button')].find((b) => b.textContent === text));

/** The Clear history now control: its button, its confirm row and its hint. */
const clearControl = (/** @type {HTMLElement} */ container) => {
  const clear = button(container, 'Clear history now');
  const ask = /** @type {HTMLElement} */ (clear.nextElementSibling);
  const hint = /** @type {HTMLElement} */ (ask.nextElementSibling);
  return { clear, ask, hint, yes: button(ask, 'Confirm'), no: button(ask, 'Cancel') };
};

/** The Hide messages by user control. */
const senderControl = (/** @type {HTMLElement} */ container) => {
  const select = /** @type {HTMLSelectElement} */ (container.querySelector('.tdf-opt-sender select'));
  const remove = /** @type {HTMLButtonElement} */ (select.closest('label')?.nextElementSibling);
  const ask = /** @type {HTMLElement} */ (remove.nextElementSibling);
  const hint = /** @type {HTMLElement} */ (ask.nextElementSibling);
  return { select, remove, ask, hint, yes: button(ask, 'Confirm'), no: button(ask, 'Cancel') };
};

const deletions = (/** @type {{ calls: unknown[][] }} */ limits) =>
  limits.calls.filter(([name]) => name === 'clearHistory' || name === 'deleteByUser');

test('Clear history now and Hide messages by user sit after the Chat history switch', () => {
  const { container } = setup();
  const { clear } = clearControl(container);
  const historyHint = /** @type {HTMLElement} */ (clear.previousElementSibling);
  assert.match(String(historyHint.previousElementSibling?.textContent), /Chat history/);
  const { remove, hint } = senderControl(container);
  assert.match(String(remove.previousElementSibling?.textContent), /^Hide messages by user/);
  // Hide messages by user closes the Chat section (TDF-0044).
  const next = hint.nextElementSibling;
  assert.ok(next?.classList.contains('tdf-opt-section'));
  assert.equal(next?.textContent, 'Media and Gallery Settings');
});

test('Clear history now asks with the count first; Cancel deletes nothing', async () => {
  const limits = stubLimits({ stored: { a: 2, b: 1 } });
  const { container } = setup({ limits });
  const { clear, ask, no } = clearControl(container);
  assert.equal(ask.hidden, true);
  clear.click();
  await settle();
  assert.equal(clear.hidden, true);
  assert.equal(ask.hidden, false);
  assert.equal(ask.querySelector('span')?.textContent, 'Delete 3 messages?');
  no.click();
  assert.equal(ask.hidden, true);
  assert.equal(clear.hidden, false);
  assert.equal(clear.disabled, false);
  assert.deepEqual(deletions(limits), []);
});

test('Confirm clears the history once and the hint reports the count', async () => {
  const limits = stubLimits({ stored: { a: 2, b: 1 } });
  const { container } = setup({ limits });
  const { clear, ask, yes, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  yes.click();
  await settle();
  assert.deepEqual(deletions(limits), [['clearHistory']]);
  assert.equal(hint.textContent, 'Deleted 3 messages.');
  assert.equal(ask.hidden, true);
  assert.equal(clear.hidden, false);
  // The sender list follows: nothing is left to pick.
  assert.equal(senderControl(container).select.disabled, true);
});

test('Clear history now over no saved history says so and asks nothing', async () => {
  const limits = stubLimits();
  const { container } = setup({ limits });
  const { clear, ask, hint } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(ask.hidden, true);
  assert.equal(hint.textContent, 'No saved history.');
  assert.deepEqual(deletions(limits), []);
});

// TDF-0054: with Chat history off the lines on screen were never saved, so Clear says so.
const OFF_CLEAR = 'Chat history is off, so nothing is saved. Clear chat buffer empties the lines on screen.';

test('Clear history now with Chat history stored off says nothing is saved and points to Clear chat buffer', async () => {
  const limits = stubLimits();
  const { container } = setup({ settings: stubSettings({ historyCount: 0 }), limits });
  await settle();
  const { clear, ask, hint } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(ask.hidden, true);
  assert.equal(hint.textContent, OFF_CLEAR);
  assert.deepEqual(deletions(limits), []);
});

test('Clear history now follows the Chat history switch: off, then on again', async () => {
  const limits = stubLimits();
  const { container, toggle } = setup({ limits });
  await settle();
  const { clear, hint } = clearControl(container);
  toggle(false);
  await settle();
  clear.click();
  await settle();
  assert.equal(hint.textContent, OFF_CLEAR);
  toggle(true);
  await settle();
  clear.click();
  await settle();
  assert.equal(hint.textContent, 'No saved history.');
});

test('a refused Chat history untick leaves Clear history now reading history as on', async () => {
  const settings = stubSettings({}, { failWrite: true });
  const { container, toggle } = setup({ settings });
  await settle();
  toggle(false);
  await settle();
  const { clear, hint } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(hint.textContent, 'No saved history.');
});

test('closing the flyout while a deletion asks restores the button and deletes nothing', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  const { container, cleanup } = setup({ limits });
  const { clear, ask } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(ask.hidden, false);
  cleanup();
  assert.equal(ask.hidden, true);
  assert.equal(clear.hidden, false);
  assert.deepEqual(deletions(limits), []);
});

test('a failed deletion is reported in its hint', async () => {
  const limits = stubLimits({ stored: { a: 2 }, failDelete: true });
  const { container } = setup({ limits });
  const { clear, yes, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  await settle();
  assert.equal(hint.textContent, 'Could not delete: delete failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(clear.hidden, false);
});

test('the sender picker lists every stored sender with a count, labelled decoded, valued raw', async () => {
  const { container } = setup({ limits: stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } }) });
  await settle();
  const { select, remove } = senderControl(container);
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [['Big%20Bob', 'Big Bob (2)'], ['carol', 'carol (1)']],
  );
  assert.equal(select.disabled, false);
  assert.equal(remove.textContent, 'Hide');
});

test('with no saved history the sender picker and its Hide button are disabled', async () => {
  const { container } = setup();
  await settle();
  const { select, remove } = senderControl(container);
  assert.equal(select.disabled, true);
  assert.equal(remove.disabled, true);
  assert.equal(select.options[0]?.textContent, 'No saved history');
});

test('Hide messages by user asks, hides the chosen sender once, and refreshes the list', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } });
  const { container } = setup({ limits });
  await settle();
  const { select, remove, ask, yes, no, hint } = senderControl(container);
  select.value = 'Big%20Bob';
  remove.click();
  await settle();
  assert.equal(ask.querySelector('span')?.textContent, 'Hide 2 messages from Big Bob?');
  no.click();
  assert.deepEqual(deletions(limits), []);
  remove.click();
  await settle();
  yes.click();
  await settle();
  assert.deepEqual(deletions(limits), [['deleteByUser', 'Big%20Bob']]);
  assert.equal(hint.textContent, 'Hid 2 messages.');
  assert.deepEqual([...select.options].map((o) => o.value), ['carol']);
});

test('a failed hide is reported in its hint with the hide wording', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2 }, failDelete: true });
  const { container } = setup({ limits });
  await settle();
  const { remove, yes, hint } = senderControl(container);
  remove.click();
  await settle();
  yes.click();
  await settle();
  assert.equal(hint.textContent, 'Could not hide: delete failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(remove.hidden, false);
});

test('the real limits behind the flyout: Confirm empties the view through onDeleted', async (t) => {
  const db = await openDb({ name: `panel-clear-${Date.now()}` });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite');
    for (const id of ['a', 'b']) tx.objectStore('messages').put({ id, roomID: '1', mTime: id, user: 'u', receivedAt: 1 });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const limits = createLimits({ db, gallery: { usage: async () => ({ used: 0, preview: null }), enforceLimit: async () => [] } });
  const { doc, container } = setup({ limits: /** @type {any} */ (limits) });
  // Stands in for the view's own removeById.
  t.after(onDeleted((ids) => ids.forEach((id) => doc.querySelector(`[data-id="${id}"]`)?.remove())));
  const { clear, yes, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  await settle();
  assert.equal(hint.textContent, 'Deleted 2 messages.');
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 0);
  assert.equal(await limits.countAll(), 0);
});

test('a count that fails is reported in the hint and asks nothing', async () => {
  const limits = stubLimits({ stored: { a: 2 } });
  limits.countAll = async () => {
    throw new Error('read failed');
  };
  const { container } = setup({ limits });
  const { clear, ask, hint } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(hint.textContent, 'Could not check: read failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(ask.hidden, true);
  assert.equal(clear.disabled, false);
});

test('a sender with nothing left to hide says so and asks nothing', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2 } });
  limits.countByUser = async () => 0;
  const { container } = setup({ limits });
  await settle();
  const { remove, ask, hint } = senderControl(container);
  remove.click();
  await settle();
  assert.equal(hint.textContent, 'No saved messages from Big Bob to hide.');
  assert.equal(ask.hidden, true);
  assert.deepEqual(deletions(limits), []);
});

test('a count or a deletion that settles after close writes nothing', async () => {
  /** @type {(n: number) => void} */
  let counted = () => {};
  /** @type {(ids: string[]) => void} */
  let cleared = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.countAll = () => new Promise((r) => (counted = r));
  const first = setup({ limits });
  const one = clearControl(first.container);
  one.clear.click();
  first.cleanup();
  counted(2);
  await settle();
  assert.equal(one.ask.hidden, true);
  assert.equal(one.hint.textContent, '');

  limits.countAll = async () => 2;
  limits.clearHistory = () => new Promise((r) => (cleared = r));
  const second = setup({ limits });
  const two = clearControl(second.container);
  two.clear.click();
  await settle();
  two.yes.click();
  second.cleanup();
  cleared(['x', 'y']);
  await settle();
  assert.equal(two.hint.textContent, '');
});

test('a sender list that fails to read is reported under Hide', async () => {
  const limits = stubLimits();
  limits.senders = async () => {
    throw new Error('read failed');
  };
  const { container } = setup({ limits });
  await settle();
  const { hint } = senderControl(container);
  assert.equal(hint.textContent, 'Could not read saved senders: read failed');
  assert.ok(hint.classList.contains('tdf-warn'));
});

test('a refresh keeps the chosen sender while they are still listed', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 }, failDelete: true });
  const { container } = setup({ limits });
  await settle();
  const { select } = senderControl(container);
  select.value = 'carol';
  const { clear, yes } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  await settle();
  // The failed clear still refreshed the list: both senders remain, carol still chosen.
  assert.ok(limits.calls.filter(([name]) => name === 'senders').length >= 2);
  assert.equal(select.value, 'carol');
});

test('only the latest sender read fills the list', async () => {
  /** @type {Array<(list: Array<{ user: string, count: number }>) => void>} */
  const reads = [];
  const limits = stubLimits({ stored: { a: 1 } });
  limits.senders = () => new Promise((r) => reads.push(r));
  const { container } = setup({ limits });
  const { clear, yes, select } = { ...clearControl(container), ...senderControl(container) };
  clear.click();
  await settle();
  yes.click();
  await settle();
  assert.equal(reads.length, 2);
  reads[1]([{ user: 'new', count: 1 }]);
  await settle();
  reads[0]([{ user: 'stale', count: 9 }]);
  await settle();
  assert.deepEqual([...select.options].map((o) => o.value), ['new']);
});

test('Hide messages by user hides the sender it asked about, with the picker locked meanwhile', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } });
  const { container, toggle } = setup({ limits });
  await settle();
  const { select, remove, ask, yes, no } = senderControl(container);
  select.value = 'Big%20Bob';
  remove.click();
  await settle();
  assert.equal(ask.querySelector('span')?.textContent, 'Hide 2 messages from Big Bob?');
  assert.equal(select.disabled, true);
  no.click();
  assert.equal(select.disabled, false);
  remove.click();
  await settle();
  // A refresh while the question is open does not unlock the picker.
  const reads = limits.calls.filter(([name]) => name === 'senders').length;
  limits.clearHistory = async () => [];
  toggle(false);
  await settle();
  assert.equal(limits.calls.filter(([name]) => name === 'senders').length, reads + 1);
  assert.equal(select.disabled, true);
  select.value = 'carol';
  yes.click();
  await settle();
  assert.deepEqual(deletions(limits), [['deleteByUser', 'Big%20Bob']]);
  assert.equal(select.disabled, false);
});

test('Cancel is disabled while a deletion runs', async () => {
  /** @type {(ids: string[]) => void} */
  let done = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.clearHistory = () => new Promise((r) => (done = r));
  const { container } = setup({ limits });
  const { clear, ask, yes, no, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  assert.equal(no.disabled, true);
  no.click();
  assert.equal(ask.hidden, false);
  assert.equal(clear.hidden, true);
  done(['x', 'y']);
  await settle();
  assert.equal(hint.textContent, 'Deleted 2 messages.');
  assert.equal(no.disabled, false);
});

test('a sender list that fails to read disables the picker and Hide; a later read clears the warning', async () => {
  const limits = stubLimits({ stored: { carol: 1 } });
  const read = limits.senders;
  limits.senders = async () => {
    throw new Error('read failed');
  };
  const { container, toggle } = setup({ limits });
  await settle();
  const { select, remove, hint } = senderControl(container);
  assert.equal(select.disabled, true);
  assert.equal(remove.disabled, true);
  limits.senders = read;
  limits.clearHistory = async () => [];
  toggle(false);
  await settle();
  assert.equal(hint.textContent, '');
  assert.equal(hint.classList.contains('tdf-warn'), false);
  assert.equal(select.disabled, false);
  assert.equal(remove.disabled, false);
});

test('a later sender read keeps a deletion report shown since the warning', async () => {
  const limits = stubLimits({ stored: { carol: 1, dave: 1 } });
  const read = limits.senders;
  let fail = true;
  limits.senders = async () => {
    if (fail) throw new Error('read failed');
    return read();
  };
  const { container, toggle } = setup({ limits });
  await settle();
  const { hint } = senderControl(container);
  assert.equal(hint.textContent, 'Could not read saved senders: read failed');
  // Stands in for a report written over the warning before the next read.
  hint.textContent = 'Deleted 1 message.';
  hint.classList.remove('tdf-warn');
  fail = false;
  limits.clearHistory = async () => [];
  toggle(false);
  await settle();
  assert.equal(hint.textContent, 'Deleted 1 message.');
});

test('unticking Chat history refreshes the sender list after the deletion', async () => {
  const limits = stubLimits({ stored: { carol: 1 } });
  const { container, toggle } = setup({ limits });
  await settle();
  limits.calls.length = 0;
  toggle(false);
  await settle();
  const names = limits.calls.map(([name]) => name);
  assert.ok(names.includes('clearHistory'));
  assert.ok(names.indexOf('senders') > names.indexOf('clearHistory'));
  assert.deepEqual([...senderControl(container).select.options].map((o) => o.textContent), ['No saved history']);
});

test('a count, deletion or sender read that fails after close writes nothing', async () => {
  /** @type {(e: Error) => void} */
  let failCount = () => {};
  /** @type {(e: Error) => void} */
  let failRun = () => {};
  /** @type {(e: Error) => void} */
  let failSenders = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.countAll = () => new Promise((_, reject) => (failCount = reject));
  const first = setup({ limits });
  const one = clearControl(first.container);
  one.clear.click();
  first.cleanup();
  failCount(new Error('read failed'));
  await settle();
  assert.equal(one.hint.textContent, '');

  limits.countAll = async () => 2;
  limits.clearHistory = () => new Promise((_, reject) => (failRun = reject));
  const second = setup({ limits });
  const two = clearControl(second.container);
  two.clear.click();
  await settle();
  two.yes.click();
  second.cleanup();
  failRun(new Error('delete failed'));
  await settle();
  assert.equal(two.hint.textContent, '');

  limits.senders = () => new Promise((_, reject) => (failSenders = reject));
  const third = setup({ limits });
  third.cleanup();
  failSenders(new Error('read failed'));
  await settle();
  assert.equal(senderControl(third.container).hint.textContent, '');
});

// TDF-0033.3: Collapse server history automatically.
const AUTO_COLLAPSE = 'Collapse server history automatically';

test('Collapse server history automatically sits in the Chat section, with its hint', async () => {
  const { container } = setup();
  await settle();
  const box = boxFor(container, AUTO_COLLAPSE);
  assert.equal(box.type, 'checkbox');
  const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
  // After the Clear chat buffer hint, and ahead of the history rows.
  assert.match(String(row.previousElementSibling?.textContent), /Empties the message view/);
  const about = /** @type {HTMLElement} */ (row.nextElementSibling);
  assert.equal(about.className, 'tdf-opt-hint');
  assert.equal(about.textContent, 'Server-history blocks arrive collapsed.');
  const failure = /** @type {HTMLElement} */ (about.nextElementSibling);
  assert.ok(failure.classList.contains('tdf-warn'));
  assert.equal(failure.textContent, '');
  assert.equal(failure.nextElementSibling?.querySelector('span')?.textContent, HISTORY);
});

test('Collapse server history automatically shows the stored value and writes on change', async () => {
  for (const on of [false, true]) {
    const settings = stubSettings({ autoCollapseServerHistory: on });
    const { win, container } = setup({ settings });
    await settle();
    const box = boxFor(container, AUTO_COLLAPSE);
    assert.equal(box.checked, on);
    box.checked = !on;
    box.dispatchEvent(new win.Event('change'));
    await settle();
    assert.deepEqual(settings.writes, [['autoCollapseServerHistory', !on]]);
  }
});

test('the media checkboxes still read and write their own settings beside the Chat one', async () => {
  const settings = stubSettings({ includeMyImages: true, storeImagesOffline: false, autoCollapseServerHistory: false });
  const { win, container } = setup({ settings });
  await settle();
  assert.equal(boxFor(container, 'Include my images').checked, true);
  assert.equal(boxFor(container, 'Store images offline').checked, false);
  const offline = boxFor(container, 'Store images offline');
  offline.checked = true;
  offline.dispatchEvent(new win.Event('change'));
  await settle();
  assert.deepEqual(settings.writes, [['storeImagesOffline', true]]);
});

/** The Use Chat 2.0 row's checkbox, and the hint under it. */
function chat2Row(/** @type {HTMLElement} */ container) {
  const box = /** @type {HTMLInputElement} */ (container.querySelector('input.tdf-opt-chat2'));
  const hint = /** @type {HTMLElement} */ (box.closest('label')?.nextElementSibling);
  return { box, hint };
}

test('Use Chat 2.0 is the first checkbox row under Chat, above Auto-scroll, checked while 2.0 is on', () => {
  const { container } = setup();
  const { box, hint } = chat2Row(container);
  assert.equal(box.type, 'checkbox');
  assert.ok(box.classList.contains('tdf-opt-switch'));
  assert.equal(box.checked, true);
  const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
  assert.equal(row.textContent, 'Use Chat 2.0');
  assert.ok(row.previousElementSibling?.classList.contains('tdf-opt-section'));
  assert.equal(row.previousElementSibling?.textContent, 'Chat');
  assert.ok(hint.classList.contains('tdf-opt-hint'));
  assert.equal(hint.textContent, '');
  assert.equal(hint.nextElementSibling?.querySelector(AUTOSCROLL) !== null, true, 'Auto-scroll follows');
});

test('Settings has exactly two sections, Chat and Media and Gallery Settings, the second in its fixed order', () => {
  const { container } = setup();
  const sections = [...container.querySelectorAll('.tdf-opt-section')];
  assert.deepEqual(
    sections.map((s) => s.textContent),
    ['Chat', 'Media and Gallery Settings'],
  );
  // The labelled rows and buttons after the second header, in DOM order.
  /** @type {string[]} */
  const rows = [];
  for (let node = sections[1].nextElementSibling; node; node = node.nextElementSibling) {
    if (node.matches('label.tdf-opt-row, label.tdf-opt-field')) rows.push(String(node.querySelector('span')?.textContent));
    else if (node.matches('button.tdf-opt-clear') && node.textContent !== 'Hide') rows.push(String(node.textContent));
  }
  assert.deepEqual(rows, [
    'Include my images',
    'Store images offline',
    'Compress stored images',
    'Use media quickview',
    'Gallery size limit (MB)',
  ]);
});

test('the Chat section holds its rows in fixed order, history rows last', () => {
  const { container } = setup();
  const [chat, media] = [...container.querySelectorAll('.tdf-opt-section')];
  /** @type {string[]} */
  const rows = [];
  for (let node = chat.nextElementSibling; node && node !== media; node = node.nextElementSibling) {
    if (node.matches('label.tdf-opt-row, label.tdf-opt-field')) rows.push(String(node.querySelector('span')?.textContent));
    else if (node.matches('button.tdf-opt-clear') && node.textContent !== 'Hide') rows.push(String(node.textContent));
  }
  assert.deepEqual(rows, [
    'Use Chat 2.0',
    'Auto-scroll',
    'Clear chat buffer',
    'Collapse server history automatically',
    HISTORY,
    'Clear history now',
    'Hide messages by user',
  ]);
});

test('unchecking Use Chat 2.0 records 2.0 as off and reloads, asking nothing', () => {
  let reloads = 0;
  const { win, container } = setup({
    prepare: (w) => {
      w.location.reload = () => reloads++;
    },
  });
  const { box, hint } = chat2Row(container);
  box.checked = false;
  box.dispatchEvent(new win.Event('change'));
  assert.equal(win.localStorage.getItem('tdfChat2.off'), '1');
  assert.equal(reloads, 1);
  assert.equal(hint.textContent, '');
});

test('a Use Chat 2.0 write the browser refuses says so under the row and does not reload', () => {
  let reloads = 0;
  const { win, container } = setup({
    prepare: (w) => {
      w.location.reload = () => reloads++;
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota exceeded');
          },
          removeItem: () => {},
        },
      });
    },
  });
  const { box, hint } = chat2Row(container);
  box.checked = false;
  box.dispatchEvent(new win.Event('change'));
  assert.equal(reloads, 0);
  assert.equal(box.checked, true);
  assert.equal(hint.textContent, 'Could not apply: quota exceeded');
});

test('checking Use Chat 2.0 while it is on writes nothing and does not reload', () => {
  let reloads = 0;
  const { win, container } = setup({
    prepare: (w) => {
      w.location.reload = () => reloads++;
    },
  });
  const { box } = chat2Row(container);
  box.checked = true;
  box.dispatchEvent(new win.Event('change'));
  assert.equal(win.localStorage.getItem('tdfChat2.off'), null);
  assert.equal(reloads, 0);
});

// TDF-0045: the version credits its author and links to the author's forum profile.

const PROFILE = 'https://forum.example/memberlist.php?mode=viewprofile&u=';

test('the version shows v<version> at rest and carries the author credit', () => {
  const { container } = setup({ prepare: (w) => { w.profileUrl = PROFILE; } });
  const version = /** @type {HTMLElement} */ (container.querySelector('.tdf-opt-version'));
  assert.match(version.querySelector('.tdf-opt-version-num')?.textContent ?? '', /^v/);
  assert.equal(version.querySelector('.tdf-opt-version-by')?.textContent, ' · By SoloBang76');
  assert.match(version.getAttribute('aria-label') ?? '', /by SoloBang76$/);
  assert.equal(version.getAttribute('title'), null);
});

test('with an engine profileUrl the version links to the author profile in a new tab', () => {
  const { container } = setup({ prepare: (w) => { w.profileUrl = PROFILE; } });
  const version = /** @type {HTMLAnchorElement} */ (container.querySelector('.tdf-opt-version'));
  assert.equal(version.tagName, 'A');
  const url = new URL(version.href);
  assert.equal(url.searchParams.get('u'), '573314');
  assert.equal(url.searchParams.get('mode'), 'viewprofile');
  assert.equal(version.target, '_blank');
  assert.match(version.rel, /noopener/);
  assert.equal(version.getAttribute('role'), null);
});

test('with no engine profileUrl the version is a focusable span with the credit and no link', () => {
  const { container } = setup();
  const version = /** @type {HTMLElement} */ (container.querySelector('.tdf-opt-version'));
  assert.equal(version.tagName, 'SPAN');
  assert.equal(version.getAttribute('href'), null);
  assert.equal(version.getAttribute('tabindex'), '0');
  assert.equal(version.getAttribute('role'), 'note');
  assert.equal(version.querySelector('.tdf-opt-version-by')?.textContent, ' · By SoloBang76');
  assert.match(version.getAttribute('aria-label') ?? '', /by SoloBang76$/);
});
