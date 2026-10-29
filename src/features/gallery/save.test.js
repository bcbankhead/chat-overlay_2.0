import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { saveImage } from './save.js';

const item = (over = {}) => ({
  id: '123456789012345',
  messageId: '1',
  user: 'Dolly Belle',
  mTime: '1761696000',
  roomID: '1',
  receivedAt: 0,
  contentType: 'image/png',
  thumb: null,
  bytes: 0,
  favorite: false,
  broken: false,
  ...over,
});

/** @param {{ picker?: (opts: any) => Promise<any>, ok?: boolean }} [opts] */
function harness({ picker, ok = true } = {}) {
  const page = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  /** @type {string[]} */
  const broken = [];
  /** @type {string[]} */
  const fetched = [];
  /** @type {{ download: string, href: string }[]} */
  const clicked = [];
  const win = {
    location: page.location,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout: () => 0,
    ...(picker ? { showSaveFilePicker: picker } : {}),
  };
  const doc = page.document;
  const create = doc.createElement.bind(doc);
  doc.createElement = (/** @type {string} */ tag) => {
    const el = create(tag);
    if (tag === 'a') el.click = () => clicked.push({ download: el.download, href: el.href });
    return el;
  };
  const store = { markBroken: async (/** @type {string} */ id) => void broken.push(id) };
  /** @type {typeof fetch} */
  const fetch = async (url) => {
    fetched.push(String(url));
    if (!ok) return new Response('gone', { status: 404 });
    return new Response(new Blob([new Uint8Array(10)]), { headers: { 'content-type': 'image/jpeg' } });
  };
  const deps = /** @type {any} */ ({ store, win, doc, fetch });
  return { deps, broken, fetched, clicked };
}

const withUtc = async (/** @type {() => Promise<void>} */ fn) => {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    await fn();
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
};

test('without a stored Blob, Save fetches the share and names the file from the served type', () =>
  withUtc(async () => {
    const h = harness();
    assert.equal(await saveImage(item(), h.deps), 'saved');
    assert.deepEqual(h.fetched, ['https://dollforum.com/forum/chat/plugins/share/view.php?id=123456789012345']);
    assert.deepEqual(h.clicked, [{ download: 'Dolly_Belle_2025-10-29_000000_123456789012345.jpg', href: 'blob:x' }]);
  }));

test('a stored Blob is saved without a fetch', () =>
  withUtc(async () => {
    const h = harness();
    const blob = new Blob([new Uint8Array(3)], { type: 'image/gif' });
    assert.equal(await saveImage(item({ blob, contentType: '' }), h.deps), 'saved');
    assert.deepEqual(h.fetched, []);
    assert.equal(h.clicked[0].download, 'Dolly_Belle_2025-10-29_000000_123456789012345.gif');
  }));

test('a failed fetch marks the image broken and opens no dialog', async () => {
  /** @type {unknown[]} */
  const opened = [];
  const h = harness({ ok: false, picker: async (o) => opened.push(o) });
  assert.equal(await saveImage(item(), h.deps), 'broken');
  assert.deepEqual(h.broken, ['123456789012345']);
  assert.deepEqual(opened, []);
  assert.deepEqual(h.clicked, []);
});

test('showSaveFilePicker opens the dialog with the name and type; closing it is not a failure', async () => {
  /** @type {any[]} */
  const opened = [];
  /** @type {unknown[]} */
  const written = [];
  const writable = { write: async (/** @type {unknown} */ b) => void written.push(b), close: async () => {} };
  const h = harness({ picker: async (o) => (opened.push(o), { createWritable: async () => writable }) });
  assert.equal(await saveImage(item(), h.deps), 'saved');
  assert.match(opened[0].suggestedName, /^Dolly_Belle_.*_123456789012345\.jpg$/);
  assert.deepEqual(opened[0].types, [{ description: 'Image', accept: { 'image/jpeg': ['.jpg'] } }]);
  assert.equal(written.length, 1);
  assert.deepEqual(h.clicked, []);

  const cancel = harness({
    picker: async () => {
      throw Object.assign(new Error('closed'), { name: 'AbortError' });
    },
  });
  assert.equal(await saveImage(item(), cancel.deps), 'cancelled');

  const failing = harness({
    picker: async () => {
      throw new Error('disk full');
    },
  });
  await assert.rejects(saveImage(item(), failing.deps), /disk full/);
});
