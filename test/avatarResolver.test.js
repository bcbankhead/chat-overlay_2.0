import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { AVATAR_TTL_MS, AvatarLookupFailed, MAX_CONCURRENT, createAvatarResolver } from '../src/core/avatarResolver.js';
import { openDb } from '../src/core/db.js';

const BASE = 'https://chat.example.com/forum/';
const happy = new Window();
let n = 0;

const page = (inner) =>
  `<html><body><a class="header-avatar"><img class="avatar" src="./download/file.php?avatar=viewer.jpg"></a>` +
  `<form id="viewprofile">${inner}</form></body></html>`;
const withPicture = (who) => page(`<dt class="profile-avatar"><img class="avatar" src="./download/file.php?avatar=${who}.jpg"></dt>`);

/**
 * A resolver over a fresh database and a scripted fetch. `answer(url)` returns the page
 * HTML, a status number, or throws.
 */
async function setup({ answer = (url) => withPicture(new URL(url).searchParams.get('u') ?? 'byname'), clock = { t: 1000 }, DOMParser = happy.DOMParser } = {}) {
  const db = await openDb({ name: `avatars-${++n}` });
  const fetched = [];
  let active = 0;
  let peak = 0;
  /** @type {Array<() => void>} */
  const gates = [];
  let gated = false;
  const fetch = async (url, init) => {
    fetched.push({ url, init });
    active += 1;
    peak = Math.max(peak, active);
    try {
      if (gated) await new Promise((r) => gates.push(r));
      const body = answer(url);
      if (typeof body === 'number') return { ok: false, status: body, url, text: async () => '' };
      return { ok: true, status: 200, url, text: async () => body };
    } finally {
      active -= 1;
    }
  };
  const win = {
    profileUrl: `${BASE}memberlist.php?mode=viewprofile&u=`,
    location: { href: `${BASE}chat/` },
    DOMParser,
  };
  /** @type {unknown[]} */
  const reported = [];
  const make = () =>
    createAvatarResolver({ win: /** @type {any} */ (win), db, now: () => clock.t, fetch: /** @type {any} */ (fetch), report: (err) => reported.push(err) });
  return {
    db,
    fetched,
    reported,
    clock,
    make,
    peak: () => peak,
    gate: () => (gated = true),
    release: () => {
      gated = false;
      for (const g of gates.splice(0)) g();
    },
  };
}

test('one fetch answers any number of resolves for a name, same-origin, by forum id', async () => {
  const t = await setup();
  const resolver = t.make();
  const answers = await Promise.all([1, 2, 3, 4, 5].map(() => resolver.resolve('Bob', '42')));
  assert.deepEqual(new Set(answers), new Set([`${BASE}download/file.php?avatar=42.jpg`]));
  assert.equal(t.fetched.length, 1);
  assert.equal(t.fetched[0].url, `${BASE}memberlist.php?mode=viewprofile&u=42`);
  assert.equal(t.fetched[0].init.credentials, 'same-origin');
  t.db.close();
});

test('a sender with no known forum id is looked up by name', async () => {
  const t = await setup();
  assert.equal(await t.make().resolve('Dick Vicious'), `${BASE}download/file.php?avatar=byname.jpg`);
  assert.equal(t.fetched[0].url, `${BASE}memberlist.php?mode=viewprofile&un=Dick+Vicious`);
  t.db.close();
});

/** Poll until `cond()` holds, so a background refresh can be awaited without a fixed delay. */
async function until(cond, what = 'condition') {
  for (let i = 0; i < 200; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The stored record for `name`, read straight from the database. */
const record = (db, name) =>
  new Promise((resolve, reject) => {
    const req = db.transaction('avatars').objectStore('avatars').get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

test('a stored answer is used across page loads for a day, then answered at once and refreshed', async () => {
  const t = await setup();
  await t.make().resolve('Bob', '42');
  t.clock.t += AVATAR_TTL_MS - 1;
  assert.equal(await t.make().resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  assert.equal(t.fetched.length, 1);
  t.clock.t += 1;
  t.gate();
  const answer = await t.make().resolve('Bob', '42');
  assert.equal(answer, `${BASE}download/file.php?avatar=42.jpg`, 'answered without waiting on the refresh');
  await until(() => t.fetched.length === 2, 'the refresh');
  t.release();
  await new Promise((r) => setTimeout(r, 20));
  t.db.close();
});

test('a failed refresh keeps the stored picture and its age across page loads', async () => {
  let failing = false;
  const t = await setup({ answer: () => (failing ? '<html><body>Login</body></html>' : withPicture('42')) });
  await t.make().resolve('Bob', '42');
  const before = await record(t.db, 'Bob');
  failing = true;
  t.clock.t += AVATAR_TTL_MS;
  for (const load of [1, 2]) {
    const resolver = t.make();
    assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
    await until(() => t.fetched.length === 1 + load, `the refresh on load ${load}`);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(resolver.peek('Bob'), `${BASE}download/file.php?avatar=42.jpg`, 'peek keeps the picture');
    assert.deepEqual(await record(t.db, 'Bob'), before, 'nothing written over the stored picture');
  }
  assert.deepEqual(t.reported, [], 'an expected failure is not reported');
  t.db.close();
});

test('a refresh that finds a new picture replaces the stored one and updates peek', async () => {
  let who = 'old';
  const t = await setup({ answer: () => withPicture(who) });
  await t.make().resolve('Bob', '42');
  who = 'new';
  t.clock.t += AVATAR_TTL_MS;
  const resolver = t.make();
  assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=old.jpg`);
  await until(() => resolver.peek('Bob') === `${BASE}download/file.php?avatar=new.jpg`, 'peek to update');
  assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=new.jpg`, 'later rows get it');
  await new Promise((r) => setTimeout(r, 20));
  const stored = await record(t.db, 'Bob');
  assert.equal(stored.url, `${BASE}download/file.php?avatar=new.jpg`);
  assert.equal(stored.at, t.clock.t);
  assert.equal(await t.make().resolve('Bob', '42'), `${BASE}download/file.php?avatar=new.jpg`);
  assert.equal(t.fetched.length, 2, 'the new picture is fresh, so not fetched again');
  t.db.close();
});

test('a refresh that finds no picture clears the stored one', async () => {
  let picture = true;
  const t = await setup({ answer: () => (picture ? withPicture('42') : page('<dt>Bob</dt>')) });
  await t.make().resolve('Bob', '42');
  picture = false;
  t.clock.t += AVATAR_TTL_MS;
  const resolver = t.make();
  assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  await until(() => resolver.peek('Bob') === null, 'peek to clear');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await record(t.db, 'Bob')).url, null);
  assert.equal(await t.make().resolve('Bob', '42'), null);
  assert.equal(t.fetched.length, 2);
  t.db.close();
});

test("a stale 'no picture' is refreshed before answering, and a failed refresh leaves it stored", async () => {
  let answer = () => page('<dt>Bob</dt>');
  const t = await setup({ answer: (url) => answer(url) });
  assert.equal(await t.make().resolve('Bob', '42'), null);
  const before = await record(t.db, 'Bob');
  t.clock.t += AVATAR_TTL_MS;
  answer = () => 500;
  assert.equal(await t.make().resolve('Bob', '42'), null);
  assert.equal(t.fetched.length, 2, 'fetched before answering');
  assert.deepEqual(await record(t.db, 'Bob'), before, 'the failure wrote nothing');
  answer = () => withPicture('42');
  assert.equal(await t.make().resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`, 'the answer waits on the fetch');
  assert.equal(t.fetched.length, 3);
  t.db.close();
});

test(`refreshes share the ${MAX_CONCURRENT}-fetch limit, one per name per page load`, async () => {
  const t = await setup();
  const names = ['a', 'b', 'c', 'd', 'e'];
  const first = t.make();
  await Promise.all(names.map((name, i) => first.resolve(name, String(i + 1))));
  t.clock.t += AVATAR_TTL_MS;
  t.gate();
  const resolver = t.make();
  for (const _ of [1, 2]) await Promise.all(names.map((name, i) => resolver.resolve(name, String(i + 1))));
  await until(() => t.fetched.length === names.length + MAX_CONCURRENT, 'the first refreshes');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.fetched.length, names.length + MAX_CONCURRENT, 'the rest wait for a slot');
  t.release();
  await until(() => t.fetched.length === names.length * 2, 'every refresh');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.fetched.length, names.length * 2, 'one refresh per name');
  assert.equal(t.peak(), MAX_CONCURRENT);
  t.db.close();
});

test('no picture is stored too, so the profile is not fetched again that day', async () => {
  const t = await setup({ answer: () => page('<dt>Bob</dt>') });
  assert.equal(await t.make().resolve('Bob', '42'), null);
  assert.equal(await t.make().resolve('Bob', '42'), null);
  assert.equal(t.fetched.length, 1);
  t.db.close();
});

test('a failed lookup answers null for this page load and is never stored', async () => {
  for (const answer of [() => 500, () => '<html><body>Information</body></html>', () => { throw new Error('offline'); }]) {
    const t = await setup({ answer });
    const resolver = t.make();
    assert.equal(await resolver.resolve('Bob', '42'), null);
    assert.equal(await resolver.resolve('Bob', '42'), null);
    assert.equal(t.fetched.length, 1, 'not retried within the page load');
    await t.make().resolve('Bob', '42');
    assert.equal(t.fetched.length, 2, 'retried on the next page load');
    assert.deepEqual(t.reported, [], 'an expected failure is not reported');
    t.db.close();
  }
});

test(`at most ${MAX_CONCURRENT} profiles are fetched at once`, async () => {
  const t = await setup();
  t.gate();
  const resolver = t.make();
  const all = Promise.all(['a', 'b', 'c', 'd', 'e'].map((name, i) => resolver.resolve(name, String(i + 1))));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.fetched.length, MAX_CONCURRENT);
  t.release();
  const answers = await all;
  assert.equal(t.fetched.length, 5);
  assert.equal(t.peak(), MAX_CONCURRENT);
  assert.ok(answers.every((a) => typeof a === 'string'));
  t.db.close();
});

test('with no profileUrl a stale stored answer is answered as stored, and nothing is fetched', async () => {
  const t = await setup({ answer: (url) => (new URL(url).searchParams.get('u') === '1' ? withPicture('1') : page('<dt>Ann</dt>')) });
  const first = t.make();
  await first.resolve('Bob', '1');
  await first.resolve('Ann', '2');
  t.clock.t += AVATAR_TTL_MS;
  const resolver = createAvatarResolver({
    win: /** @type {any} */ ({ location: { href: BASE }, DOMParser: happy.DOMParser }),
    db: t.db,
    now: () => t.clock.t,
    fetch: /** @type {any} */ (() => assert.fail('fetched')),
    report: (err) => t.reported.push(err),
  });
  assert.equal(await resolver.resolve('Bob', '1'), `${BASE}download/file.php?avatar=1.jpg`);
  assert.equal(await resolver.resolve('Ann', '2'), null);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(t.reported, []);
  t.db.close();
});

test('a fault in a background refresh is reported, and the stored picture is kept', async () => {
  let broken = false;
  const t = await setup({
    DOMParser: class {
      parseFromString(html, type) {
        if (broken) throw new TypeError('parser broke');
        return new happy.DOMParser().parseFromString(html, type);
      }
    },
  });
  await t.make().resolve('Bob', '42');
  broken = true;
  t.clock.t += AVATAR_TTL_MS;
  const resolver = t.make();
  assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  await until(() => t.reported.length === 1, 'the fault to be reported');
  assert.ok(t.reported[0] instanceof TypeError);
  assert.equal(resolver.peek('Bob'), `${BASE}download/file.php?avatar=42.jpg`);
  assert.equal((await record(t.db, 'Bob')).url, `${BASE}download/file.php?avatar=42.jpg`);
  t.db.close();
});

test('with no profileUrl there is nothing to fetch', async () => {
  const t = await setup();
  const resolver = createAvatarResolver({
    win: /** @type {any} */ ({ location: { href: BASE }, DOMParser: happy.DOMParser }),
    db: t.db,
    fetch: /** @type {any} */ (() => assert.fail('fetched')),
  });
  assert.equal(await resolver.resolve('Bob', '42'), null);
  t.db.close();
});

test('peek gives nothing until an answer settles, then the answer, picture or none', async () => {
  const t = await setup({ answer: (url) => (new URL(url).searchParams.get('u') === '1' ? withPicture('1') : 500) });
  const resolver = t.make();
  const pending = resolver.resolve('Bob', '1');
  assert.equal(resolver.peek('Bob'), undefined);
  await pending;
  assert.equal(resolver.peek('Bob'), `${BASE}download/file.php?avatar=1.jpg`);
  await resolver.resolve('Ann', '2');
  assert.equal(resolver.peek('Ann'), null);
  assert.equal(resolver.peek('Cy'), undefined);
  t.db.close();
});

test('a fault in the lookup is reported, not taken for a failed lookup', async () => {
  const t = await setup({
    DOMParser: class {
      parseFromString() {
        throw new TypeError('parser broke');
      }
    },
  });
  assert.equal(await t.make().resolve('Bob', '42'), null, 'the tile still shows');
  assert.equal(t.reported.length, 1);
  assert.ok(t.reported[0] instanceof TypeError);
  assert.ok(!(t.reported[0] instanceof AvatarLookupFailed));
  t.db.close();
});

test('a database fault other than closing is reported, and the profile is still fetched', async () => {
  const t = await setup();
  const fault = new Error('misuse');
  const db = /** @type {any} */ ({ transaction: () => { throw fault; } });
  const resolver = createAvatarResolver({
    win: /** @type {any} */ ({ profileUrl: `${BASE}memberlist.php?mode=viewprofile&u=`, location: { href: BASE }, DOMParser: happy.DOMParser }),
    db,
    fetch: /** @type {any} */ (async (url) => ({ ok: true, status: 200, url, text: async () => withPicture('42') })),
    report: (err) => t.reported.push(err),
  });
  assert.equal(await resolver.resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  assert.deepEqual(t.reported, [fault, fault], 'both the read and the write are reported');
  t.db.close();
});

test('a closing database is expected and not reported', async () => {
  const t = await setup();
  t.db.close();
  assert.equal(await t.make().resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  assert.deepEqual(t.reported, []);
});
