import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * A settings stand-in over a plain object; `fail` makes every read reject, `failWrite` every
 * write; `failRead` and `failSet` name single keys whose reads or writes reject.
 */
function stubSettings(values = {}, { fail = false, failWrite = false, failRead = /** @type {string[]} */ ([]), failSet = /** @type {string[]} */ ([]) } = {}) {
  /** @type {Record<string, unknown>} */
  const store = {
    historyCount: 25,
    galleryLimitMB: null,
    includeMyImages: false,
    storeImagesOffline: false,
    autoCollapseServerHistory: false,
    compressStoredImages: false,
    useMediaQuickview: true,
    hiddenSenders: [],
    ...values,
  };
  /** @type {unknown[][]} */
  const writes = [];
  return {
    writes,
    store,
    async get(/** @type {string} */ key) {
      if (fail || failRead.includes(key)) throw new Error('read failed');
      return store[key];
    },
    async set(/** @type {string} */ key, /** @type {unknown} */ value) {
      if (failWrite || failSet.includes(key)) throw new Error('write failed');
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
 * `stored` is the saved history's line count by sender, which Clear empties.
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

// The engine's User Options (TDF-0080): its seven editDiv checkboxes and globals, and a replica of
// functions.js.php's updateUserSettings, which reads all seven boxes into the globals and writes
// the myOptions cookie string, recorded in `win.cookies`.
const ENGINE_OPTIONS = /** @type {const} */ ([
  ['allowPM', 'userRPM'],
  ['viewMyCamID', 'userRWebcam'],
  ['entryExitID', 'userEntryExitSFX'],
  ['soundsID', 'userNewMessageSFX'],
  ['sfxID', 'userSFX'],
  ['userAvatarsON', 'userAvatarsON'],
  ['userMessStyle', 'userMessStyle'],
]);
// The engine defaults: PM, sounds and avatars on; webcam off. Modern Message Style is on here so
// a test can see it written back unchanged.
/** @type {Record<string, boolean>} */
const ENGINE_DEFAULTS = { allowPM: true, viewMyCamID: false, entryExitID: true, soundsID: true, sfxID: true, userAvatarsON: true, userMessStyle: true };

/**
 * @param {any} win
 * @param {{ values?: Record<string, boolean>, omit?: string[], update?: 'ok' | 'missing' | 'throws' | 'throwsAfterGlobals' }} opts
 */
function installEngineOptions(win, { values = {}, omit = [], update = 'ok' }) {
  const doc = win.document;
  const div = doc.createElement('div');
  div.id = 'editDiv';
  div.hidden = true;
  const state = { ...ENGINE_DEFAULTS, ...values };
  for (const [id, global] of ENGINE_OPTIONS) {
    win[global] = state[id];
    if (omit.includes(id)) continue;
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = win[global];
    div.append(box);
  }
  doc.body.prepend(div);
  win.cookies = [];
  if (update === 'missing') return;
  win.updateUserSettings = () => {
    if (update === 'throws') throw new Error('cookie refused');
    for (const [id, global] of ENGINE_OPTIONS) win[global] = doc.getElementById(id).checked;
    // The real engine writes the cookie last, so a cookie failure lands after the globals.
    if (update === 'throwsAfterGlobals') throw new Error('cookie refused');
    const parts = ENGINE_OPTIONS.map(([, global]) => win[global]);
    win.cookies.push(`myOptions=${encodeURI(parts.join('|'))}`);
  };
}

const USER_OPTION_ROWS = [
  ['allowPM', 'Allow private chat'],
  ['viewMyCamID', 'Allow webcam access'],
  ['entryExitID', 'Play entry/exit sounds'],
  ['soundsID', 'Play new message sound'],
  ['sfxID', 'Play SFX'],
  ['userAvatarsON', 'Display user avatars'],
];

function setup({ settings = stubSettings(), limits = stubLimits(), engine = true, userOptions = /** @type {any} */ (null), loadFailure = undefined, prepare = (/** @type {any} */ _win) => {} } = {}) {
  const win = /** @type {any} */ (new Window());
  prepare(win);
  const doc = win.document;
  doc.body.innerHTML =
    (engine ? '<input type="checkbox" id="autoScrollID" checked>' : '') +
    '<div id="tdf-chat"><div class="tdf-list"><div class="tdf-msg" data-id="a"></div><div class="tdf-msg" data-id="b"></div></div></div>';
  if (userOptions) installEngineOptions(win, userOptions);
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

/**
 * The Clear: Buffer | History line (TDF-0081): one action's link as `clear` (History by default),
 * the idle and asking halves of the line, its report hint, and Confirm and Cancel.
 * @param {HTMLElement} container
 * @param {'Buffer' | 'History'} [which]
 */
const clearControl = (container, which = 'History') => {
  const line = /** @type {HTMLElement} */ (container.querySelector('.tdf-opt-clear-line'));
  const idle = /** @type {HTMLElement} */ (line.querySelector('.tdf-opt-clear-idle'));
  const ask = /** @type {HTMLElement} */ (line.querySelector('.tdf-opt-clear-ask'));
  const hint = /** @type {HTMLElement} */ (line.nextElementSibling);
  return { line, idle, clear: button(idle, which), ask, hint, yes: button(ask, 'Confirm'), no: button(ask, 'Cancel') };
};

/**
 * The Hide messages by user control (TDF-0082): the select and the Hide / Unhide toggle share
 * one row, its report hint directly below.
 */
const senderControl = (/** @type {HTMLElement} */ container) => {
  const select = /** @type {HTMLSelectElement} */ (container.querySelector('.tdf-opt-sender select'));
  const row = /** @type {HTMLElement} */ (select.closest('.tdf-opt-sender'));
  const toggle = /** @type {HTMLButtonElement} */ (row.querySelector('button'));
  const hint = /** @type {HTMLElement} */ (row.nextElementSibling);
  return { select, row, toggle, hint };
};

/** Every deletion asked of limits. */
const deletions = (/** @type {{ calls: unknown[][] }} */ limits) =>
  limits.calls.filter(([name]) => name === 'clearHistory');

/** The hiddenSenders writes, in order. */
const hiddenWrites = (/** @type {{ writes: unknown[][] }} */ settings) =>
  settings.writes.filter(([key]) => key === 'hiddenSenders').map(([, value]) => value);

/** Choose a sender in the picker as the member would. */
const choose = (/** @type {HTMLSelectElement} */ select, /** @type {string} */ user) => {
  select.value = user;
  select.dispatchEvent(new (/** @type {any} */ (select.ownerDocument.defaultView)).Event('change'));
};

test('the Clear line and Hide messages by user sit after the Chat history switch and its hint', () => {
  const { container } = setup();
  const { line } = clearControl(container);
  const historyHint = /** @type {HTMLElement} */ (line.previousElementSibling);
  assert.ok(historyHint.classList.contains('tdf-opt-hint'));
  assert.match(String(historyHint.previousElementSibling?.textContent), /Chat history/);
  const { row, hint } = senderControl(container);
  assert.ok(clearControl(container).hint.nextElementSibling === row, 'Hide messages by user follows the Clear report hint');
  assert.match(String(row.textContent), /^Hide messages by user/);
  // Hide messages by user closes the history rows (TDF-0044); the User options group follows it
  // (TDF-0080).
  const next = hint.nextElementSibling;
  assert.ok(next?.classList.contains('tdf-opt-subsection'));
  assert.equal(next?.textContent, 'User options');
});

test('the Clear line reads Clear: Buffer | History in hint style, with Buffer and History as text buttons', () => {
  const { container } = setup();
  const { line, idle, ask, hint } = clearControl(container);
  assert.ok(line.classList.contains('tdf-opt-hint'));
  assert.equal(line.tagName, 'DIV');
  assert.equal(idle.textContent, 'Clear: Buffer | History');
  assert.equal(idle.hidden, false);
  assert.equal(ask.hidden, true);
  for (const label of /** @type {const} */ (['Buffer', 'History'])) {
    const link = clearControl(container, label).clear;
    assert.equal(link.tagName, 'BUTTON');
    assert.equal(link.type, 'button');
    assert.ok(link.classList.contains('tdf-opt-link'));
  }
  // Clear: and | are plain text, not buttons.
  assert.deepEqual([...idle.children].map((c) => [c.tagName, c.textContent]), [
    ['SPAN', 'Clear: '],
    ['BUTTON', 'Buffer'],
    ['SPAN', ' | '],
    ['BUTTON', 'History'],
  ]);
  assert.equal(hint.getAttribute('aria-live'), 'polite');
  assert.equal(hint.textContent, '');
});

test('Buffer carries the old hint as its tooltip', () => {
  const { container } = setup();
  assert.equal(clearControl(container, 'Buffer').clear.title, 'Empties the message view. Saved history is kept and returns on reload.');
  assert.equal(container.querySelector('.tdf-opt-clear'), null, 'the old full-width buttons are gone');
  assert.equal(button(container, 'Clear chat buffer'), undefined);
  assert.equal(button(container, 'Clear history now'), undefined);
});

test('Buffer asks on the line; Confirm calls the engine clrScreen and clears the view through core, then the line returns', async (t) => {
  const { win, doc, container } = setup();
  let cleared = 0;
  win.clrScreen = () => cleared++;
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  const { clear, idle, ask, yes, hint } = clearControl(container, 'Buffer');
  clear.click();
  assert.equal(idle.hidden, true);
  assert.equal(ask.hidden, false);
  assert.equal(ask.textContent, 'Clear the message view? Confirm | Cancel');
  assert.equal(cleared, 0, 'nothing clears before Confirm');
  assert.equal(viewCleared, 0);
  yes.click();
  await settle();
  assert.equal(cleared, 1);
  assert.equal(viewCleared, 1);
  // The panel no longer removes the view's rows behind its back.
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 2);
  assert.equal(idle.hidden, false);
  assert.equal(ask.hidden, true);
  assert.equal(idle.textContent, 'Clear: Buffer | History');
  assert.equal(hint.textContent, '', 'Buffer reports nothing');
});

test('Buffer without the engine clrScreen still clears the view', async (t) => {
  const { container } = setup();
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  const { clear, yes } = clearControl(container, 'Buffer');
  clear.click();
  yes.click();
  await settle();
  assert.equal(viewCleared, 1);
});

test('Buffer Cancel clears nothing and restores the line', async (t) => {
  const { win, container } = setup();
  let cleared = 0;
  win.clrScreen = () => cleared++;
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  const { clear, idle, ask, no } = clearControl(container, 'Buffer');
  clear.click();
  no.click();
  await settle();
  assert.equal(cleared, 0);
  assert.equal(viewCleared, 0);
  assert.equal(idle.hidden, false);
  assert.equal(ask.hidden, true);
  assert.equal(clear.disabled, false);
});

test('closing the flyout while Buffer asks restores the line and clears nothing', async (t) => {
  const { container, cleanup } = setup();
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  const { clear, idle, ask } = clearControl(container, 'Buffer');
  clear.click();
  cleanup();
  assert.equal(idle.hidden, false);
  assert.equal(ask.hidden, true);
  assert.equal(viewCleared, 0);
});

test('focus moves from a pressed Clear link to Confirm, and back when the line returns', async () => {
  const { doc, container } = setup();
  const { clear, yes, no } = clearControl(container, 'Buffer');
  clear.focus();
  clear.click();
  assert.equal(doc.activeElement, yes);
  no.click();
  assert.equal(doc.activeElement, clear);
});

test('a Buffer whose engine clrScreen throws still clears the view and reports the failure', async (t) => {
  const { win, container } = setup();
  win.clrScreen = () => {
    throw new Error('boom');
  };
  let viewCleared = 0;
  t.after(onClearView(() => viewCleared++));
  const { clear, idle, ask, yes, hint } = clearControl(container, 'Buffer');
  clear.click();
  yes.click();
  await settle();
  assert.equal(viewCleared, 1);
  assert.match(hint.textContent ?? '', /^Could not clear the view: .*boom/);
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(idle.hidden, false);
  assert.equal(ask.hidden, true);
});

/**
 * A browser's focus fixup: a focused button that becomes disabled loses focus to body. happy-dom
 * neither does this nor blurs a disabled element, so the button is briefly re-enabled to blur it.
 * @param {HTMLButtonElement} b
 */
const focusFixup = (b) => {
  const disabled = b.disabled;
  b.disabled = false;
  b.blur();
  b.disabled = disabled;
};

test('History moves focus to Confirm after counting, though the disabled link lost focus meanwhile', async () => {
  /** @type {(n: number) => void} */
  let counted = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.countAll = () => new Promise((r) => (counted = r));
  const { doc, container } = setup({ limits });
  const { clear, yes } = clearControl(container);
  clear.focus();
  clear.click();
  focusFixup(clear);
  assert.ok(doc.activeElement !== clear, 'the fixup moved focus off History');
  counted(2);
  await settle();
  assert.ok(doc.activeElement === yes, 'focus is on Confirm');
});

test('focus returns to History after an async Confirm, though the disabled Confirm lost focus meanwhile', async () => {
  /** @type {(ids: string[]) => void} */
  let cleared = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.clearHistory = () => new Promise((r) => (cleared = r));
  const { doc, container } = setup({ limits });
  const { clear, yes } = clearControl(container);
  clear.focus();
  clear.click();
  await settle();
  assert.ok(doc.activeElement === yes, 'focus is on Confirm');
  yes.click();
  focusFixup(yes);
  assert.ok(doc.activeElement !== yes, 'the fixup moved focus off Confirm');
  cleared(['1', '2']);
  await settle();
  assert.ok(doc.activeElement === clear, 'focus is back on History');
});

test('History is disabled while it counts, and so is Buffer', async () => {
  /** @type {(n: number) => void} */
  let counted = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.countAll = () => new Promise((r) => (counted = r));
  const { container } = setup({ limits });
  const { clear, ask } = clearControl(container);
  const buffer = clearControl(container, 'Buffer').clear;
  clear.click();
  assert.equal(clear.disabled, true);
  assert.equal(buffer.disabled, true);
  counted(2);
  await settle();
  assert.equal(ask.hidden, false);
});

test('History asks on the Clear line with the count first; Cancel deletes nothing and restores the line', async () => {
  const limits = stubLimits({ stored: { a: 2, b: 1 } });
  const { container } = setup({ limits });
  const { clear, idle, ask, no } = clearControl(container);
  assert.equal(ask.hidden, true);
  clear.click();
  await settle();
  assert.equal(idle.hidden, true);
  assert.equal(ask.hidden, false);
  assert.equal(ask.querySelector('span')?.textContent, 'Delete 3 messages?');
  no.click();
  assert.equal(ask.hidden, true);
  assert.equal(idle.hidden, false);
  assert.equal(clear.disabled, false);
  assert.deepEqual(deletions(limits), []);
});

test('Confirm clears the history once and the hint reports the count', async () => {
  const limits = stubLimits({ stored: { a: 2, b: 1 } });
  const { container } = setup({ limits });
  const { clear, idle, ask, yes, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  yes.click();
  await settle();
  assert.deepEqual(deletions(limits), [['clearHistory']]);
  assert.equal(hint.textContent, 'Deleted 3 messages.');
  assert.equal(ask.hidden, true);
  assert.equal(idle.hidden, false);
  // The sender list follows: nothing is left to pick.
  assert.equal(senderControl(container).select.disabled, true);
});

test('History over no saved history says so and asks nothing', async () => {
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
const OFF_CLEAR = 'Chat history is off, so nothing is saved. Buffer empties the lines on screen.';

test('History with Chat history stored off says nothing is saved and points to Buffer', async () => {
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

test('History follows the Chat history switch: off, then on again', async () => {
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

test('a refused Chat history untick leaves History reading history as on', async () => {
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
  const { clear, idle, ask } = clearControl(container);
  clear.click();
  await settle();
  assert.equal(ask.hidden, false);
  cleanup();
  assert.equal(ask.hidden, true);
  assert.equal(idle.hidden, false);
  assert.deepEqual(deletions(limits), []);
});

test('a failed deletion is reported in its hint', async () => {
  const limits = stubLimits({ stored: { a: 2 }, failDelete: true });
  const { container } = setup({ limits });
  const { clear, idle, yes, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  await settle();
  assert.equal(hint.textContent, 'Could not delete: delete failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(idle.hidden, false);
});

test('the sender picker lists every stored sender with a count, labelled decoded, valued raw', async () => {
  const { container } = setup({ limits: stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } }) });
  await settle();
  const { select, toggle } = senderControl(container);
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [['Big%20Bob', 'Big Bob (2)'], ['carol', 'carol (1)']],
  );
  assert.equal(select.disabled, false);
  assert.equal(toggle.textContent, 'Hide');
});

test('Hide is a small button in the Hide messages by user row, directly after the select and outside its label', () => {
  const { container } = setup();
  const { select, row, toggle: remove, hint } = senderControl(container);
  assert.equal(row.tagName, 'DIV');
  assert.ok(row.classList.contains('tdf-opt-row'));
  const label = /** @type {HTMLElement} */ (select.parentElement);
  assert.equal(label.tagName, 'LABEL');
  assert.equal(label.parentElement, row);
  assert.equal(label.nextElementSibling, remove, 'right of the select');
  assert.equal(label.lastElementChild, select);
  assert.equal(remove.closest('label'), null, 'a button may not sit inside a label');
  assert.equal(remove.type, 'button');
  assert.ok(remove.classList.contains('tdf-opt-small'));
  assert.ok(hint.classList.contains('tdf-opt-action-hint'), 'its report shows directly below the row');
  assert.equal(container.querySelector('.tdf-opt-confirm'), null, 'no confirm step: nothing is deleted');
  const css = readFileSync(new URL('./options.css', import.meta.url), 'utf8');
  assert.match(/\.tdf-opt-sender-label \{[^}]*\}/.exec(css)?.[0] ?? '', /display: contents;/);
  assert.match(/\.tdf-opt-sender \.tdf-opt-small \{[^}]*\}/.exec(css)?.[0] ?? '', /flex: none;/);
});

test('with no saved history and nobody hidden the sender picker and its Hide button are disabled', async () => {
  const { container } = setup();
  await settle();
  const { select, toggle } = senderControl(container);
  assert.equal(select.disabled, true);
  assert.equal(toggle.disabled, true);
  assert.equal(select.options[0]?.textContent, 'No saved history');
});

test('Hide hides the chosen sender at once: no confirm, nothing deleted, the set written', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } });
  const settings = stubSettings();
  const { container } = setup({ limits, settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  choose(select, 'Big%20Bob');
  assert.equal(toggle.textContent, 'Hide');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), [['Big%20Bob']]);
  assert.deepEqual(deletions(limits), []);
  assert.equal(hint.textContent, 'Hid messages from Big Bob.');
  assert.equal(hint.classList.contains('tdf-warn'), false);
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [['Big%20Bob', 'Big Bob (2, hidden)'], ['carol', 'carol (1)']],
  );
  assert.equal(select.value, 'Big%20Bob');
  assert.equal(toggle.textContent, 'Unhide');
  assert.equal(toggle.disabled, false);
});

test('Unhide on a hidden sender removes them from the set and reports it', async () => {
  const settings = stubSettings({ hiddenSenders: ['Big%20Bob', 'zed'] });
  const { container } = setup({ limits: stubLimits({ stored: { 'Big%20Bob': 2 } }), settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  assert.equal(select.value, 'Big%20Bob');
  assert.equal(toggle.textContent, 'Unhide');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), [['zed']]);
  assert.equal(hint.textContent, 'Showing messages from Big Bob again.');
  assert.equal(toggle.textContent, 'Hide');
  assert.equal(select.options[0]?.textContent, 'Big Bob (2)');
});

test('the toggle label follows the selected sender', async () => {
  const settings = stubSettings({ hiddenSenders: ['carol'] });
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1, carol: 1 } }), settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  assert.equal(toggle.textContent, 'Hide');
  toggle.click();
  await settle();
  assert.equal(hint.textContent, 'Hid messages from bob.');
  choose(select, 'carol');
  assert.equal(toggle.textContent, 'Unhide');
  assert.equal(hint.textContent, '', 'a report about another sender is cleared');
  choose(select, 'dave');
  choose(select, 'bob');
  assert.equal(toggle.textContent, 'Unhide');
});

test('changing the sender keeps a standing read warning', async () => {
  const settings = stubSettings({}, { failRead: ['hiddenSenders'] });
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1, carol: 1 } }), settings });
  await settle();
  const { select, hint } = senderControl(container);
  choose(select, 'carol');
  assert.equal(hint.textContent, 'Could not read hidden senders: read failed');
  assert.ok(hint.classList.contains('tdf-warn'));
});

test('a hidden sender with no saved lines stays listed, marked hidden, so it can be unhidden', async () => {
  const settings = stubSettings({ hiddenSenders: ['Gone%20Guy'] });
  const { container } = setup({ limits: stubLimits({ stored: { carol: 1 } }), settings });
  await settle();
  const { select, toggle } = senderControl(container);
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [['carol', 'carol (1)'], ['Gone%20Guy', 'Gone Guy (0, hidden)']],
  );
  choose(select, 'Gone%20Guy');
  assert.equal(toggle.textContent, 'Unhide');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), [[]]);
  assert.deepEqual([...select.options].map((o) => o.value), ['carol']);
});

test('with no saved history a hidden sender still lists and can be unhidden', async () => {
  const settings = stubSettings({ hiddenSenders: ['amy'] });
  const { container } = setup({ settings });
  await settle();
  const { select, toggle } = senderControl(container);
  assert.equal(select.disabled, false);
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.textContent, 'Unhide');
  toggle.click();
  await settle();
  assert.equal(select.options[0]?.textContent, 'No saved history');
  assert.equal(toggle.disabled, true);
});

test('a failed hide write leaves the label and set unchanged and says so', async () => {
  const settings = stubSettings({}, { failSet: ['hiddenSenders'] });
  const { container } = setup({ limits: stubLimits({ stored: { 'Big%20Bob': 2 } }), settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  toggle.click();
  await settle();
  assert.equal(hint.textContent, 'Could not hide: write failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(toggle.textContent, 'Hide');
  assert.equal(toggle.disabled, false);
  assert.deepEqual(settings.store.hiddenSenders, []);
  assert.equal(select.options[0]?.textContent, 'Big Bob (2)');
});

test('a failed unhide write keeps the sender hidden and says so', async () => {
  const settings = stubSettings({ hiddenSenders: ['bob'] }, { failSet: ['hiddenSenders'] });
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle, hint } = senderControl(container);
  toggle.click();
  await settle();
  assert.equal(hint.textContent, 'Could not unhide: write failed');
  assert.equal(toggle.textContent, 'Unhide');
  assert.deepEqual(settings.store.hiddenSenders, ['bob']);
});

test('the toggle is disabled while its write runs', async () => {
  /** @type {() => void} */
  let release = () => {};
  const settings = stubSettings();
  const set = settings.set;
  settings.set = (key, value) => new Promise((r) => (release = () => r(set(key, value))));
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle } = senderControl(container);
  toggle.click();
  assert.equal(toggle.disabled, true);
  await settle();
  assert.equal(toggle.disabled, true, 'still disabled while the write is pending');
  release();
  await settle();
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.textContent, 'Unhide');
});

test('an unreadable hidden set warns and disables the toggle; the senders still list', async () => {
  const settings = stubSettings({}, { failRead: ['hiddenSenders'] });
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  assert.equal(hint.textContent, 'Could not read hidden senders: read failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(toggle.disabled, true);
  assert.equal(select.options[0]?.textContent, 'bob (1)');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), []);
});

test('a toggle write that settles after close writes no hint', async () => {
  /** @type {() => void} */
  let release = () => {};
  const settings = stubSettings();
  const set = settings.set;
  settings.set = (key, value) => new Promise((r) => (release = () => r(set(key, value))));
  const { container, cleanup } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle, hint } = senderControl(container);
  toggle.click();
  await settle();
  cleanup();
  release();
  await settle();
  assert.equal(hint.textContent, '');
});

test('a toggle failure that settles after close writes no hint', async () => {
  /** @type {() => void} */
  let release = () => {};
  const settings = stubSettings({}, { failSet: ['hiddenSenders'] });
  const set = settings.set;
  settings.set = (key, value) => new Promise((r) => (release = () => r(set(key, value))));
  const { container, cleanup } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle, hint } = senderControl(container);
  toggle.click();
  await settle();
  cleanup();
  release();
  await settle();
  assert.equal(hint.textContent, '');
});

test('a toggle keeps a change another tab made to the hidden set since it was read', async () => {
  const settings = stubSettings({ hiddenSenders: ['carol'] });
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1, carol: 1 } }), settings });
  await settle();
  const { select, toggle, hint } = senderControl(container);
  settings.store.hiddenSenders = ['carol', 'zed'];
  assert.equal(select.value, 'bob');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), [['bob', 'carol', 'zed']]);
  assert.equal(hint.textContent, 'Hid messages from bob.');
  assert.equal(toggle.textContent, 'Unhide');
});

test('a toggle applies its label to the fresh set: Hide on a sender another tab hid keeps them hidden', async () => {
  const settings = stubSettings();
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle } = senderControl(container);
  settings.store.hiddenSenders = ['bob'];
  assert.equal(toggle.textContent, 'Hide');
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), [['bob']]);
  assert.equal(toggle.textContent, 'Unhide');
});

test('a failed read before a toggle writes nothing and says why', async () => {
  const settings = stubSettings();
  const { container } = setup({ limits: stubLimits({ stored: { bob: 1 } }), settings });
  await settle();
  const { toggle, hint } = senderControl(container);
  const get = settings.get;
  settings.get = async (key) => {
    settings.get = get;
    if (key === 'hiddenSenders') throw new Error('read failed');
    return get(key);
  };
  toggle.click();
  await settle();
  assert.deepEqual(hiddenWrites(settings), []);
  assert.equal(hint.textContent, 'Could not hide: read failed');
  assert.ok(hint.classList.contains('tdf-warn'));
  assert.equal(toggle.textContent, 'Hide');
  assert.equal(toggle.disabled, false);
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

test('Cancel is disabled while a deletion runs', async () => {
  /** @type {(ids: string[]) => void} */
  let done = () => {};
  const limits = stubLimits({ stored: { a: 2 } });
  limits.clearHistory = () => new Promise((r) => (done = r));
  const { container } = setup({ limits });
  const { clear, idle, ask, yes, no, hint } = clearControl(container);
  clear.click();
  await settle();
  yes.click();
  assert.equal(no.disabled, true);
  no.click();
  assert.equal(ask.hidden, false);
  assert.equal(idle.hidden, true);
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
  const { select, toggle: remove, hint } = senderControl(container);
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
  // After Auto-scroll, and ahead of the history rows.
  assert.match(String(row.previousElementSibling?.textContent), /^Auto-scroll$/);
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
  // The labelled rows after the second header, in DOM order.
  /** @type {string[]} */
  const rows = [];
  for (let node = sections[1].nextElementSibling; node; node = node.nextElementSibling) {
    if (node.matches('.tdf-opt-row, label.tdf-opt-field')) rows.push(String(node.querySelector('span')?.textContent));
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
    if (node.matches('.tdf-opt-row, label.tdf-opt-field')) rows.push(String(node.querySelector('span')?.textContent));
  }
  assert.deepEqual(rows, [
    'Use Chat 2.0',
    'Auto-scroll',
    'Collapse server history automatically',
    HISTORY,
    'Hide messages by user',
    ...USER_OPTION_ROWS.map(([, label]) => label),
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

// TDF-0080: the engine's User Options as native rows.

test('User options is a subheading in the Chat section after Hide messages by user, six rows in engine order, no Modern Message Style', () => {
  const { container } = setup({ userOptions: {} });
  const sub = container.querySelector('.tdf-opt-subsection');
  assert.equal(sub?.textContent, 'User options');
  assert.equal(sub?.classList.contains('tdf-opt-section'), false, 'not a third section');
  const [, media] = [...container.querySelectorAll('.tdf-opt-section')];
  /** @type {string[]} */
  const labels = [];
  for (let node = sub?.nextElementSibling; node && node !== media; node = node.nextElementSibling) {
    if (node.matches('label.tdf-opt-row')) labels.push(String(node.querySelector('span')?.textContent));
  }
  assert.deepEqual(labels, USER_OPTION_ROWS.map(([, label]) => label));
  assert.ok(![...container.querySelectorAll('label')].some((l) => /message style/i.test(l.textContent ?? '')));
  for (const [, label] of USER_OPTION_ROWS) assert.ok(boxFor(container, label).matches('input.tdf-opt-switch'));
});

test('each User options row opens showing the engine checkbox: the defaults, and a stored cookie value', () => {
  const defaults = setup({ userOptions: {} });
  for (const [id, label] of USER_OPTION_ROWS) {
    assert.equal(boxFor(defaults.container, label).checked, ENGINE_DEFAULTS[id], label);
  }
  /** @type {Record<string, boolean>} */
  const flipped = Object.fromEntries(USER_OPTION_ROWS.map(([id]) => [id, !ENGINE_DEFAULTS[id]]));
  const stored = setup({ userOptions: { values: flipped } });
  for (const [id, label] of USER_OPTION_ROWS) assert.equal(boxFor(stored.container, label).checked, flipped[id], label);
});

test('toggling each User options row sets the engine checkbox, its global and the myOptions cookie, keeping userMessStyle', () => {
  for (const [index, [id, label]] of USER_OPTION_ROWS.entries()) {
    const { win, doc, container } = setup({ userOptions: {} });
    const global = ENGINE_OPTIONS[index][1];
    const box = boxFor(container, label);
    const before = box.checked;
    /** @type {string[]} */
    const seen = [];
    doc.addEventListener('change', (e) => seen.push(/** @type {Element} */ (e.target).id));
    box.checked = !before;
    box.dispatchEvent(new win.Event('change'));
    const engine = /** @type {HTMLInputElement} */ (doc.getElementById(id));
    assert.equal(engine.checked, !before, `${label}: engine checkbox`);
    assert.equal(win[global], !before, `${label}: engine global`);
    const parts = ENGINE_OPTIONS.map(([oid]) => (oid === id ? !before : ENGINE_DEFAULTS[oid]));
    assert.deepEqual(win.cookies, [`myOptions=${encodeURI(parts.join('|'))}`], `${label}: cookie`);
    assert.equal(win.userMessStyle, true, `${label}: userMessStyle kept`);
    assert.ok(seen.includes(id), `${label}: a bubbling change on the engine box`);
  }
});

test('userMessStyle off is written back off', () => {
  const { win, container } = setup({ userOptions: { values: { userMessStyle: false } } });
  const box = boxFor(container, 'Play SFX');
  box.checked = false;
  box.dispatchEvent(new win.Event('change'));
  assert.equal(win.userMessStyle, false);
  assert.match(win.cookies[0], /%7Cfalse$/);
});

test('a User options row whose engine checkbox is absent is disabled and says why', () => {
  const { container } = setup({ userOptions: { omit: ['viewMyCamID'] } });
  const webcam = boxFor(container, 'Allow webcam access');
  assert.equal(webcam.disabled, true);
  assert.equal(webcam.closest('label')?.nextElementSibling?.textContent, 'Not available: the chat has no #viewMyCamID');
  const pm = boxFor(container, 'Allow private chat');
  assert.equal(pm.disabled, false);
  assert.equal(pm.closest('label')?.nextElementSibling?.textContent, '');
});

test('a User options row follows its engine checkbox while open, and stops after cleanup', () => {
  const { win, doc, container, cleanup } = setup({ userOptions: {} });
  const box = boxFor(container, 'Play SFX');
  const engine = /** @type {HTMLInputElement} */ (doc.getElementById('sfxID'));
  engine.checked = false;
  engine.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(box.checked, false);
  cleanup();
  engine.checked = true;
  engine.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(box.checked, false, 'no longer followed');
});

test('an updateUserSettings that throws after writing the globals has them put back', () => {
  const { win, doc, container } = setup({ userOptions: { update: 'throwsAfterGlobals' } });
  const box = boxFor(container, 'Play new message sound');
  box.checked = false;
  box.dispatchEvent(new win.Event('change'));
  assert.equal(box.checked, true);
  assert.equal(/** @type {HTMLInputElement} */ (doc.getElementById('soundsID')).checked, true);
  assert.equal(win.userNewMessageSFX, true, 'global restored by the second call');
  assert.match(String(box.closest('label')?.nextElementSibling?.textContent), /^Could not apply: .*the chat may still use the new setting/);
});

test('without the engine options every User options row is disabled and says why', () => {
  const { container } = setup();
  for (const [id, label] of USER_OPTION_ROWS) {
    const box = boxFor(container, label);
    assert.equal(box.disabled, true, label);
    assert.equal(box.closest('label')?.nextElementSibling?.textContent, `Not available: the chat has no #${id}`, label);
  }
});

for (const update of /** @type {const} */ (['missing', 'throws'])) {
  test(`an updateUserSettings that is ${update} reverts both checkboxes and says so`, () => {
    const { win, doc, container } = setup({ userOptions: { update } });
    let changes = 0;
    doc.getElementById('soundsID')?.addEventListener('change', () => changes++);
    const box = boxFor(container, 'Play new message sound');
    box.checked = false;
    box.dispatchEvent(new win.Event('change'));
    assert.equal(box.checked, true);
    assert.equal(/** @type {HTMLInputElement} */ (doc.getElementById('soundsID')).checked, true);
    assert.equal(win.userNewMessageSFX, true);
    assert.deepEqual(win.cookies, []);
    assert.equal(changes, 0, 'no change announced');
    const hint = box.closest('label')?.nextElementSibling;
    assert.match(String(hint?.textContent), /^Could not apply: /);
    // A later write that succeeds clears the warning.
    win.updateUserSettings = () => {};
    box.checked = false;
    box.dispatchEvent(new win.Event('change'));
    assert.equal(hint?.textContent, '');
  });
}
