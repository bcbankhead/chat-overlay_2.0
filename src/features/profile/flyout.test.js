import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { adapt, THEME_BG } from '../../core/ink.js';
import { createEngine } from './engine.js';
import { ORDER, renderProfile, startProfile } from './flyout.js';

const FONTS = ['Arial', 'Comic Sans MS', 'Courier', 'Georgia', 'Impact', 'MS Sans Serif', 'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const COLORS = Array.from({ length: 108 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);

const ownRow = `<div id="room_1"><div id="userlist_71" class="userlist"><div><span><img id='avatar_7' src='avatars/me.gif'>&nbsp;<span onclick='userPanel("me","Me%20Too","7","1","97","me.gif","1","1.1.1.7")'>Me Too</span><span id='ustatusID_7'></span></span></div></div></div>`;

/** A stand-in theme with the shell's surface. */
function stubTheme(initial = /** @type {'light' | 'dark' | null} */ ('light')) {
  let theme = initial;
  const listeners = new Set();
  return {
    currentTheme: () => theme,
    onThemeChange(/** @type {any} */ fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** @param {'light' | 'dark'} next */
    set(next) {
      theme = next;
      for (const fn of listeners) fn(next);
    },
    listeners,
  };
}

function setup({ flags = {}, row = true, select = '2', credits = true, theme = stubTheme() } = {}) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    `<div id="userContainer">${row ? ownRow : ''}</div>` +
    `<textarea id="optionsBar"></textarea>` +
    (select === null ? '' : `<select id="selectStatusID">${[0, 1, 2, 3].map((i) => `<option value="${i}">${i}</option>`).join('')}</select>`) +
    (credits ? `<span id="eCreditsID">42</span><span id="iconeCredits"></span>` : '');
  if (select !== null) /** @type {any} */ (doc.getElementById('selectStatusID')).value = select;
  /** @type {any[][]} */
  const calls = [];
  Object.assign(win, {
    uID: 7, userName: 'Me%20Too', profileOn: 1, profileRef: 2,
    myFontFamily: [...FONTS, ''], myColor: COLORS,
    textFamily: 'verdana', textColor: '#000080', textSize: '12px', mBold: 0, mItalic: 0, mUnderline: 0,
    ...flags,
  });
  for (const fn of ['sendStatus', 'viewProfile', 'changeMessBoxStyle', 'createCookie', 'addFontFamily', 'addColor']) {
    /** @type {any} */ (win)[fn] = (/** @type {any[]} */ ...args) => calls.push([fn, ...args]);
  }
  doc.getElementById('iconeCredits')?.addEventListener('click', () => calls.push(['iconeCredits']));
  const observers = { active: 0, disconnected: 0 };
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const cleanup = renderProfile(container, {
    doc: /** @type {any} */ (doc),
    engine: createEngine(/** @type {any} */ (win), /** @type {any} */ (doc)),
    currentTheme: theme.currentTheme,
    onThemeChange: theme.onThemeChange,
    shift: (color, t) => adapt(color, THEME_BG[t]),
    observe(target, fn) {
      const observer = new win.MutationObserver(fn);
      observer.observe(/** @type {any} */ (target), { childList: true, characterData: true, subtree: true });
      observers.active++;
      return () => {
        observer.disconnect();
        observers.disconnected++;
      };
    },
  });
  const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (/** @type {unknown} */ (container.querySelector(sel)));
  const $$ = (/** @type {string} */ sel) => /** @type {HTMLElement[]} */ (/** @type {unknown} */ ([...container.querySelectorAll(sel)]));
  return { win, doc, container, calls, cleanup, observers, theme, $, $$ };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('the head shows your avatar and decoded name, and opens your own profile', () => {
  const { $, calls } = setup();
  assert.equal($('.tdf-profile-avatar img').getAttribute('src'), 'avatars/me.gif');
  assert.equal($('.tdf-profile-name').textContent, 'Me Too');
  const head = $('.tdf-profile-head');
  assert.equal(head.tagName, 'BUTTON');
  head.click();
  // profileRef 2: the forum user id, and the name as the engine passes it.
  assert.deepEqual(calls, [['viewProfile', '97', 'Me%20Too']]);
});

test('the head opens nothing when profiles are off', () => {
  const { $, calls } = setup({ flags: { profileOn: 0 } });
  const head = $('.tdf-profile-head');
  assert.equal(head.tagName, 'DIV');
  head.click();
  assert.deepEqual(calls, []);
});

test('the head is inert until your own row exists', () => {
  const { $ } = setup({ row: false });
  assert.equal($('.tdf-profile-head').tagName, 'DIV');
});

test('status starts from the engine select and a choice calls sendStatus with its index', () => {
  const { $, $$, doc, calls } = setup({ select: '2' });
  const segs = $$('.tdf-profile-seg');
  assert.deepEqual(segs.map((s) => s.textContent), ['Here', 'BRB', 'Away']);
  assert.deepEqual(segs.map((s) => s.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  $('.tdf-profile-seg[data-status="3"]').click();
  assert.deepEqual(calls, [['sendStatus', '3']]);
  assert.equal(/** @type {any} */ (doc.getElementById('selectStatusID')).value, '3');
  assert.deepEqual(segs.map((s) => s.getAttribute('aria-pressed')), ['false', 'false', 'true']);
});

test('status defaults to Here when the engine has no select value', () => {
  const { $$ } = setup({ select: null });
  assert.deepEqual($$('.tdf-profile-seg').map((s) => s.getAttribute('aria-pressed')), ['true', 'false', 'false']);
});

test('with no engine select a status choice still calls sendStatus', () => {
  const { $, $$, calls } = setup({ select: null });
  $('.tdf-profile-seg[data-status="3"]').click();
  assert.deepEqual(calls, [['sendStatus', '3']]);
  assert.equal($('.tdf-profile-error').hidden, true);
  assert.deepEqual($$('.tdf-profile-seg').map((s) => s.getAttribute('aria-pressed')), ['false', 'false', 'true']);
});

test('a render that throws attaches no eCredits observer or theme listener', () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = `<span id="eCreditsID">42</span>`;
  const engine = createEngine(/** @type {any} */ (win), /** @type {any} */ (doc));
  engine.colors = () => {
    throw new Error('bad colours');
  };
  const theme = stubTheme();
  let observed = 0;
  assert.throws(
    () =>
      renderProfile(doc.createElement('div'), {
        doc: /** @type {any} */ (doc),
        engine,
        currentTheme: theme.currentTheme,
        onThemeChange: theme.onThemeChange,
        shift: (color) => color,
        observe() {
          observed++;
          return () => {};
        },
      }),
    /bad colours/,
  );
  assert.equal(observed, 0);
  assert.equal(theme.listeners.size, 0);
});

test('eCredits shows the engine value, follows it, and opens the engine box', async () => {
  const { $, doc, calls, cleanup, observers } = setup();
  assert.equal($('.tdf-profile-value').textContent, '42');
  /** @type {any} */ (doc.getElementById('eCreditsID')).textContent = '41';
  await settle();
  assert.equal($('.tdf-profile-value').textContent, '41');
  $('.tdf-profile-credits').click();
  assert.deepEqual(calls, [['iconeCredits']]);
  assert.equal(observers.active, 1);
  cleanup();
  assert.equal(observers.disconnected, 1);
  /** @type {any} */ (doc.getElementById('eCreditsID')).textContent = '40';
  await settle();
  assert.equal($('.tdf-profile-value').textContent, '41');
});

test('Font and Colour are closed by default and their headers show the current choice', () => {
  const { $, $$ } = setup();
  const accs = $$('details.tdf-profile-acc');
  assert.equal(accs.length, 2);
  assert.ok(accs.every((d) => !(/** @type {any} */ (d).open)));
  assert.equal($('.tdf-profile-now-font').textContent, 'verdana');
  assert.equal($('.tdf-profile-now-color').title, '#000080');
  // 11 fonts, each in its own face; the engine default matches case-insensitively.
  const fonts = $$('.tdf-profile-font');
  assert.equal(fonts.length, 11);
  assert.ok(fonts.every((b) => b.style.fontFamily.replace(/"/g, '') === b.dataset.font));
  assert.deepEqual(fonts.filter((b) => b.classList.contains('tdf-on')).map((b) => b.dataset.font), ['Verdana']);
  assert.equal($$('.tdf-profile-color').length, 108);
});

test('a font choice sets the engine global, restyles the box, writes the cookie, and nothing else', () => {
  const { $, win, calls } = setup();
  $('.tdf-profile-font[data-font="Georgia"]').click();
  assert.equal(/** @type {any} */ (win).textFamily, 'Georgia');
  assert.deepEqual(calls, [
    ['changeMessBoxStyle', 'optionsBar'],
    ['createCookie', 'myTextStyle', encodeURI('0|0|0|#000080|12px|Georgia'), 30],
  ]);
  assert.equal($('.tdf-profile-now-font').textContent, 'Georgia');
  assert.ok(!calls.some(([fn]) => fn === 'addFontFamily' || fn === 'addColor'));
});

test('a colour choice sets the engine global and the raw swatch; the preview is theme-shifted', () => {
  const { $, win, calls, theme } = setup();
  const navy = '#000080';
  const pick = COLORS[5];
  $(`.tdf-profile-color[data-color="${pick}"]`).click();
  assert.equal(/** @type {any} */ (win).textColor, pick);
  assert.deepEqual(calls[0], ['changeMessBoxStyle', 'optionsBar']);
  assert.deepEqual(calls[1], ['createCookie', 'myTextStyle', encodeURI(`0|0|0|${pick}|12px|verdana`), 30]);
  assert.equal($('.tdf-profile-now-color').title, pick);
  assert.ok(!calls.some(([fn]) => fn === 'addFontFamily' || fn === 'addColor'));

  // Navy passes on light, is shifted on dark, and the preview follows a switch while open.
  /** @type {any} */ (win).textColor = navy;
  theme.set('light');
  assert.equal($('.tdf-profile-preview').style.color, adapt(navy, THEME_BG.light));
  theme.set('dark');
  const shifted = adapt(navy, THEME_BG.dark);
  assert.notEqual(shifted.toLowerCase(), navy);
  assert.equal($('.tdf-profile-preview').style.color, shifted);
});

test('cleanup stops following the theme', () => {
  const { cleanup, theme } = setup();
  assert.equal(theme.listeners.size, 1);
  cleanup();
  assert.equal(theme.listeners.size, 0);
});

test('an engine function missing is shown in the flyout, not thrown', () => {
  const { $, win } = setup();
  delete (/** @type {any} */ (win)).sendStatus;
  $('.tdf-profile-seg[data-status="2"]').click();
  const error = $('.tdf-profile-error');
  assert.equal(error.hidden, false);
  assert.match(error.textContent ?? '', /sendStatus/);
});

test('without a theme the preview is the raw colour; with no colour it is the default', () => {
  const raw = setup({ theme: stubTheme(null) });
  assert.equal(raw.$('.tdf-profile-preview').style.color, '#000080');
  const none = setup({ flags: { textColor: '' } });
  assert.equal(none.$('.tdf-profile-preview').style.color, '');
  assert.equal(none.$('.tdf-profile-now-color').style.background, 'transparent');
});

test('a grey that fails contrast previews in the theme text colour', () => {
  const { $ } = setup({ flags: { textColor: '#000000' }, theme: stubTheme('dark') });
  assert.equal(adapt('#000000', THEME_BG.dark), '');
  assert.equal($('.tdf-profile-preview').style.color, 'var(--tdf-fg)');
});

test('with no avatar image the avatar shows your initials', () => {
  const { $ } = setup({ row: false });
  assert.equal($('.tdf-profile-avatar img'), null);
  assert.equal($('.tdf-profile-avatar .tdf-tile').textContent, 'MT');
});

test('with no engine eCredits the row says so and its click reports the missing control', () => {
  const { $, observers } = setup({ credits: false });
  assert.equal($('.tdf-profile-value').textContent, '–');
  assert.equal(observers.active, 0);
  $('.tdf-profile-credits').click();
  assert.match($('.tdf-profile-error').textContent ?? '', /eCredits control/);
});

test('a style choice with no changeMessBoxStyle reports it and leaves the engine untouched', () => {
  const { $, win, calls } = setup();
  delete (/** @type {any} */ (win)).changeMessBoxStyle;
  $('.tdf-profile-font[data-font="Impact"]').click();
  assert.match($('.tdf-profile-error').textContent ?? '', /changeMessBoxStyle/);
  assert.equal(/** @type {any} */ (win).textFamily, 'verdana');
  assert.deepEqual(calls, []);
});

test('a style choice with no createCookie reports it and leaves the engine untouched', () => {
  const { $, win, calls } = setup();
  delete (/** @type {any} */ (win)).createCookie;
  $('.tdf-profile-color[data-color="#00000a"]').click();
  assert.match($('.tdf-profile-error').textContent ?? '', /createCookie/);
  assert.equal(/** @type {any} */ (win).textColor, '#000080');
  assert.deepEqual(calls, []);
});

test('a head click after profiles were turned off reports it instead of doing nothing', () => {
  const { $, win, calls } = setup();
  /** @type {any} */ (win).profileOn = 0;
  $('.tdf-profile-head').click();
  assert.deepEqual(calls, []);
  assert.match($('.tdf-profile-error').textContent ?? '', /profiles are off/);
});

test('startProfile injects the styles and registers the panel once', () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = ownRow;
  Object.assign(win, { uID: 7, userName: 'Me%20Too', profileOn: 1, profileRef: 2, myFontFamily: FONTS, myColor: COLORS });
  /** @type {any[]} */
  const panels = [];
  const theme = stubTheme();
  const deps = {
    win: /** @type {any} */ (win),
    doc: /** @type {any} */ (doc),
    css: '.x{}',
    icon: '<svg></svg>',
    register: (/** @type {any} */ p) => panels.push(p),
    currentTheme: theme.currentTheme,
    onThemeChange: theme.onThemeChange,
    shift: (/** @type {string} */ c, /** @type {'light' | 'dark'} */ t) => adapt(c, THEME_BG[t]),
  };
  assert.equal(startProfile(deps), true);
  assert.equal(startProfile(deps), false);
  assert.equal(doc.querySelectorAll('#tdf-profile-style').length, 1);
  assert.equal(doc.getElementById('tdf-profile-style')?.textContent, '.x{}');
  assert.equal(panels.length, 1);
  assert.deepEqual({ id: panels[0].id, title: panels[0].title, icon: panels[0].icon, order: panels[0].order }, {
    id: 'profile', title: 'Profile', icon: '<svg></svg>', order: ORDER,
  });
  const container = doc.createElement('div');
  const cleanup = panels[0].render(container);
  assert.equal(container.querySelector('.tdf-profile-name')?.textContent, 'Me Too');
  assert.equal(container.querySelectorAll('.tdf-profile-font').length, 11);
  assert.equal(theme.listeners.size, 1);
  cleanup();
  assert.equal(theme.listeners.size, 0);
});

test('with online.gif the head shows your initials, then the forum picture found by your name and forum id', async () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = ownRow.replace("src='avatars/me.gif'", "src='avatars/online.gif'");
  Object.assign(win, { uID: 7, userName: 'Me%20Too', profileOn: 1, profileRef: 2, myFontFamily: FONTS, myColor: COLORS });
  /** @type {HTMLImageElement[]} */
  const made = [];
  const create = doc.createElement.bind(doc);
  /** @type {any} */ (doc).createElement = (/** @type {string} */ tag) => {
    const el = create(tag);
    if (tag === 'img') made.push(/** @type {any} */ (el));
    return el;
  };
  /** @type {any[]} */
  const panels = [];
  const theme = stubTheme();
  startProfile({
    win: /** @type {any} */ (win),
    doc: /** @type {any} */ (doc),
    css: '',
    icon: '',
    register: (/** @type {any} */ p) => panels.push(p),
    currentTheme: theme.currentTheme,
    onThemeChange: theme.onThemeChange,
    shift: (/** @type {string} */ c) => c,
  });
  /** @type {string[][]} */
  const asked = [];
  // Published after the panel registers, as the bootstrap does.
  /** @type {any} */ (win).__tdfChat2Avatars = {
    peek: () => undefined,
    resolve: (/** @type {string} */ name, /** @type {string} */ userID) => (asked.push([name, userID]), Promise.resolve('https://f/me.jpg')),
  };
  const container = doc.createElement('div');
  const cleanup = panels[0].render(container);
  const avatar = () => /** @type {HTMLElement} */ (container.querySelector('.tdf-profile-avatar'));
  assert.equal(avatar().querySelector('.tdf-tile')?.textContent, 'MT');
  assert.equal(avatar().querySelector('img'), null);
  await settle();
  assert.deepEqual(asked, [['Me Too', '97']]);
  const forum = made.filter((i) => i.getAttribute('src') === 'https://f/me.jpg');
  assert.equal(forum.length, 1);
  assert.equal(avatar().querySelector('img'), null);
  forum[0].dispatchEvent(new win.Event('load'));
  assert.equal(avatar().querySelector('img')?.getAttribute('src'), 'https://f/me.jpg');
  cleanup();
});
