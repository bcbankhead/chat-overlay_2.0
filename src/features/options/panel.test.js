import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { renderSettings } from './panel.js';
import { MB_BYTES } from './selectors.js';

const settle = () => new Promise((r) => setTimeout(r, 20));

/** A settings stand-in over a plain object; `fail` makes every read reject. */
function stubSettings(values = {}, { fail = false } = {}) {
  /** @type {Record<string, unknown>} */
  const store = { retentionDays: 30, galleryLimitMB: null, includeMyImages: false, ...values };
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

/** A limits stand-in: previews report `lines` / `images`, prunes are recorded. */
function stubLimits({ lines = 0, images = 0, failPrune = false } = {}) {
  /** @type {unknown[][]} */
  const calls = [];
  return {
    calls,
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
      return mb === null ? null : { ids: [], count: images, bytes: images * MB_BYTES };
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
    galleryBytes: async () => 3 * MB_BYTES,
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

test('Clear chat buffer calls the engine clrScreen and empties the overlay rows', () => {
  const { win, doc, container } = setup();
  let cleared = 0;
  win.clrScreen = () => cleared++;
  /** @type {HTMLButtonElement} */ (container.querySelector('.tdf-opt-clear')).click();
  assert.equal(cleared, 1);
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 0);
});

test('Clear chat buffer without the engine clrScreen still empties the overlay rows', () => {
  const { doc, container } = setup();
  /** @type {HTMLButtonElement} */ (container.querySelector('.tdf-opt-clear')).click();
  assert.equal(doc.querySelectorAll('#tdf-chat .tdf-msg').length, 0);
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
