import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { createReactionQueue } from './queue.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';
import { installReactionUi } from './ui.js';

const A = '100000000111111';
const settle = () => new Promise((r) => setTimeout(r, 20));

/**
 * @param {{ kind?: string, href?: string | null, id?: string }} [opts]
 */
const row = ({ kind = 'public', href = `plugins/share/view.php?id=${A}`, id = '1' } = {}) =>
  `<div class="tdf-msg tdf-kind-${kind}" data-id="${id}"><span class="tdf-line"><span class="tdf-body">` +
  (href === null
    ? '<a href="https://example.com/cat.png"><img class="tdf-posted" src="https://example.com/cat.png"></a>'
    : `<a href="${href}"><img class="tdf-posted" src="${href}"></a>`) +
  '</span></span></div>';

/** @param {{ counts?: import('./infer.js').ReactionCount[], accept?: boolean, request?: import('./queue.js').SendRequest | null }} [opts] */
function page({ counts = [], accept = true, request = null } = {}) {
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
  const store = {
    counts,
    reactionsFor: (/** @type {string} */ id) => (id === A ? store.counts : []),
    onChange: (/** @type {() => void} */ fn) => (storeListeners.add(fn), () => storeListeners.delete(fn)),
    set(/** @type {import('./infer.js').ReactionCount[]} */ next) {
      store.counts = next;
      for (const fn of storeListeners) fn();
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
  const uninstall = installReactionUi({
    doc,
    win,
    store,
    queue,
    openSmileyPicker: (options) => {
      pickers.push(options);
      return () => {};
    },
  });
  const click = (/** @type {Element} */ el, x = 50, y = 60) => {
    const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    el.dispatchEvent(event);
    return event;
  };
  const chips = () =>
    [...doc.querySelectorAll('.tdf-rx-chip')].map(
      (c) => `${c.dataset.code} ${c.textContent}${[...c.classList].filter((k) => k !== 'tdf-rx-chip').map((k) => ` ${k.slice(7)}`).join('')}`,
    );
  /** Run due timers, a minute apart, at most ten. */
  const run = () => {
    for (let i = 0; i < 10 && timers.length; i += 1) {
      clock += 60_000;
      timers.shift()?.();
    }
  };
  return { win, doc, store, queue, pickers, opened, sent, timers, run, click, chips, uninstall };
}

test('clicking a posted image opens the picker below the pointer; a pick queues a dimmed, outlined chip', () => {
  const p = page();
  const img = p.doc.querySelector('img.tdf-posted');
  const event = p.click(img, 50, 60);
  assert.equal(event.defaultPrevented, true);
  assert.equal(p.pickers.length, 1);
  assert.deepEqual([p.pickers[0].x, p.pickers[0].y], [50, 68]);
  assert.deepEqual(p.pickers[0].extraRows.map((/** @type {any} */ r) => r.label), ['Open full size']);
  p.pickers[0].onPick(':h');
  assert.deepEqual(p.chips(), [':h 1 mine queued']);
  const chip = p.doc.querySelector('.tdf-rx-chip');
  assert.match(chip.title, /queued \(#1\)/);
  assert.equal(chip.querySelector('img').getAttribute('src'), 'smilies/9.gif');
  // The chip sits under the image, inside its message.
  assert.equal(chip.closest('.tdf-msg')?.getAttribute('data-id'), '1');
});

test('a chip row that grows a list scrolled to the bottom keeps it at the bottom', () => {
  for (const [scrollTop, expected] of [[100, 260], [40, 40]]) {
    const p = page();
    const list = p.doc.querySelector('.tdf-list');
    Object.defineProperty(list, 'clientHeight', { get: () => 100 });
    // Each chip row grows the list by 60px.
    Object.defineProperty(list, 'scrollHeight', { get: () => 200 + 60 * list.querySelectorAll('.tdf-rx-row').length });
    list.scrollTop = scrollTop;
    p.store.set([{ code: ':h', count: 1, mine: false, senders: ['bob'] }]);
    // happy-dom does not clamp scrollTop, so a pinned list reads the full scrollHeight.
    assert.equal(list.scrollTop, expected, `from scrollTop ${scrollTop}`);
  }
});

test('the queued reaction is sent as its token', () => {
  const p = page();
  p.click(p.doc.querySelector('img.tdf-posted'));
  p.pickers[0].onPick(':h');
  p.timers.shift()?.();
  assert.deepEqual(p.sent, [':h ^111111']);
});

test('choosing the same smiley again while queued cancels it', () => {
  const p = page();
  p.click(p.doc.querySelector('img.tdf-posted'));
  p.pickers[0].onPick(':h');
  p.click(p.doc.querySelector('.tdf-rx-chip'));
  assert.deepEqual(p.chips(), []);
});

test('store reactions show as chips: yours outlined, others not; toggling yours queues a retraction', () => {
  const p = page({
    counts: [
      { code: ':h', count: 2, mine: true, senders: ['bob', 'me'] },
      { code: ':L', count: 1, mine: false, senders: ['bob%20b'] },
    ],
  });
  assert.deepEqual(p.chips(), [':h 2 mine', ':L 1']);
  assert.equal(p.doc.querySelectorAll('.tdf-rx-chip')[1].title, ':L: bob b');
  p.click(p.doc.querySelector('.tdf-rx-chip'));
  assert.deepEqual(p.chips(), [':h 2 mine queued', ':L 1']);
  p.timers.shift()?.();
  assert.deepEqual(p.sent, ['-:h ^111111']);
});

test('a failed reaction is marked, with a retry title', () => {
  const p = page({ accept: false });
  p.click(p.doc.querySelector('img.tdf-posted'));
  p.pickers[0].onPick(':d');
  p.timers.shift()?.();
  assert.deepEqual(p.chips(), [':d 1 mine failed']);
  assert.match(p.doc.querySelector('.tdf-rx-chip').title, /retry/);
});

test('"Open full size" opens the image in a new tab', () => {
  const p = page();
  p.click(p.doc.querySelector('img.tdf-posted'));
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

test('a message the view adds later gets its chips; a store change refreshes them', async () => {
  const p = page({ counts: [{ code: ':o', count: 1, mine: false, senders: ['bob'] }] });
  const list = p.doc.querySelector('.tdf-list');
  list.innerHTML = '';
  await settle();
  list.insertAdjacentHTML('beforeend', row({ id: '9' }));
  await settle();
  assert.deepEqual(p.chips(), [':o 1']);
  p.store.set([{ code: ':o', count: 2, mine: false, senders: ['bob', 'carol'] }]);
  assert.deepEqual(p.chips(), [':o 2']);
  p.store.set([]);
  assert.equal(p.doc.querySelectorAll('.tdf-rx-row').length, 0);
});

test('uninstall detaches the click handler', () => {
  const p = page();
  p.uninstall();
  assert.equal(p.click(p.doc.querySelector('img.tdf-posted')).defaultPrevented, false);
});

test('a failed chip names why it failed', () => {
  const p = page();
  p.click(p.doc.querySelector('img.tdf-posted'));
  p.pickers[0].onPick(':h');
  // Accepted with no request to watch: a failed attempt, re-queued, then failed.
  p.run();
  assert.deepEqual(p.chips(), [':h 1 mine failed']);
  assert.match(p.doc.querySelector('.tdf-rx-chip').title, /not sent \(the chat has no send request to watch\)/);
});

test('a sending chip is dimmed and titled sending', () => {
  // A request that never answers keeps the entry sending.
  const p = page({ request: { readyState: 4, status: 0, addEventListener: () => {} } });
  p.click(p.doc.querySelector('img.tdf-posted'));
  p.pickers[0].onPick(':h');
  p.timers.shift()?.();
  assert.deepEqual(p.chips(), [':h 1 mine queued']);
  assert.equal(p.doc.querySelector('.tdf-rx-chip').title, ':h: sending');
});
