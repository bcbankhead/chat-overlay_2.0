import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { STORES, openDb, request } from '../../core/db.js';
import { createHistory } from '../../core/history.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { deriveTags } from './infer.js';
import { createTagStore } from './store.js';

const A = '100000000111111';
const img = (/** @type {string} */ id) => `[[img src="plugins/share/view.php?id=${id}"]]`;

let n = 0;
let at = 0;
/**
 * @param {string} user
 * @param {string} text
 * @param {Partial<import('../../core/history.js').MessageRecord>} [over]
 * @returns {import('../../core/history.js').MessageRecord}
 */
const msg = (user, text, over = {}) => ({
  id: String(++at),
  roomID: '1',
  mTime: String(at),
  user,
  toUser: '',
  kind: 'public',
  avatar: '',
  color: '',
  size: '',
  family: '',
  text,
  ircFlag: '',
  lineBreakFlag: '',
  receivedAt: at,
  ...over,
});

async function fresh() {
  const db = await openDb({ name: `tagging-store-${++n}` });
  const history = createHistory(db);
  const store = createTagStore({ db, history, roomID: '1', me: 'me', codes: CODES });
  /** @returns {Promise<Array<import('./infer.js').Tag & { id: number }>>} */
  const rows = async () => request(db.transaction(STORES.tags).objectStore(STORES.tags).getAll());
  return { db, history, store, rows };
}

test('rebuildRoom derives the room from stored messages and persists the tags', async () => {
  const { history, store, rows } = await fresh();
  const messages = [msg('alice', img(A)), msg('bob', ':h'), msg('me', ':L ^111111')];
  for (const m of messages) await history.put(m);
  await store.rebuildRoom();
  assert.deepEqual(store.reactionsFor(A), [
    { code: ':h', count: 1, mine: false, senders: ['bob'] },
    { code: ':L', count: 1, mine: true, senders: ['me'] },
  ]);
  const stored = (await rows()).map(({ id: _id, ...tag }) => tag);
  assert.deepEqual(stored, deriveTags(messages, 'me', CODES));
});

test('after a purge, a rebuild drops tags whose source is gone, in any room', async () => {
  const { db, history, store, rows } = await fresh();
  const image = msg('alice', img(A));
  const like = msg('bob', ':h');
  for (const m of [image, like]) await history.put(m);
  await store.rebuildRoom();
  // A stale row from another room whose message is gone, and one whose message remains.
  const other = msg('carol', ':d', { roomID: '2' });
  await history.put(other);
  const t = db.transaction(STORES.tags, 'readwrite');
  t.objectStore(STORES.tags).add({ imageId: A, code: ':d', sender: 'carol', roomID: '2', sourceMessageId: other.id, certain: false });
  t.objectStore(STORES.tags).add({ imageId: A, code: ':o', sender: 'dave', roomID: '2', sourceMessageId: 'gone', certain: false });
  await new Promise((r) => (t.oncomplete = r));

  const purge = db.transaction(STORES.messages, 'readwrite');
  purge.objectStore(STORES.messages).delete(like.id);
  await new Promise((r) => (purge.oncomplete = r));
  await store.rebuildRoom();

  assert.deepEqual(store.reactionsFor(A), []);
  assert.deepEqual((await rows()).map((r) => `${r.roomID} ${r.code}`), ['2 :d']);
});

test('applyInbound re-derives the room, and holds what arrives before the first rebuild', async () => {
  const { history, store, rows } = await fresh();
  const image = msg('alice', img(A));
  await history.put(image);
  /** @type {number[]} */
  const changes = [];
  store.onChange(() => changes.push(store.reactionsFor(A).length));
  const early = msg('bob', ':h');
  await store.applyInbound(early);
  assert.deepEqual(store.reactionsFor(A), []);
  await store.rebuildRoom();
  assert.deepEqual(store.reactionsFor(A).map((r) => r.code), [':h']);

  await store.applyInbound(msg('me', ':L ^111111'));
  await store.applyInbound(msg('x', ':o', { roomID: '2' }));
  assert.deepEqual(store.reactionsFor(A).map((r) => r.code), [':h', ':L']);
  assert.deepEqual((await rows()).map((r) => r.code), [':h', ':L']);
  assert.deepEqual(changes, [1, 2]);
});

test('an inbound message that changes no tag neither rewrites the rows nor notifies', async () => {
  const { db, history, store } = await fresh();
  await history.put(msg('alice', img(A)));
  await history.put(msg('bob', ':h'));
  await store.rebuildRoom();
  let changes = 0;
  store.onChange(() => changes++);
  /** @type {string[]} */
  const opened = [];
  const transaction = db.transaction.bind(db);
  db.transaction = /** @type {any} */ ((/** @type {any} */ names, /** @type {any} */ mode) => (opened.push(String(mode)), transaction(names, mode)));
  await store.applyInbound(msg('carol', 'hello'));
  assert.equal(changes, 0);
  assert.deepEqual(opened, [], 'no tags write');
  await store.applyInbound(msg('me', ':L ^111111'));
  assert.equal(changes, 1);
  assert.deepEqual(opened, ['readwrite']);
});

test('a reaction whose echo is later marked unconfirmed is gone after a rebuild', async () => {
  const { history, store } = await fresh();
  await history.put(msg('alice', img(A)));
  await store.rebuildRoom();
  const echo = msg('me', ':h ^111111', { id: 'local-1', mTime: '' });
  await history.addPending(echo);
  await store.applyInbound({ ...echo, confirm: 'pending' });
  assert.equal(store.reactionsFor(A).length, 1);
  await history.markUnconfirmed('local-1');
  await store.rebuildRoom();
  assert.deepEqual(store.reactionsFor(A), []);
});

test('a message that arrives while a rebuild reads is not dropped by it', async () => {
  const { history, store } = await fresh();
  await history.put(msg('alice', img(A)));
  await store.rebuildRoom();
  const rebuilding = store.rebuildRoom();
  // Not yet in history, as when the hook's own write is still queued.
  await store.applyInbound(msg('bob', ':h'));
  await rebuilding;
  assert.deepEqual(store.reactionsFor(A).map((r) => r.code), [':h']);
});
