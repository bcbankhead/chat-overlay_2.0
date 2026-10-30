import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { AVATAR_TTL_MS, AvatarLookupFailed, MAX_CONCURRENT, createAvatarResolver } from '../src/core/avatarResolver.js';
import { openDb } from '../src/core/db.js';

const BASE = 'https://dollforum.com/forum/';
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

test('a stored answer is used across page loads for a day, then fetched again', async () => {
  const t = await setup();
  await t.make().resolve('Bob', '42');
  t.clock.t += AVATAR_TTL_MS - 1;
  assert.equal(await t.make().resolve('Bob', '42'), `${BASE}download/file.php?avatar=42.jpg`);
  assert.equal(t.fetched.length, 1);
  t.clock.t += 1;
  await t.make().resolve('Bob', '42');
  assert.equal(t.fetched.length, 2);
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
