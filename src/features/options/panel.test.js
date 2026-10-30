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

/** A settings stand-in over a plain object; `fail` makes every read reject. */
function stubSettings(values = {}, { fail = false } = {}) {
  /** @type {Record<string, unknown>} */
  const store = { retentionDays: 30, galleryLimitMB: null, includeMyImages: false, storeImagesOffline: false, ...values };
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
      writes.push([key, value]);
      store[key] = value;
    },
  };
}

/**
 * A limits stand-in: previews report `lines` / `images`, prunes and deletions are recorded.
 * `stored` is the saved history's line count by sender, which Clear and delete-by-user empty.
 */
function stubLimits({ lines = 0, images = 0, failPrune = false, stored = {}, failDelete = false } = {}) {
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
    async previewHistory(/** @type {number | null} */ days) {
      calls.push(['previewHistory', days]);
      return lines;
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

function setup({ settings = stubSettings(), limits = stubLimits(), engine = true, loadFailure = undefined } = {}) {
  const win = /** @type {any} */ (new Window());
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
  const [history, gallery] = /** @type {HTMLInputElement[]} */ ([...container.querySelectorAll('.tdf-opt-field input')]);
  const hints = () => [...container.querySelectorAll('.tdf-opt-field + .tdf-opt-hint')].map((h) => h.textContent);
  /** @param {HTMLInputElement} input @param {string} value @param {'input' | 'change'} type */
  const type = (input, value, typeName = 'input') => {
    input.value = value;
    input.dispatchEvent(new win.Event(typeName));
  };
  return { win, doc, container, cleanup, history, gallery, hints, type, settings, limits };
}

test('fields show the stored values and their hints on open', async () => {
  const { history, gallery, hints } = setup({ settings: stubSettings({ retentionDays: 7, galleryLimitMB: 50 }) });
  await settle();
  assert.equal(history.value, '7');
  assert.equal(gallery.value, '50');
  assert.deepEqual(hints(), [
    'Lines older than 7 days are deleted, oldest first.',
    '3.0 MB used. Oldest images go first; favorites are kept.',
  ]);
});

test('a stored null shows empty fields: all history kept, no gallery limit', async () => {
  const { history, gallery, hints } = setup({ settings: stubSettings({ retentionDays: null, galleryLimitMB: null }) });
  await settle();
  assert.equal(history.value, '');
  assert.equal(gallery.value, '');
  assert.deepEqual(hints(), [
    'Keeping all history. Enter 0 or more days to set a limit.',
    'No limit. 3.0 MB used.',
  ]);
});

test('a settings read that fails is shown under the history field', async () => {
  const { hints, container } = setup({ settings: stubSettings({}, { fail: true }) });
  await settle();
  assert.equal(hints()[0], 'Could not read settings: read failed');
  assert.ok(container.querySelector('.tdf-opt-hint.tdf-warn'));
});

test('typing previews what would be deleted and writes nothing', async () => {
  const { history, gallery, hints, type, settings, limits } = setup({ limits: stubLimits({ lines: 4, images: 2 }) });
  await settle();
  type(history, '1');
  type(gallery, '10');
  await settle();
  assert.deepEqual(hints(), [
    'Lines older than 1 day are deleted, oldest first. This removes 4 lines now.',
    '3.0 MB used. Oldest images go first; favorites are kept. This removes 2 images (2.0 MB) now.',
  ]);
  type(history, '0');
  await settle();
  assert.equal(hints()[0], 'No chat history is kept. This removes 4 lines now.');
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('an invalid typed value is refused in the hint, and committing it does nothing', async () => {
  const { history, gallery, hints, type, settings, limits } = setup();
  await settle();
  type(history, '-2');
  type(gallery, '0');
  await settle();
  assert.deepEqual(hints(), ['Enter 0 or more whole days.', 'Enter 1 MB or more, or leave empty for no limit.']);
  type(history, '-2', 'change');
  type(gallery, '0', 'change');
  await settle();
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('emptying the history field over a stored limit warns that the limit stays, and commits nothing', async () => {
  const { history, hints, type, settings, limits } = setup();
  await settle();
  type(history, '');
  await settle();
  assert.equal(hints()[0], 'Enter 0 or more whole days. The current 30 days limit stays.');
  type(history, '', 'change');
  await settle();
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('a number the browser cannot parse is refused, not read as empty', async () => {
  const { history, gallery, hints, type, settings, limits } = setup({
    settings: stubSettings({ retentionDays: null, galleryLimitMB: 50 }),
  });
  await settle();
  for (const input of [history, gallery]) Object.defineProperty(input, 'validity', { value: { badInput: true } });
  type(history, '');
  type(gallery, '');
  await settle();
  assert.deepEqual(hints(), ['Enter 0 or more whole days.', 'Enter 1 MB or more, or leave empty for no limit.']);
  type(history, '', 'change');
  type(gallery, '', 'change');
  await settle();
  assert.deepEqual(settings.writes, []);
  assert.ok(!limits.calls.some(([name]) => String(name).startsWith('prune')));
});

test('committing writes the setting, then applies the limit', async () => {
  const { history, gallery, type, settings, limits } = setup();
  await settle();
  type(history, '1', 'change');
  type(gallery, '', 'change');
  await settle();
  assert.deepEqual(settings.writes, [
    ['retentionDays', 1],
    ['galleryLimitMB', null],
  ]);
  assert.ok(limits.calls.some(([n, v]) => n === 'pruneHistory' && v === 1));
  assert.ok(limits.calls.some(([n, v]) => n === 'pruneGallery' && v === null));
});

test('a commit that fails says so under its field', async () => {
  const { history, hints, type } = setup({ limits: stubLimits({ failPrune: true }) });
  await settle();
  type(history, '2', 'change');
  await settle();
  assert.equal(hints()[0], 'Could not apply: prune failed');
});

test('Auto-scroll mirrors the engine checkbox both ways, and stops following on close', async () => {
  const { win, doc, container, cleanup } = setup();
  const mine = /** @type {HTMLInputElement} */ (container.querySelector('.tdf-opt-switch'));
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
  assert.equal(/** @type {HTMLInputElement} */ (container.querySelector('.tdf-opt-switch')).disabled, true);
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
  const { cleanup, hints, history, type } = setup();
  await settle();
  const shown = hints();
  type(history, '3');
  cleanup();
  await settle();
  assert.deepEqual(hints(), shown);
});

test('Include my images is a checkbox row after the gallery limit, showing the stored value', async () => {
  for (const on of [false, true]) {
    const { container } = setup({ settings: stubSettings({ includeMyImages: on }) });
    await settle();
    const box = /** @type {HTMLInputElement} */ (container.querySelector('input.tdf-opt-check'));
    assert.equal(box.type, 'checkbox');
    assert.equal(box.classList.contains('tdf-opt-switch'), false);
    assert.equal(box.checked, on);
    const row = /** @type {HTMLElement} */ (box.closest('label.tdf-opt-row'));
    assert.equal(row.textContent, 'Include my images');
    // Directly after the Gallery size limit field and its hint.
    const before = row.previousElementSibling;
    assert.ok(before?.classList.contains('tdf-opt-hint'));
    assert.match(String(before?.previousElementSibling?.textContent), /Gallery size limit/);
  }
});

test('toggling Include my images writes the setting; a failed write says so', async () => {
  const settings = stubSettings();
  const { win, container } = setup({ settings });
  await settle();
  const box = /** @type {HTMLInputElement} */ (container.querySelector('input.tdf-opt-check'));
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
  const box = /** @type {HTMLInputElement} */ (container.querySelector('input.tdf-opt-check'));
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
  const box = /** @type {HTMLInputElement} */ (container.querySelector('input.tdf-opt-check'));
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
  const [mine, offline] = /** @type {HTMLInputElement[]} */ ([...container.querySelectorAll('input.tdf-opt-check')]);
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

/** The Delete messages by user control. */
const senderControl = (/** @type {HTMLElement} */ container) => {
  const select = /** @type {HTMLSelectElement} */ (container.querySelector('.tdf-opt-sender select'));
  const remove = /** @type {HTMLButtonElement} */ (select.closest('label')?.nextElementSibling);
  const ask = /** @type {HTMLElement} */ (remove.nextElementSibling);
  const hint = /** @type {HTMLElement} */ (ask.nextElementSibling);
  return { select, remove, ask, hint, yes: button(ask, 'Confirm'), no: button(ask, 'Cancel') };
};

const deletions = (/** @type {{ calls: unknown[][] }} */ limits) =>
  limits.calls.filter(([name]) => name === 'clearHistory' || name === 'deleteByUser');

test('Clear history now and Delete messages by user sit after the Chat history field', () => {
  const { container } = setup();
  const { clear } = clearControl(container);
  const historyHint = /** @type {HTMLElement} */ (clear.previousElementSibling);
  assert.match(String(historyHint.previousElementSibling?.textContent), /Chat history/);
  const { remove, hint } = senderControl(container);
  assert.match(String(remove.previousElementSibling?.textContent), /^Delete messages by user/);
  assert.match(String(hint.nextElementSibling?.textContent), /Gallery size limit/);
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
  assert.equal(remove.textContent, 'Delete');
});

test('with no saved history the sender picker and its Delete button are disabled', async () => {
  const { container } = setup();
  await settle();
  const { select, remove } = senderControl(container);
  assert.equal(select.disabled, true);
  assert.equal(remove.disabled, true);
  assert.equal(select.options[0]?.textContent, 'No saved history');
});

test('Delete messages by user asks, deletes the chosen sender once, and refreshes the list', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } });
  const { container } = setup({ limits });
  await settle();
  const { select, remove, ask, yes, no, hint } = senderControl(container);
  select.value = 'Big%20Bob';
  remove.click();
  await settle();
  assert.equal(ask.querySelector('span')?.textContent, 'Delete 2 messages from Big Bob?');
  no.click();
  assert.deepEqual(deletions(limits), []);
  remove.click();
  await settle();
  yes.click();
  await settle();
  assert.deepEqual(deletions(limits), [['deleteByUser', 'Big%20Bob']]);
  assert.equal(hint.textContent, 'Deleted 2 messages.');
  assert.deepEqual([...select.options].map((o) => o.value), ['carol']);
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

test('a sender with nothing left to delete says so and asks nothing', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2 } });
  limits.countByUser = async () => 0;
  const { container } = setup({ limits });
  await settle();
  const { remove, ask, hint } = senderControl(container);
  remove.click();
  await settle();
  assert.equal(hint.textContent, 'No saved messages from Big Bob.');
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

test('a sender list that fails to read is reported under Delete', async () => {
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

test('Delete messages by user deletes the sender it asked about, with the picker locked meanwhile', async () => {
  const limits = stubLimits({ stored: { 'Big%20Bob': 2, carol: 1 } });
  const { container, history, type } = setup({ limits });
  await settle();
  const { select, remove, ask, yes, no } = senderControl(container);
  select.value = 'Big%20Bob';
  remove.click();
  await settle();
  assert.equal(ask.querySelector('span')?.textContent, 'Delete 2 messages from Big Bob?');
  assert.equal(select.disabled, true);
  no.click();
  assert.equal(select.disabled, false);
  remove.click();
  await settle();
  // A refresh while the question is open does not unlock the picker.
  const reads = limits.calls.filter(([name]) => name === 'senders').length;
  type(history, '2', 'change');
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

test('a sender list that fails to read disables the picker and Delete; a later read clears the warning', async () => {
  const limits = stubLimits({ stored: { carol: 1 } });
  const read = limits.senders;
  limits.senders = async () => {
    throw new Error('read failed');
  };
  const { container, history, type } = setup({ limits });
  await settle();
  const { select, remove, hint } = senderControl(container);
  assert.equal(select.disabled, true);
  assert.equal(remove.disabled, true);
  limits.senders = read;
  type(history, '5', 'change');
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
  const { container, history, type } = setup({ limits });
  await settle();
  const { hint } = senderControl(container);
  assert.equal(hint.textContent, 'Could not read saved senders: read failed');
  // Stands in for a report written over the warning before the next read.
  hint.textContent = 'Deleted 1 message.';
  hint.classList.remove('tdf-warn');
  fail = false;
  type(history, '2', 'change');
  await settle();
  assert.equal(hint.textContent, 'Deleted 1 message.');
});

test('committing Chat history refreshes the sender list after the prune', async () => {
  const limits = stubLimits({ stored: { carol: 1 } });
  const { container, history, type } = setup({ limits });
  await settle();
  limits.calls.length = 0;
  type(history, '2', 'change');
  await settle();
  const names = limits.calls.map(([name]) => name);
  assert.ok(names.indexOf('senders') > names.indexOf('pruneHistory'));
  assert.ok(names.includes('pruneHistory'));
  assert.deepEqual([...senderControl(container).select.options].map((o) => o.value), ['carol']);
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
