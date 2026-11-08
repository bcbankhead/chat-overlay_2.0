import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { STORES, openDb } from '../src/core/db.js';
import {
  SEEN_CAP,
  SEEN_REFRESH_MS,
  SEEN_TTL_MS,
  createSeenUsers,
  needsWrite,
  prunePlan,
} from '../src/core/seenUsers.js';

let n = 0;
const fresh = () => openDb({ name: `seen-${++n}` });

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_000 * DAY;

/** @param {IDBDatabase} db */
const all = (db) =>
  new Promise((resolve, reject) => {
    const req = db.transaction(STORES.seenUsers).objectStore(STORES.seenUsers).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** @param {IDBDatabase} db @param {object[]} records */
const seed = (db, records) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.seenUsers, 'readwrite');
    for (const r of records) tx.objectStore(STORES.seenUsers).put(r);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });

/** Let queued IndexedDB writes settle. */
const settle = () => new Promise((r) => setTimeout(r, 20));

/** An IDBDatabase stand-in whose `put` counts, wrapping a real one. */
const counting = (db) => {
  const counter = { puts: 0 };
  const wrapped = {
    transaction(...args) {
      const tx = db.transaction(...args);
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name) => {
        const store = objectStore(name);
        const put = store.put.bind(store);
        store.put = (v) => (counter.puts++, put(v));
        return store;
      };
      return tx;
    },
  };
  return { db: /** @type {IDBDatabase} */ (/** @type {unknown} */ (wrapped)), counter };
};

const alice = { uuID: '12', userID: '912', rawName: 'Alice' };

/** Resolves when `seen` next tells its subscribers: its load has finished. */
const whenLoaded = (seen) =>
  new Promise((resolve) => {
    const off = seen.subscribe(() => {
      off();
      resolve(seen);
    });
  });

/** A seen-users store, resolved once its load has finished. */
const loaded = (deps) => whenLoaded(createSeenUsers(deps));

test('a user seen online is saved with their forum id, encoded name and time', async () => {
  const db = await fresh();
  const seen = await loaded({ db, now: () => T0 });
  seen.remember(alice);
  assert.deepEqual(seen.get('12'), { userID: '912', rawName: 'Alice' });
  await settle();
  assert.deepEqual(await all(db), [{ ...alice, at: T0 }]);
  db.close();
});

test('seeing the same user again writes nothing until a day has passed or a field changed', async () => {
  const real = await fresh();
  const { db, counter } = counting(real);
  let now = T0;
  const seen = await loaded({ db, now: () => now });
  seen.remember(alice);
  for (let i = 0; i < 5; i++) seen.remember({ ...alice }); // every poll re-renders
  now = T0 + SEEN_REFRESH_MS - 1;
  seen.remember(alice);
  assert.equal(counter.puts, 1, 'no rewrite when unchanged');
  now = T0 + SEEN_REFRESH_MS;
  seen.remember(alice);
  assert.equal(counter.puts, 2, 'the 24h refresh');
  seen.remember({ ...alice, rawName: 'Alice%20B' });
  assert.equal(counter.puts, 3, 'a changed name is rewritten at once');
  seen.remember({ ...alice, rawName: 'Alice%20B', userID: '1912' });
  assert.equal(counter.puts, 4, 'a changed id is rewritten at once');
  await settle();
  assert.deepEqual(await all(real), [{ uuID: '12', userID: '1912', rawName: 'Alice%20B', at: T0 + SEEN_REFRESH_MS }]);
  real.close();
});

test('a user with no forum id is not saved', async () => {
  const db = await fresh();
  const seen = await loaded({ db, now: () => T0 });
  seen.remember({ uuID: '30', userID: '', rawName: 'Guest' });
  assert.equal(seen.get('30'), undefined);
  await settle();
  assert.deepEqual(await all(db), []);
  db.close();
});

test('after a simulated reload a new instance on the same database finds the user and tells subscribers once', async () => {
  const db = await fresh();
  const first = await loaded({ db, now: () => T0 });
  first.remember(alice);
  await settle();

  const second = createSeenUsers({ db, now: () => T0 + DAY });
  assert.equal(second.get('12'), undefined, 'not yet loaded');
  let told = 0;
  second.subscribe(() => told++);
  await whenLoaded(second);
  await settle();
  assert.equal(told, 1);
  assert.deepEqual(second.get('12'), { userID: '912', rawName: 'Alice' });
  db.close();
});

test('a subscriber added after the load has finished is told once, on a microtask', async () => {
  const db = await fresh();
  const seen = await loaded({ db, now: () => T0 });
  let told = 0;
  seen.subscribe(() => told++);
  assert.equal(told, 0, 'not synchronously');
  await Promise.resolve();
  assert.equal(told, 1);
  await settle();
  assert.equal(told, 1, 'only once');
  db.close();
});

test('a late subscriber that unsubscribes at once is not told', async () => {
  const db = await fresh();
  const seen = await loaded({ db, now: () => T0 });
  let told = 0;
  const off = seen.subscribe(() => told++);
  off();
  await settle();
  assert.equal(told, 0);
  db.close();
});

test('a late subscriber that throws is reported', async () => {
  const db = await fresh();
  const reported = [];
  const seen = await loaded({ db, now: () => T0, report: (err) => reported.push(err) });
  seen.subscribe(() => {
    throw new Error('late boom');
  });
  await settle();
  assert.deepEqual(reported.map((e) => e.message), ['late boom']);
  db.close();
});

test('the load deletes records older than 90 days', async () => {
  const db = await fresh();
  await seed(db, [
    { uuID: 'old', userID: '1', rawName: 'Old', at: T0 - SEEN_TTL_MS - 1 },
    { uuID: 'edge', userID: '2', rawName: 'Edge', at: T0 - SEEN_TTL_MS },
    { uuID: 'new', userID: '3', rawName: 'New', at: T0 - DAY },
  ]);
  const seen = await loaded({ db, now: () => T0 });
  assert.equal(seen.get('old'), undefined);
  assert.ok(seen.get('edge'));
  assert.ok(seen.get('new'));
  assert.deepEqual((await all(db)).map((r) => r.uuID).sort(), ['edge', 'new']);
  db.close();
});

test(`the load keeps only the newest ${SEEN_CAP} records`, async () => {
  const db = await fresh();
  await seed(
    db,
    Array.from({ length: SEEN_CAP + 3 }, (_, i) => ({ uuID: `u${i}`, userID: `${i}`, rawName: `U${i}`, at: T0 - DAY + i })),
  );
  const seen = await loaded({ db, now: () => T0 });
  const left = /** @type {any[]} */ (await all(db));
  assert.equal(left.length, SEEN_CAP);
  for (const gone of ['u0', 'u1', 'u2']) {
    assert.equal(seen.get(gone), undefined);
    assert.ok(!left.some((r) => r.uuID === gone));
  }
  assert.ok(seen.get(`u${SEEN_CAP + 2}`));
  db.close();
});

test('a user remembered while the load runs is not replaced by the stored record', async () => {
  const db = await fresh();
  await seed(db, [{ uuID: '12', userID: 'old', rawName: 'Alice', at: T0 - DAY }]);
  const seen = createSeenUsers({ db, now: () => T0 });
  const done = whenLoaded(seen);
  seen.remember(alice);
  await done;
  assert.deepEqual(seen.get('12'), { userID: '912', rawName: 'Alice' });
  await settle();
  assert.equal((await all(db))[0].userID, '912');
  db.close();
});

test('a failed read or write is reported, and the lookup answers undefined', async () => {
  const reported = [];
  const broken = /** @type {IDBDatabase} */ (
    /** @type {unknown} */ ({
      transaction() {
        throw new Error('disk gone');
      },
    })
  );
  const seen = await loaded({ db: broken, now: () => T0, report: (err) => reported.push(err) });
  assert.equal(seen.get('12'), undefined);
  seen.remember(alice);
  await settle();
  assert.deepEqual(reported.map((e) => e.message), ['disk gone', 'disk gone']);
});

test('a closing database is not reported', async () => {
  const reported = [];
  const closing = /** @type {IDBDatabase} */ (
    /** @type {unknown} */ ({
      transaction() {
        throw Object.assign(new Error('closing'), { name: 'InvalidStateError' });
      },
    })
  );
  const seen = await loaded({ db: closing, now: () => T0, report: (err) => reported.push(err) });
  seen.remember(alice);
  await settle();
  assert.deepEqual(reported, []);
});

test('the default report goes to console.error', async () => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await loaded({
      db: /** @type {IDBDatabase} */ (/** @type {unknown} */ ({ transaction: () => { throw new Error('x'); } })),
    });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Seen users:');
});

test('prunePlan drops by age first, then by count, newest kept', () => {
  const rec = (uuID, at) => ({ uuID, userID: '1', rawName: uuID, at });
  const { keep, drop } = prunePlan([rec('a', 0), rec('b', 50), rec('c', 90), rec('d', 100)], 100, 60, 2);
  assert.deepEqual(keep.map((r) => r.uuID), ['d', 'c']);
  assert.deepEqual(drop.sort(), ['a', 'b']);
});

test('needsWrite: new, changed, or a refresh old; never without an id', () => {
  const prev = { ...alice, at: 0 };
  assert.equal(needsWrite(undefined, alice, 0), true);
  assert.equal(needsWrite(prev, alice, SEEN_REFRESH_MS - 1), false);
  assert.equal(needsWrite(prev, alice, SEEN_REFRESH_MS), true);
  assert.equal(needsWrite(prev, { ...alice, userID: '1' }, 1), true);
  assert.equal(needsWrite(undefined, { ...alice, userID: '' }, 0), false);
  assert.equal(needsWrite(undefined, { ...alice, uuID: '' }, 0), false);
});
