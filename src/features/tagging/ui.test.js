import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { createReactionQueue } from './queue.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { installReactionUi } from './ui.js';

const A = '100000000111111';
const settle = () => new Promise((r) => setTimeout(r, 20));
/** @type {import('./infer.js').LikeCount} */
const NONE = { count: 0, mine: false, senders: [] };

/**
 * @param {{ kind?: string, href?: string | null, id?: string }} [opts]
 */
const row = ({ kind = 'public', href = `plugins/share/view.php?id=${A}`, id = '1' } = {}) =>
  `<div class="tdf-msg tdf-kind-${kind}" data-id="${id}"><span class="tdf-line"><span class="tdf-body">` +
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

/** @param {{ likes?: import('./infer.js').LikeCount, accept?: boolean, request?: import('./queue.js').SendRequest | null }} [opts] */
function page({ likes = NONE, accept = true, request = null } = {}) {
  const win = /** @type {any} */ (new Window({ url: 'https://dollforum.com/forum/chat/index.php' }));
  const doc = win.document;
  win.mySmilies = [...CODES];
  win.mySmiliesImg = CODES.map((c, i) => `<img src='smilies/${i}.gif' alt='${c}'>`);
  doc.body.innerHTML = `<div id="tdf-chat"><div class="tdf-list">${row()}</div></div>`;
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
  /** @type {any[]} */
  const pickers = [];
  /** @type {Element[]} */
  const bursts = [];
  const uninstall = installReactionUi({
    doc,
    win,
    store,
    queue,
    openSmileyPicker: (options) => {
      pickers.push(options);
      return () => {};
    },
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
  const hearts = () =>
    [...doc.querySelectorAll('.tdf-rx-heart')].map(
      (h) => `${h.textContent}${[...h.classList].filter((k) => k !== 'tdf-rx-heart').map((k) => ` ${k.slice(7)}`).join('')}`,
    );
  /** Run due timers, a minute apart, at most ten. */
  const run = () => {
    for (let i = 0; i < 10 && timers.length; i += 1) {
      clock += 60_000;
      timers.shift()?.();
    }
  };
  return { win, doc, store, queue, pickers, opened, sent, timers, bursts, run, click, rightClick, posted, hearts, uninstall };
}

test('right-clicking a posted image likes it at once: no context menu, an outlined heart of 1, hearts float', () => {
  const p = page();
  const event = p.rightClick(p.posted());
  assert.equal(event.defaultPrevented, true);
  assert.equal(p.pickers.length, 0, 'no picker');
  assert.deepEqual(p.hearts(), ['♥1 mine queued']);
  const heart = p.doc.querySelector('.tdf-rx-heart');
  assert.equal(heart.closest('.tdf-msg')?.getAttribute('data-id'), '1', 'the heart sits under the image, inside its message');
  assert.deepEqual(p.bursts, [heart]);
  p.timers.shift()?.();
  assert.deepEqual(p.sent, [':h ^111111']);
});

test('right-clicking an image you already liked, or one queued, sends nothing and floats nothing', () => {
  const liked = page({ likes: { count: 1, mine: true, senders: [{ sender: 'me', codes: [':L'] }] } });
  liked.rightClick(liked.posted());
  assert.deepEqual(liked.bursts, []);
  liked.run();
  assert.deepEqual(liked.sent, []);

  const queued = page();
  queued.rightClick(queued.posted());
  queued.rightClick(queued.posted());
  assert.equal(queued.bursts.length, 1);
  queued.timers.shift()?.();
  assert.equal(queued.sent.length, 1);
});

test('right-click on an image without a share id, in a whisper, or outside the overlay keeps the menu', () => {
  const p = page();
  p.doc.querySelector('.tdf-list').innerHTML = row({ href: null }) + row({ kind: 'whisper', id: '2' });
  for (const img of p.doc.querySelectorAll('img.tdf-posted')) assert.equal(p.rightClick(img).defaultPrevented, false);
  const outside = p.doc.createElement('img');
  outside.className = 'tdf-posted';
  outside.src = `plugins/share/view.php?id=${A}`;
  p.doc.body.appendChild(outside);
  assert.equal(p.rightClick(outside).defaultPrevented, false);
  assert.deepEqual(p.sent, []);
});

test('clicking a posted image opens the picker below the pointer; a pick likes it with that smiley', () => {
  const p = page();
  const event = p.click(p.posted(), 50, 60);
  assert.equal(event.defaultPrevented, true);
  assert.equal(p.pickers.length, 1);
  assert.deepEqual([p.pickers[0].x, p.pickers[0].y], [50, 68]);
  assert.deepEqual(p.pickers[0].extraRows.map((/** @type {any} */ r) => r.label), ['Open full size']);
  p.pickers[0].onPick(':L');
  assert.deepEqual(p.hearts(), ['♥1 mine queued']);
  assert.equal(p.bursts.length, 1);
  assert.match(p.doc.querySelector('.tdf-rx-heart').title, /queued \(#1\)/);
  p.timers.shift()?.();
  assert.deepEqual(p.sent, [':L ^111111']);
});

test('picking again on an image you already reacted to sends nothing: no retraction', () => {
  const p = page({ likes: { count: 2, mine: true, senders: [{ sender: 'bob', codes: [':h'] }, { sender: 'me', codes: [':h'] }] } });
  p.click(p.posted());
  p.pickers[0].onPick(':h');
  p.click(p.posted());
  p.pickers[1].onPick(':L');
  p.click(p.doc.querySelector('.tdf-rx-heart'));
  p.run();
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.bursts, []);
  assert.deepEqual(p.hearts(), ['♥2 mine']);
});

test('one heart counts the image\'s likes, its title naming each sender\'s smileys; no chips', () => {
  const p = page({
    likes: {
      count: 2,
      mine: false,
      senders: [
        { sender: 'bob%20b', codes: [':h', ':L'] },
        { sender: 'carol', codes: [':d'] },
      ],
    },
  });
  assert.deepEqual(p.hearts(), ['♥2']);
  assert.equal(p.doc.querySelector('.tdf-rx-heart').title, 'bob b :h, :L\ncarol :d');
  assert.equal(p.doc.querySelectorAll('.tdf-rx-chip').length, 0);
});

test('a heart row that grows a list scrolled to the bottom keeps it at the bottom', () => {
  for (const [scrollTop, expected] of [[100, 260], [40, 40]]) {
    const p = page();
    const list = p.doc.querySelector('.tdf-list');
    Object.defineProperty(list, 'clientHeight', { get: () => 100 });
    // Each heart row grows the list by 60px.
    Object.defineProperty(list, 'scrollHeight', { get: () => 200 + 60 * list.querySelectorAll('.tdf-rx-row').length });
    list.scrollTop = scrollTop;
    p.store.set({ count: 1, mine: false, senders: [{ sender: 'bob', codes: [':h'] }] });
    // happy-dom does not clamp scrollTop, so a pinned list reads the full scrollHeight.
    assert.equal(list.scrollTop, expected, `from scrollTop ${scrollTop}`);
  }
});

test('another user\'s live like floats hearts from that image\'s heart; another image\'s does not', () => {
  const p = page({ likes: { count: 1, mine: false, senders: [{ sender: 'bob', codes: [':h'] }] } });
  p.store.like(A, 'bob');
  assert.deepEqual(p.bursts, [p.doc.querySelector('.tdf-rx-heart')]);
  p.store.like('100000000999999', 'bob');
  assert.equal(p.bursts.length, 1);
});

test('a failed like is marked, and clicking its heart retries it', () => {
  const p = page({ accept: false });
  p.rightClick(p.posted());
  p.timers.shift()?.();
  assert.deepEqual(p.hearts(), ['♥1 mine failed']);
  assert.match(p.doc.querySelector('.tdf-rx-heart').title, /^Not sent \(refused by the chat\)\. Click to retry/);
  p.click(p.doc.querySelector('.tdf-rx-heart'));
  assert.deepEqual(p.hearts(), ['♥1 mine queued']);
  assert.equal(p.bursts.length, 2);
});

test('a failed heart names why it failed', () => {
  const p = page();
  p.rightClick(p.posted());
  // Accepted with no request to watch: a failed attempt, re-queued, then failed.
  p.run();
  assert.deepEqual(p.hearts(), ['♥1 mine failed']);
  assert.match(p.doc.querySelector('.tdf-rx-heart').title, /not sent \(the chat has no send request to watch\)/i);
});

test('a sending heart is dimmed and titled sending', () => {
  // A request that never answers keeps the entry sending.
  const p = page({ request: { readyState: 4, status: 0, addEventListener: () => {} } });
  p.rightClick(p.posted());
  p.timers.shift()?.();
  assert.deepEqual(p.hearts(), ['♥1 mine queued']);
  assert.equal(p.doc.querySelector('.tdf-rx-heart').title, 'Your like: sending');
});

test('"Open full size" opens the image in a new tab', () => {
  const p = page();
  p.click(p.posted());
  p.pickers[0].extraRows[0].run();
  assert.deepEqual(p.opened, [[`https://dollforum.com/forum/chat/plugins/share/view.php?id=${A}`, '_blank', 'noopener']]);
});

test('an image without a share id, or in a whisper, keeps its plain link', () => {
  const p = page();
  p.doc.querySelector('.tdf-list').innerHTML = row({ href: null }) + row({ kind: 'whisper', id: '2' });
  for (const img of p.doc.querySelectorAll('img.tdf-posted')) {
    assert.equal(p.click(img).defaultPrevented, false);
  }
  assert.equal(p.pickers.length, 0);
});

test('a message the view adds later gets its heart; a store change refreshes it', async () => {
  const p = page({ likes: { count: 1, mine: false, senders: [{ sender: 'bob', codes: [':o'] }] } });
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML('beforeend', row({ id: '9' }));
  await settle();
  assert.deepEqual(p.hearts(), ['♥1']);
  p.store.set({ count: 2, mine: false, senders: [{ sender: 'bob', codes: [':o'] }, { sender: 'carol', codes: [':o'] }] });
  assert.deepEqual(p.hearts(), ['♥2']);
  p.store.set(NONE);
  assert.equal(p.doc.querySelectorAll('.tdf-rx-row').length, 0);
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
  ];
  forms.forEach((body, i) => list.insertAdjacentHTML('beforeend', textRow(body, { id: String(10 + i) })));
  await settle();
  for (const body of list.querySelectorAll('.tdf-body')) {
    assert.doesNotMatch(body.textContent ?? '', /\^/, body.innerHTML);
    assert.equal(body.querySelector('span'), null, 'an emptied wrapper goes with it');
  }
  assert.equal(list.querySelectorAll('.tdf-body img').length, 4, 'the smileys stay');
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

test('uninstall detaches the click and context-menu handlers and the like listener', () => {
  const p = page();
  p.uninstall();
  assert.equal(p.click(p.posted()).defaultPrevented, false);
  assert.equal(p.rightClick(p.posted()).defaultPrevented, false);
  p.store.like(A, 'bob');
  assert.deepEqual(p.bursts, []);
});
