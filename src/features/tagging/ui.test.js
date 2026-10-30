import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { onLiked } from '../../core/events.js';
import { createReactionQueue } from './queue.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { installReactionUi } from './ui.js';

const A = '100000000111111';
const settle = () => new Promise((r) => setTimeout(r, 20));
/** @type {import('./infer.js').LikeCount} */
const NONE = { count: 0, mine: false };

/**
 * @param {{ kind?: string, href?: string | null, id?: string, user?: string }} [opts]
 */
const row = ({ kind = 'public', href = `plugins/share/view.php?id=${A}`, id = '1', user = 'alice' } = {}) =>
  `<div class="tdf-msg tdf-kind-${kind}" data-id="${id}" data-user="${user}"><span class="tdf-line"><span class="tdf-body">` +
  (href === null
    ? '<a href="https://example.com/cat.png"><img class="tdf-posted" src="https://example.com/cat.png"></a>'
    : `<a href="${href}"><img class="tdf-posted" src="${href}"></a>`) +
  '</span></span></div>';

/**
 * A rendered text message, its body given as HTML.
 * @param {string} body
 * @param {{ kind?: string, id?: string }} [opts]
 */
const textRow = (body, { kind = 'public', id = '5' } = {}) =>
  `<div class="tdf-msg tdf-kind-${kind}" data-id="${id}"><span class="tdf-line"><span class="tdf-body">${body}</span></span></div>`;

/** @param {{ likes?: import('./infer.js').LikeCount, accept?: boolean, request?: import('./queue.js').SendRequest | null, codes?: string[], user?: string, me?: string }} [opts] */
function page({ likes = NONE, accept = true, request = null, codes = [...CODES], user = 'alice', me = 'me' } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://chat.example.com/forum/chat/index.php' }));
  const doc = win.document;
  win.mySmiliesImg = CODES.map((c, i) => `<img src='smilies/${i}.gif' alt='${c}'>`);
  win.userName = me;
  doc.body.innerHTML = `<div id="tdf-chat"><div class="tdf-list">${row({ user })}</div></div>`;
  /** @type {unknown[]} */
  const opened = [];
  win.open = (/** @type {unknown[]} */ ...args) => opened.push(args);

  /** @type {Set<() => void>} */
  const storeListeners = new Set();
  /** @type {Set<(imageId: string, sender: string) => void>} */
  const likeListeners = new Set();
  const store = {
    likes,
    likesFor: (/** @type {string} */ id) => (id === A ? store.likes : NONE),
    onChange: (/** @type {() => void} */ fn) => (storeListeners.add(fn), () => storeListeners.delete(fn)),
    onLike: (/** @type {(imageId: string, sender: string) => void} */ fn) => (likeListeners.add(fn), () => likeListeners.delete(fn)),
    set(/** @type {import('./infer.js').LikeCount} */ next) {
      store.likes = next;
      for (const fn of storeListeners) fn();
    },
    /** @param {string} imageId @param {string} sender */
    like(imageId, sender) {
      for (const fn of likeListeners) fn(imageId, sender);
    },
  };
  /** @type {(() => void)[]} */
  const timers = [];
  /** @type {string[]} */
  const sent = [];
  let clock = 0;
  const queue = createReactionQueue({
    now: () => clock,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    send: (text) => (sent.push(text), accept),
    request: () => request,
    intervalSeconds: () => 15,
    resetRepeat: () => {},
  });
  /** @type {Element[]} */
  const bursts = [];
  const uninstall = installReactionUi({
    doc,
    win,
    store,
    queue,
    codes,
    burst: (_doc, _win, anchor) => bursts.push(anchor),
  });
  /** @param {Element} el @param {string} [type] */
  const mouse = (el, type = 'click', x = 50, y = 60) => {
    const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    el.dispatchEvent(event);
    return event;
  };
  const click = (/** @type {Element} */ el, x = 50, y = 60) => mouse(el, 'click', x, y);
  const rightClick = (/** @type {Element} */ el) => mouse(el, 'contextmenu');
  const posted = () => doc.querySelector('img.tdf-posted');
  /** @returns {HTMLElement | null} */
  const frame = () => doc.querySelector('.tdf-rx-frame');
  /** @returns {HTMLElement | null} */
  const like = () => doc.querySelector('.tdf-rx-frame > .tdf-rx-like');
  /** @returns {HTMLElement | null} */
  const stack = () => doc.querySelector('.tdf-rx-frame > .tdf-rx-stack');
  const stackSize = () => stack()?.querySelectorAll('svg').length ?? -1;
  /** Each like button's state classes, unprefixed. */
  const state = () =>
    [...doc.querySelectorAll('.tdf-rx-like')].map((b) =>
      [...b.classList].filter((k) => k !== 'tdf-rx-like').map((k) => k.slice(7)).join(' '),
    );
  /** Run due timers, a minute apart, at most ten. */
  const run = () => {
    for (let i = 0; i < 10 && timers.length; i += 1) {
      clock += 60_000;
      timers.shift()?.();
    }
  };
  return { win, doc, store, queue, opened, sent, timers, bursts, run, click, rightClick, posted, frame, like, stack, stackSize, state, uninstall };
}

test('a posted image with a share id sits in a frame holding a like button and a stack, beside its link', () => {
  const p = page();
  const frame = p.frame();
  assert.equal(frame?.dataset.share, A);
  assert.equal(frame?.parentElement?.className, 'tdf-body');
  const link = frame?.querySelector(':scope > a');
  assert.equal(link?.querySelector('img'), p.posted());
  assert.deepEqual([...(frame?.children ?? [])].map((c) => c.className), ['', 'tdf-rx-like', 'tdf-rx-stack']);
  assert.equal(link?.querySelector('button'), null, 'no icon inside the link');
  assert.equal(p.stack()?.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(p.state(), ['']);
  assert.equal(p.like()?.title, 'Like');
  assert.equal(p.doc.querySelectorAll('.tdf-rx-row, .tdf-rx-heart').length, 0, 'no heart row');
});

test('a re-render updates the frame in place rather than wrapping it again', () => {
  const p = page();
  const frame = p.frame();
  const like = p.like();
  p.store.set({ count: 1, mine: false });
  p.store.set({ count: 2, mine: true });
  assert.equal(p.doc.querySelectorAll('.tdf-rx-frame').length, 1);
  assert.equal(p.frame(), frame);
  assert.equal(p.like(), like);
  assert.deepEqual(p.state(), ['mine']);
  assert.equal(p.stackSize(), 2);
});

test('clicking the corner heart likes the image: filled, one in the stack, hearts float from the image', () => {
  const p = page();
  const event = p.click(p.like());
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(p.opened, [], 'nothing opened');
  assert.deepEqual(p.state(), ['mine queued']);
  assert.equal(p.like()?.getAttribute('aria-pressed'), 'true');
  assert.equal(p.stackSize(), 1);
  assert.deepEqual(p.bursts, [p.posted()]);
  p.timers.shift()?.();
  assert.deepEqual(p.sent, [':h ^111111']);
});

test('clicking the heart on an image already liked, or one queued, sends nothing and floats nothing', () => {
  const liked = page({ likes: { count: 1, mine: true } });
  assert.deepEqual(liked.state(), ['mine']);
  assert.equal(liked.like()?.title, 'Liked');
  assert.equal(liked.click(liked.like()).defaultPrevented, true);
  liked.run();
  assert.deepEqual(liked.sent, []);
  assert.deepEqual(liked.bursts, []);

  const queued = page();
  queued.click(queued.like());
  queued.click(queued.like());
  assert.equal(queued.bursts.length, 1);
  queued.timers.shift()?.();
  assert.equal(queued.sent.length, 1);
});

/**
 * The likes announced on core's liked channel while `fn` runs.
 * @param {() => void} fn
 */
const announced = (fn) => {
  /** @type {import('../../core/events.js').Liked[]} */
  const out = [];
  const off = onLiked((l) => out.push(l));
  try {
    fn();
  } finally {
    off();
  }
  return out;
};

test('clicking the heart announces the like with the image and its row\'s message id, once', () => {
  const p = page();
  assert.deepEqual(
    announced(() => {
      p.click(p.like());
      p.click(p.like());
    }),
    [{ shareId: A, messageId: '1', user: 'alice', mTime: '' }],
  );
  const liked = page({ likes: { count: 1, mine: true } });
  assert.deepEqual(
    announced(() => liked.click(liked.like())),
    [],
  );
});

test('a failed like\'s retry announces the like again', () => {
  const p = page({ accept: false });
  p.click(p.like());
  p.timers.shift()?.();
  assert.deepEqual(announced(() => p.click(p.like())), [{ shareId: A, messageId: '1', user: 'alice', mTime: '' }]);
});

test('the announced like carries its row\'s sender and mTime, for a message history does not hold', () => {
  const p = page({ user: 'bob' });
  /** @type {HTMLElement} */ (p.frame()?.closest('.tdf-msg')).dataset.mtime = '345';
  assert.deepEqual(announced(() => p.click(p.like())), [{ shareId: A, messageId: '1', user: 'bob', mTime: '345' }]);
});

test('a like on a row with no server id is queued but not announced', () => {
  for (const id of ['local-7', '']) {
    const p = page();
    const msg = /** @type {HTMLElement} */ (p.frame()?.closest('.tdf-msg'));
    if (id === '') delete msg.dataset.id;
    else msg.dataset.id = id;
    assert.deepEqual(announced(() => p.click(p.like())), []);
    assert.deepEqual(p.state(), ['mine queued']);
  }
});

test('a queued like is titled with its queue position; a sending one says so', () => {
  const p = page();
  p.click(p.like());
  assert.equal(p.like()?.title, 'Your like: queued (#1)');
  // A request that never answers keeps the entry sending.
  const s = page({ request: { readyState: 4, status: 0, addEventListener: () => {} } });
  s.click(s.like());
  s.timers.shift()?.();
  assert.deepEqual(s.state(), ['mine queued']);
  assert.equal(s.like()?.title, 'Your like: sending');
});

test('a failed like is marked with its reason, and clicking its heart retries it', () => {
  const p = page({ accept: false });
  p.click(p.like());
  p.timers.shift()?.();
  assert.deepEqual(p.state(), ['mine failed']);
  assert.match(p.like()?.title ?? '', /^Not sent \(refused by the chat\)\. Click to retry$/);
  p.click(p.like());
  assert.deepEqual(p.state(), ['mine queued']);
  assert.equal(p.bursts.length, 2);
});

test('the stack shows one heart per liker, yours included, and at most three', () => {
  const p = page();
  assert.equal(p.stackSize(), 0);
  p.store.set({ count: 2, mine: false });
  assert.equal(p.stackSize(), 2);
  p.click(p.like());
  assert.equal(p.stackSize(), 3, 'a queued like of yours counts');
  p.store.set({ count: 4, mine: true });
  assert.equal(p.stackSize(), 3, 'a fourth liker adds no heart');
  p.store.set(NONE);
  assert.equal(p.stackSize(), 1, 'your queued like still counts');
});

// Liker names are not kept at all: countLikes returns only the count and whether you liked (infer.test.js).
test('no like count appears on or under the image', () => {
  const p = page({ likes: { count: 2, mine: false } });
  const msg = p.doc.querySelector('.tdf-msg');
  assert.equal((msg?.textContent ?? '').trim(), '');
  assert.doesNotMatch(msg?.innerHTML ?? '', />2</);
});

test('your own image shows no corner heart; others\' likes on it still stack and float', () => {
  const p = page({ user: 'me', likes: { count: 1, mine: false } });
  assert.equal(p.like(), null);
  assert.equal(p.stackSize(), 1);
  p.store.like(A, 'bob');
  assert.deepEqual(p.bursts, [p.posted()]);
});

test('with no user name known, no image counts as yours: an unnamed row still gets its heart', () => {
  const p = page({ user: '', me: '' });
  assert.ok(p.like());
});

test('clicking a posted image opens it full size in a new tab and sends nothing', () => {
  const p = page();
  const event = p.click(p.posted());
  assert.equal(event.defaultPrevented, true, 'the link is not followed in this tab');
  assert.deepEqual(p.opened, [[`https://chat.example.com/forum/chat/plugins/share/view.php?id=${A}`, '_blank', 'noopener']]);
  p.run();
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.bursts, []);
  assert.deepEqual(p.state(), ['']);
});

test('a share-id image with no link is framed itself: its heart likes, and clicking it opens its src', () => {
  const p = page();
  const src = `https://chat.example.com/forum/chat/plugins/share/view.php?id=${A}`;
  p.doc.querySelector('.tdf-list').innerHTML = row().replace(/<a [^>]*>|<\/a>/g, '');
  p.store.set(NONE);
  const frame = p.frame();
  assert.equal(frame?.dataset.share, A);
  assert.equal(frame?.firstElementChild, p.posted(), 'the frame wraps the image directly');
  assert.equal(frame?.querySelector('a'), null);
  assert.deepEqual([...(frame?.children ?? [])].map((c) => c.className), ['tdf-posted', 'tdf-rx-like', 'tdf-rx-stack']);
  p.click(p.like());
  assert.deepEqual(p.state(), ['mine queued']);
  assert.deepEqual(p.bursts, [p.posted()]);
  assert.deepEqual(p.opened, [], 'the heart opens nothing');
  const event = p.click(p.posted());
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(p.opened, [[src, '_blank', 'noopener']]);
});

test('right-clicking a posted image keeps the browser menu and likes nothing', () => {
  const p = page();
  assert.equal(p.rightClick(p.posted()).defaultPrevented, false);
  p.run();
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.bursts, []);
  assert.deepEqual(p.state(), ['']);
});

test('an image without a share id, or in a whisper, gets no frame and keeps its plain link', () => {
  const p = page();
  p.doc.querySelector('.tdf-list').innerHTML = row({ href: null }) + row({ kind: 'whisper', id: '2' });
  p.store.set(NONE);
  assert.equal(p.doc.querySelectorAll('.tdf-rx-frame').length, 0);
  for (const img of p.doc.querySelectorAll('img.tdf-posted')) assert.equal(p.click(img).defaultPrevented, false);
  // happy-dom follows a plain link through window.open(href, '_self'); only a new tab is ours.
  assert.deepEqual(p.opened.filter((/** @type {unknown[]} */ o) => o[1] === '_blank'), []);
});

test('a message the view adds later gets its frame; a store change refreshes it', async () => {
  const p = page({ likes: { count: 1, mine: false } });
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML('beforeend', row({ id: '9' }));
  await settle();
  assert.equal(p.stackSize(), 1);
  p.store.set({ count: 2, mine: false });
  assert.equal(p.stackSize(), 2);
});

test('another user\'s live like floats hearts from that image; another image\'s does not', () => {
  const p = page({ likes: { count: 1, mine: false } });
  p.store.like(A, 'bob');
  assert.deepEqual(p.bursts, [p.posted()]);
  p.store.like('100000000999999', 'bob');
  assert.equal(p.bursts.length, 1);
});

test('the stylesheet shows the heart on hover, the heart you gave always, and the heart on a device without hover', () => {
  const css = readFileSync(new URL('./tagging.css', import.meta.url), 'utf8');
  const flat = css.replace(/\s+/g, ' ');
  /** @param {string} rule @param {string} [why] */
  const has = (rule, why) => assert.ok(flat.includes(rule), why ?? rule);
  has('#tdf-chat .tdf-rx-like { position: absolute; top: 4px; right: 4px; display: none;');
  assert.match(flat, /#tdf-chat \.tdf-rx-like \{[^}]*cursor: pointer;/);
  has(
    '.tdf-rx-frame:has(img.tdf-posted):hover > .tdf-rx-like, #tdf-chat .tdf-rx-frame:has(img.tdf-posted):focus-within > .tdf-rx-like, #tdf-chat .tdf-rx-frame:has(img.tdf-posted) > .tdf-rx-like.tdf-rx-mine { display: block;',
    'keyboard focus in the frame shows the heart, so tabbing reaches it',
  );
  has('.tdf-rx-frame:hover img.tdf-posted { opacity: var(--tdf-posted-hover-opacity); }', 'the frame fade reuses theme.css\'s value');
  const theme = readFileSync(new URL('../../core/theme.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(theme, /#tdf-chat \{[^}]*--tdf-posted-hover-opacity: [\d.]+;/, 'theme.css defines the fade');
  assert.ok(theme.includes('img.tdf-posted:hover { opacity: var(--tdf-posted-hover-opacity); }'), 'theme.css uses it');
  assert.doesNotMatch(flat, /opacity: 0\.8/, 'no copied fade value');
  has('@media (hover: none) { #tdf-chat .tdf-rx-frame:has(img.tdf-posted) > .tdf-rx-like { display: block;');
  has(
    '.tdf-rx-like.tdf-rx-mine:not(.tdf-rx-failed) svg, #tdf-chat .tdf-rx-like:not(.tdf-rx-queued):hover svg { fill: #e0245e; stroke: none; }',
    'a filled heart has no outline, and pointing at an unfilled one fills it',
  );
  assert.match(flat, /\.tdf-rx-stack svg \{[^}]*fill: #e0245e; stroke: none; \}/, 'nor do the stack hearts');
  has('.tdf-rx-like.tdf-rx-failed svg { fill: none; stroke: #ffffff;', 'a failed one keeps its dashed outline');
  assert.doesNotMatch(css, /cursor: default/, 'the image keeps its pointer');
  assert.doesNotMatch(css, /tdf-rx-row|tdf-rx-heart|tdf-rx-open/);
});

test('a like message shows no ^suffix token, in whichever form it arrived', async () => {
  const smiley = "<img src='smilies/9.gif' alt=':h'>";
  const p = page();
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  const forms = [
    `${smiley} ^111111`,
    `${smiley} <span style="color: #ffffff">^111111</span>`,
    `<b>${smiley} <span style="color: #ffffff">^111111</span> </b>`,
    `${smiley} ^111111`.replace(smiley, ':h'),
    `-${smiley} ^111111`,
    '-:h ^111111',
  ];
  forms.forEach((body, i) => list.insertAdjacentHTML('beforeend', textRow(body, { id: String(10 + i) })));
  await settle();
  for (const body of list.querySelectorAll('.tdf-body')) {
    assert.doesNotMatch(body.textContent ?? '', /\^/, body.innerHTML);
    assert.equal(body.querySelector('span'), null, 'an emptied wrapper goes with it');
  }
  assert.equal(list.querySelectorAll('.tdf-body img').length, 4, 'the smileys stay');
  assert.deepEqual(
    [...list.querySelectorAll('.tdf-body')].slice(3).map((b) => (b.textContent ?? '').trim()),
    [':h', '-', '-:h'],
  );
});

test('a token in anything other than a like stays', async () => {
  const p = page();
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML(
    'beforeend',
    textRow('see ^111111', { id: '20' }) +
      textRow("<img src='smilies/9.gif' alt=':h'> ^111111", { kind: 'whisper', id: '21' }) +
      textRow('<a href="https://x.test">x</a> ^111111', { id: '22' }) +
      textRow('^111111', { id: '23' }) +
      textRow("<img src='smilies/9.gif' alt=':h'><img src='smilies/9.gif' alt=':h'> ^111111", { id: '24' }) +
      textRow(':h :h ^111111', { id: '25' }),
  );
  await settle();
  assert.deepEqual(
    [...list.querySelectorAll('.tdf-body')].map((b) => (b.textContent ?? '').trim()),
    ['see ^111111', '^111111', 'x ^111111', '^111111', '^111111', ':h :h ^111111'],
  );
});

test('a token with a smiley after it stays', async () => {
  const p = page();
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML('beforeend', textRow("^111111 <img src='smilies/9.gif' alt=':h'>", { id: '26' }));
  await settle();
  assert.equal((list.querySelector('.tdf-body')?.textContent ?? '').trim(), '^111111');
});

test('the token is stripped only after a code given to the install, not one in mySmilies alone', async () => {
  const p = page({ codes: [':h'] });
  p.win.mySmilies = [':h', ':d'];
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML('beforeend', textRow(':h ^111111', { id: '27' }) + textRow(':d ^111111', { id: '28' }));
  await settle();
  assert.deepEqual(
    [...list.querySelectorAll('.tdf-body')].map((b) => (b.textContent ?? '').trim()),
    [':h', ':d ^111111'],
  );
});

test('uninstall detaches the click handler and the like listener', () => {
  const p = page();
  p.uninstall();
  assert.equal(p.click(p.like()).defaultPrevented, false);
  assert.equal(p.click(p.posted()).defaultPrevented, false);
  p.store.like(A, 'bob');
  assert.deepEqual(p.bursts, []);
});
