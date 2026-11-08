import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { listPanels, registerRailPanel, registerUserMenuAction } from './api.js';
import { ICONS } from './icons.js';
import { NARROW_MAX, NARROW_QUERY, ensureViewport, mountRail, startRail } from './rail.js';
import { createPresence, presence as pagePresence } from '../../core/presence.js';
import { LIST_CAP, createUserStore } from './userList.js';

const row = (uuID, uUser, roomID, status = '') =>
  `<div id="userlist_${uuID}${roomID}" class="userlist"><div><span style='float:left;'><img id='avatar_${uuID}' src='avatars/a${uuID}.gif'>&nbsp;<span onclick='userPanel("me","${uUser}","${uuID}","${roomID}","9${uuID}","a${uuID}.gif","1","1.1.1.${uuID}")'>${uUser}</span><span id='ustatusID_${uuID}'>${status}</span></span></div></div>`;
const room = (roomID, name, rows) =>
  `<div id="room_${roomID}"><div class="roomheader"> <span style="float:left;"><img>&nbsp;${name}&nbsp;</span> <span class="usercount">[<span id="userCount_${roomID}">${rows.length}</span>]</span> </div>${rows.join('')}</div>`;

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

/** A stand-in for src/core/shell.js: records calls, holds a theme. */
function stubShell(initial = /** @type {'light' | 'dark' | null} */ ('light')) {
  let theme = initial;
  const listeners = new Set();
  const attached = [];
  const shell = {
    toggles: 0,
    attached,
    detached: 0,
    toggleTheme() {
      shell.toggles++;
      theme = theme === 'dark' ? 'light' : 'dark';
      for (const fn of listeners) fn(theme);
      return Promise.resolve();
    },
    onThemeChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentTheme: () => theme,
    attachScrollbar(el) {
      attached.push(el);
      return () => shell.detached++;
    },
  };
  return shell;
}

function setup({ host = true, extra = '', flags = {}, shell = stubShell(), prepare = (_doc) => {}, onReady, presence } = {}) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    `${host ? '<div id="tdf-chat"></div>' : ''}<input id="whisperID" value="">${extra}` +
    `<div id="userContainer">${room('1', 'Lobby', [row('7', 'me', '1'), row('12', 'Alice', '1', '&nbsp;[BRB]')])}${room('2', 'Back', [row('13', 'Bob', '2')])}${room('3', 'Den', [])}</div>`;
  const calls = [];
  Object.assign(win, {
    uID: 7, userName: 'me', roomID: 1, privateOn: 1, whisperOn: 1, profileOn: 1, profileRef: 2, groupPChat: 1,
    eCredits: 0, share: 0, admin: 0, moderator: 0, roomOwner: 0, intelliBotName: 'Intelli-bot',
    userStatusMes: ['select', 'Here', 'BRB', 'Away'],
    ...flags,
  });
  for (const fn of ['clearWhisper', 'blockUsers', 'viewProfile', 'createPChatDiv', 'showInfoBox', 'changeRooms', 'newWin']) {
    win[fn] = (...args) => calls.push([fn, ...args]);
  }
  win.whisperUser = (name) => {
    calls.push(['whisperUser', name]);
    doc.getElementById('whisperID').value = decodeURI(name);
  };
  win.clearWhisper = () => {
    calls.push(['clearWhisper']);
    doc.getElementById('whisperID').value = '';
  };
  prepare(doc);
  assert.equal(startRail({ doc, win, css: '/* rail */', shell, onReady, ...(presence ? { presence } : {}) }), true);
  // Removing #tdf-chat is the rail's teardown path (a failed start); tests use it to clean up.
  const teardown = async () => {
    doc.getElementById('tdf-chat')?.remove();
    await nextFrame();
  };
  const errors = () => [...doc.querySelectorAll('.tdf-rail-error div')].map((d) => d.textContent);
  const users = (roomID = '1') =>
    [...doc.querySelectorAll(`.tdf-rail-room[data-room="${roomID}"] .tdf-rail-user-name`)].map((s) => s.textContent);
  const icons = () => [...doc.querySelectorAll('.tdf-rail-icons > *')].flatMap((el) =>
    el.classList.contains('tdf-rail-theme') ? ['theme'] : [...el.querySelectorAll('[data-panel]')].map((b) => b.dataset.panel));
  const icon = (id) => doc.querySelector(`.tdf-rail-icon-btn[data-panel="${id}"]`);
  const flyout = () => doc.querySelector('.tdf-rail-flyout');
  const isOpen = () => flyout().classList.contains('tdf-open');
  const roomEl = (id) => doc.querySelector(`.tdf-rail-room[data-room="${id}"]`);
  /** Open the name menu on a user's row, as a left (or right) click at x, y. */
  const nameMenu = (uuID, { right = false, x = 600, y = 100 } = {}) => {
    const target = doc.querySelector(`.tdf-rail-user[data-uuid="${uuID}"] .tdf-rail-user-name`);
    target.dispatchEvent(new win.MouseEvent(right ? 'contextmenu' : 'click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return doc.querySelector('.tdf-rail-menu');
  };
  const items = () => [...doc.querySelectorAll('.tdf-rail-menu-item')].map((b) => b.dataset.action);
  const press = (el) => {
    const down = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    el.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    return down;
  };
  return { win, doc, calls, shell, errors, teardown, users, icons, icon, flyout, isOpen, roomEl, nameMenu, items, press };
}

test('the sidebar mounts on <body>, with the current room open and its users listed', async () => {
  const t = setup();
  assert.equal(t.doc.getElementById('tdf-rail').parentElement, t.doc.body);
  const lobby = t.roomEl('1');
  assert.ok(lobby.classList.contains('tdf-current'));
  assert.ok(lobby.classList.contains('tdf-open'));
  assert.equal(lobby.querySelector('.tdf-rail-room-name').textContent, 'Lobby');
  assert.equal(lobby.querySelector('.tdf-rail-room-count').textContent, '2');
  assert.ok(lobby.querySelector('.tdf-rail-caret svg'));
  assert.equal(lobby.parentElement.className, 'tdf-rail-current');
  assert.deepEqual(t.users(), ['me', 'Alice']);
  const alice = t.doc.querySelector('.tdf-rail-user[data-uuid="12"]');
  assert.equal(alice.querySelector('.tdf-rail-avatar img').getAttribute('src'), 'avatars/a12.gif');
  assert.equal(alice.querySelector('.tdf-rail-avatar .tdf-tile').textContent, 'AL');
  assert.equal(alice.querySelector('.tdf-rail-user-status').textContent, '[BRB]');
  assert.equal(t.isOpen(), false);
  await t.teardown();
});

test('other rooms sit collapsed at the bottom; expanded, Join room calls changeRooms', async () => {
  const t = setup();
  const others = [...t.doc.querySelectorAll('.tdf-rail-others > .tdf-rail-room')].map((r) => r.dataset.room);
  assert.deepEqual(others, ['2', '3']);
  const back = t.roomEl('2');
  assert.equal(back.classList.contains('tdf-open'), false);
  assert.equal(back.querySelector('.tdf-rail-users').hidden, true);
  assert.equal(back.querySelector('.tdf-rail-join').hidden, true);
  back.querySelector('.tdf-rail-room-chip').click();
  assert.equal(back.querySelector('.tdf-rail-room-chip').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(t.users('2'), ['Bob']);
  // A poll update keeps it open, and keeps the same elements.
  t.doc.getElementById('room_2').insertAdjacentHTML('beforeend', row('14', 'Cy', '2'));
  t.doc.getElementById('userCount_2').textContent = '2';
  await nextFrame();
  assert.equal(t.roomEl('2'), back);
  assert.deepEqual(t.users('2'), ['Bob', 'Cy']);
  assert.equal(back.querySelector('.tdf-rail-room-count').textContent, '2');
  back.querySelector('.tdf-rail-join').click();
  assert.deepEqual(t.calls, [['changeRooms', '2']]);
  // An empty room says so; the current room collapses and re-opens from its chip.
  t.roomEl('3').querySelector('.tdf-rail-room-chip').click();
  assert.equal(t.roomEl('3').querySelector('.tdf-rail-empty').textContent, 'Nobody here');
  t.roomEl('1').querySelector('.tdf-rail-room-chip').click();
  assert.equal(t.roomEl('1').classList.contains('tdf-open'), false);
  assert.equal(t.roomEl('1').querySelector('.tdf-rail-join').hidden, true, 'no Join on the current room');
  await t.teardown();
});

test('every user list scrolls through attachScrollbar, detached when its room goes', async () => {
  const t = setup();
  assert.deepEqual(t.shell.attached.map((el) => el.closest('.tdf-rail-room').dataset.room), ['1', '2', '3']);
  t.doc.getElementById('room_3').remove();
  await nextFrame();
  assert.equal(t.roomEl('3'), null);
  assert.equal(t.shell.detached, 1);
  await t.teardown();
  assert.equal(t.shell.detached, 3);
});

test('the list follows joins and leaves without a reload', async () => {
  const t = setup();
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('20', 'Carol', '1'));
  await nextFrame();
  assert.deepEqual(t.users(), ['me', 'Alice', 'Carol']);
  t.doc.getElementById('userlist_121').remove();
  await nextFrame();
  assert.deepEqual(t.users(), ['me', 'Carol']);
  await t.teardown();
});

test('the sidebar copies #userContainer\'s rect, raised to #roomIcon, and follows it', async () => {
  let rect = { top: 80, left: 900, width: 236, height: 500 };
  const t = setup({
    extra: '<div id="roomIcon"></div>',
    prepare: (doc) => {
      doc.getElementById('userContainer').getBoundingClientRect = () => rect;
      doc.getElementById('roomIcon').getBoundingClientRect = () => ({ top: 50 });
    },
  });
  const style = () => {
    const s = t.doc.getElementById('tdf-rail').style;
    return [s.top, s.left, s.width, s.height];
  };
  assert.deepEqual(style(), ['50px', '900px', '236px', '530px']);
  rect = { top: 80, left: 700, width: 236, height: 300 };
  t.win.dispatchEvent(new t.win.Event('resize'));
  await nextFrame();
  assert.deepEqual(style(), ['50px', '700px', '236px', '330px']);
  rect = { top: 40, left: 700, width: 236, height: 300 };
  t.doc.dispatchEvent(new t.win.Event('scroll'));
  await nextFrame();
  assert.deepEqual(style(), ['10px', '700px', '236px', '330px'], 'the raise is kept as an offset');
  await t.teardown();
});

test('a #roomIcon below the list, or none, raises nothing', async () => {
  for (const extra of ['', '<div id="roomIcon"></div>']) {
    const t = setup({
      extra,
      prepare: (doc) => {
        doc.getElementById('userContainer').getBoundingClientRect = () => ({ top: 80, left: 0, width: 236, height: 500 });
        const icon = doc.getElementById('roomIcon');
        if (icon) icon.getBoundingClientRect = () => ({ top: 600 });
      },
    });
    assert.equal(t.doc.getElementById('tdf-rail').style.top, '80px');
    await t.teardown();
  }
});

test('a burst of scrolls reads the rect once per frame, and an unchanged rect writes nothing', async () => {
  let reads = 0;
  const rect = { top: 40, left: 900, width: 236, height: 500 };
  const t = setup({
    prepare: (doc) => {
      doc.getElementById('userContainer').getBoundingClientRect = () => {
        reads++;
        return rect;
      };
    },
  });
  const root = t.doc.getElementById('tdf-rail');
  reads = 0;
  for (let i = 0; i < 10; i++) t.doc.dispatchEvent(new t.win.Event('scroll'));
  root.style.top = '1px';
  await nextFrame();
  assert.equal(reads, 1);
  assert.equal(root.style.top, '1px', 'the same rect is not written again');
  await t.teardown();
});

test('the engine list and room controls are hidden only while the rail works', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  const list = /body:has\(#tdf-rail:not\(\.tdf-rail-failed\)\) #userContainer \{([^}]*)\}/.exec(css);
  assert.ok(list, 'the list rule is keyed on a working rail');
  assert.match(list[1], /visibility: hidden !important/);
  const controls = /body:has\(#tdf-rail:not\(\.tdf-rail-failed\)\) :is\(([^)]*)\) \{([^}]*)\}/.exec(css);
  assert.ok(controls, 'the controls rule is keyed on a working rail');
  assert.deepEqual(controls[1].split(',').map((s) => s.trim()), ['#roomIcon', '#roomCreate', '#roomSelect', '#optionsLogout']);
  assert.match(controls[2], /display: none !important/);
  const failed = /#tdf-rail\.tdf-rail-failed :is\(([^)]*)\) \{([^}]*)\}/.exec(css);
  assert.ok(failed, 'a failed rail hides its rooms and Logout');
  assert.deepEqual(failed[1].split(',').map((s) => s.trim()), ['.tdf-rail-current', '.tdf-rail-others', '.tdf-rail-logout']);
  assert.match(failed[2], /display: none !important/);
});

test('the current room gives up height first; the other rooms scroll as a last resort, keeping Logout in the rail (TDF-0072)', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  const rule = (selector) => {
    const m = new RegExp(`${selector.replace(/[.#]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
    assert.ok(m, `rail.css has a ${selector} rule`);
    return m[1];
  };
  assert.match(rule('#tdf-rail'), /\bgap: 6px;/);
  const others = rule('#tdf-rail .tdf-rail-others');
  const current = rule('#tdf-rail .tdf-rail-current');
  const shrink = (r) => Number(/\bflex: \d+ (\d+) auto;/.exec(r)?.[1]);
  assert.match(current, /flex: 1 1000 auto;/);
  assert.match(current, /min-height: 0;/);
  assert.match(current, /overflow-y: clip;/);
  assert.match(others, /flex: 0 1 auto;/);
  assert.ok(shrink(current) >= 1000 * shrink(others), 'the current room gives up height long before the others');
  assert.match(others, /min-height: 0;/);
  assert.match(others, /overflow-y: auto;/);
  assert.match(others, /padding: 4px;/);
  assert.match(others, /margin: -4px;/);
});

test('the sidebar colours follow the design in both themes, and the flyout width is 418px', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  const block = (theme) => new RegExp(`:root\\[data-tdf-theme="${theme}"\\] \\{([^}]*)\\}`).exec(css)[1];
  assert.match(block('light'), /--tdf-rail-bg: #EDEDF5;/);
  assert.match(block('light'), /--tdf-rail-chip-bg: #F6F6FB;/);
  assert.match(block('light'), /--tdf-rail-chip-border: #DCDCE6;/);
  assert.match(block('dark'), /--tdf-rail-bg: #27272E;/);
  assert.match(block('dark'), /--tdf-rail-chip-bg: #32323B;/);
  assert.match(block('dark'), /--tdf-rail-chip-border: #43434E;/);
  assert.match(css, /--tdf-flyout-w: 418px;/);
});

test('the sidebar font is the message view\'s UI font', () => {
  const theme = readFileSync(new URL('../../core/theme.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  const stack = /--tdf-ui-font: ([^;]+);/.exec(theme)[1];
  assert.ok(css.includes(`font: 13px/1.4 ${stack};`), 'rail.css repeats theme.css\'s --tdf-ui-font');
});

test('the icon row: start panels in order, the theme toggle, then end-aligned panels', async () => {
  const t = setup();
  const offs = [
    registerRailPanel({ id: 'gear', title: 'Settings', icon: 'S', align: 'end', render() {} }),
    registerRailPanel({ id: 'profile', title: 'Profile', icon: 'P', order: 20, render() {} }),
    registerRailPanel({ id: 'gallery', title: 'Gallery', icon: 'G', order: 10, render() {} }),
  ];
  assert.deepEqual(t.icons(), ['gallery', 'profile', 'theme', 'gear']);
  assert.ok(t.icon('gear').parentElement.classList.contains('tdf-rail-end'));
  offs.forEach((off) => off());
  assert.deepEqual(t.icons(), ['theme']);
  await t.teardown();
});

test('the theme toggle calls toggleTheme and swaps moon (light) for sun (dark)', async () => {
  const t = setup();
  const toggle = t.doc.querySelector('.tdf-rail-theme');
  const glyph = () => toggle.querySelector('path:last-child').getAttribute('d');
  const pathOf = (svg) => /<path d="([^"]*)"\/><\/svg>$/.exec(svg)[1];
  assert.equal(glyph(), pathOf(ICONS.moon));
  assert.equal(toggle.title, 'Switch to dark');
  toggle.click();
  assert.equal(t.shell.toggles, 1);
  assert.equal(glyph(), pathOf(ICONS.sun));
  assert.equal(toggle.title, 'Switch to light');
  await t.teardown();

  // Before the shell has a theme, the page's own preference stands in.
  const dark = setup({
    shell: stubShell(null),
    prepare: (doc) => {
      doc.defaultView.matchMedia = (q) => ({ matches: q === '(prefers-color-scheme: dark)' });
    },
  });
  assert.equal(dark.doc.querySelector('.tdf-rail-theme path:last-child').getAttribute('d'), pathOf(ICONS.sun));
  await dark.teardown();
});

test('a failed theme save is reported in the rail', async () => {
  const shell = stubShell();
  shell.toggleTheme = () => Promise.reject(new Error('quota'));
  const t = setup({ shell });
  t.doc.querySelector('.tdf-rail-theme').click();
  await nextFrame();
  assert.deepEqual(t.errors(), ['Rail: quota']);
  await t.teardown();
});

test('a name opens the menu, left or right click: Whisper first, then the gated actions, then registered ones', async () => {
  const t = setup();
  const ran = [];
  const off = registerUserMenuAction({ id: 'tag', label: 'Tag images', icon: ICONS.caret, run: (u) => ran.push(u.uuID) });
  const menu = t.nameMenu('12', { right: true });
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector('.tdf-rail-menu-title').textContent, 'Alice');
  assert.deepEqual(t.items(), ['whisper', 'private', 'profile', 'block', 'unblock', 'report', 'tag']);
  assert.ok(menu.querySelector('[data-action="tag"] svg'));
  t.doc.querySelector('[data-action="whisper"]').click();
  assert.deepEqual(t.calls, [['whisperUser', 'Alice']]);
  assert.equal(menu.hidden, true, 'an action closes the menu');
  // Read on open: the same menu now offers Stop whispering, and it clears.
  t.nameMenu('12');
  assert.equal(t.items()[0], 'stop-whisper');
  assert.equal(t.doc.querySelector('[data-action="stop-whisper"]').textContent, 'Stop whispering');
  t.doc.querySelector('[data-action="stop-whisper"]').click();
  assert.deepEqual(t.calls.at(-1), ['clearWhisper']);
  assert.equal(t.doc.getElementById('whisperID').value, '');
  // Someone else's whisper target leaves Whisper on this name.
  t.doc.getElementById('whisperID').value = 'Bob';
  t.nameMenu('12');
  assert.equal(t.items()[0], 'whisper');
  t.nameMenu('12');
  t.doc.querySelector('[data-action="tag"]').click();
  assert.deepEqual(ran, ['12']);
  off();
  await t.teardown();
});

test('Whisper is disabled on your own name, and otherwise calls whisperUser directly', async () => {
  const t = setup();
  t.nameMenu('7');
  const own = t.doc.querySelector('[data-action="whisper"]');
  assert.equal(own.disabled, true);
  assert.deepEqual(t.items(), ['whisper', 'profile']);
  await t.teardown();
  // It replaces the ungated Whisper To field: a guest group whisper still goes through,
  // while userPanel's gated private chat keeps the engine's refusal.
  const guest = setup({ flags: { groupPChat: 0 } });
  guest.nameMenu('12');
  guest.doc.querySelector('[data-action="whisper"]').click();
  assert.deepEqual(guest.calls, [['whisperUser', 'Alice']]);
  guest.nameMenu('12');
  guest.doc.querySelector('[data-action="private"]').click();
  assert.equal(guest.calls[1][0], 'showInfoBox');
  await guest.teardown();
});

test('the name menu opens leftward from the pointer and stays in the viewport', async () => {
  const t = setup();
  const menu = t.doc.querySelector('.tdf-rail-menu');
  menu.getBoundingClientRect = () => ({ width: 160, height: 200 });
  t.win.innerHeight = 400;
  t.nameMenu('12', { x: 600, y: 100 });
  assert.deepEqual([menu.style.left, menu.style.top], ['440px', '100px']);
  t.nameMenu('12', { x: 50, y: 350 });
  assert.deepEqual([menu.style.left, menu.style.top], ['8px', '192px']);
  await t.teardown();
});

test('Esc, a press outside it and a scroll in the rail close the name menu', async () => {
  const t = setup();
  const menu = t.nameMenu('12');
  t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(menu.hidden, true);
  t.nameMenu('12');
  menu.querySelector('.tdf-rail-menu-title').dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(menu.hidden, false, 'a press inside keeps it');
  t.doc.body.dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(menu.hidden, true);
  t.nameMenu('12');
  t.doc.getElementById('tdf-chat').dispatchEvent(new t.win.Event('scroll'));
  t.doc.dispatchEvent(new t.win.Event('scroll'));
  assert.equal(menu.hidden, false, 'the message view\'s autoscroll, or the page\'s, keeps it');
  t.doc.querySelector('.tdf-rail-users').dispatchEvent(new t.win.Event('scroll'));
  assert.equal(menu.hidden, true);
  await t.teardown();
});

test('Logout presses the engine\'s own Logout control', async () => {
  const t = setup({ extra: '<button id="optionsLogout"></button>' });
  let pressed = 0;
  t.doc.getElementById('optionsLogout').addEventListener('click', () => pressed++);
  const logout = t.doc.querySelector('.tdf-rail-logout');
  assert.equal(logout.textContent, 'Logout');
  assert.equal(logout.previousElementSibling.className, 'tdf-rail-others', 'under the last room');
  logout.click();
  assert.equal(pressed, 1);
  t.doc.getElementById('optionsLogout').remove();
  logout.click();
  assert.deepEqual(t.errors(), ['Rail: the chat engine has no Logout control']);
  await t.teardown();
});

test('a panel icon toggles its flyout, carrying its renderRailSlot after the glyph', async () => {
  const t = setup();
  let rendered = 0;
  const off = registerRailPanel({
    id: 'g', title: 'Gallery', icon: ICONS.caret,
    render: (el) => { rendered++; el.append('opened'); },
    renderRailSlot: (el) => { el.innerHTML = '<img class="thumb">'; },
  });
  const btn = t.icon('g');
  assert.deepEqual([...btn.children].map((c) => c.className), ['tdf-rail-glyph', 'tdf-rail-slot']);
  assert.ok(btn.querySelector('.tdf-rail-glyph svg'));
  btn.querySelector('.thumb').click();
  assert.equal(t.isOpen(), true);
  assert.equal(t.flyout().getAttribute('aria-label'), 'Gallery');
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'opened');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok(t.shell.attached.includes(t.doc.querySelector('.tdf-rail-body')), 'the flyout body scrolls through attachScrollbar');
  btn.click();
  assert.equal(t.isOpen(), false);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(rendered, 1);
  off();
  await t.teardown();
});

test('a text icon renders as text, never markup', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'txt', title: 'Txt', icon: '<b>x</b>', render() {} });
  const glyph = t.icon('txt').querySelector('.tdf-rail-glyph');
  assert.equal(glyph.textContent, '<b>x</b>');
  assert.equal(glyph.querySelector('b'), null);
  off();
  await t.teardown();
});

test('the first press outside an open flyout only closes it; panel icons switch it', async () => {
  const t = setup();
  let cleaned = 0;
  const offA = registerRailPanel({ id: 'a', title: 'A', icon: 'A', render: () => () => cleaned++ });
  const offB = registerRailPanel({ id: 'b', title: 'B', icon: 'B', render: (el) => el.append('b') });
  t.icon('a').click();
  // A press on a room chip closes the flyout and does nothing else.
  const chip = t.roomEl('2').querySelector('.tdf-rail-room-chip');
  const down = t.press(chip);
  assert.equal(down.defaultPrevented, true);
  assert.equal(t.isOpen(), false);
  assert.equal(t.roomEl('2').classList.contains('tdf-open'), false, 'the click was swallowed');
  assert.equal(cleaned, 1);
  // With nothing open, the next press works normally.
  t.press(chip);
  assert.equal(t.roomEl('2').classList.contains('tdf-open'), true);
  // A press inside the flyout keeps it.
  t.icon('a').click();
  t.press(t.doc.querySelector('.tdf-rail-body'));
  assert.equal(t.isOpen(), true);
  // Another panel's icon switches to it.
  t.press(t.icon('b'));
  assert.equal(t.isOpen(), true);
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'b');
  assert.equal(t.icon('a').getAttribute('aria-expanded'), 'false');
  assert.equal(t.icon('b').getAttribute('aria-expanded'), 'true');
  // The theme toggle is not a panel icon: the first press only closes.
  t.press(t.doc.querySelector('.tdf-rail-theme'));
  assert.equal(t.isOpen(), false);
  assert.equal(t.shell.toggles, 0);
  // Esc closes.
  t.icon('a').click();
  t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(t.isOpen(), false);
  assert.equal(cleaned, 3);
  offA();
  offB();
  await t.teardown();
});

test('a press inside the media popover layer neither closes the flyout nor is swallowed', async () => {
  const t = setup();
  let cleaned = 0;
  const off = registerRailPanel({ id: 'a', title: 'A', icon: 'A', render: () => () => cleaned++ });
  t.icon('a').click();
  const layer = t.doc.createElement('div');
  layer.className = 'tdf-lb';
  const next = t.doc.createElement('button');
  next.className = 'tdf-lb-next';
  next.append('Next');
  layer.append(next);
  t.doc.body.append(layer);
  let clicks = 0;
  next.addEventListener('click', () => clicks++);
  const down = t.press(next);
  assert.equal(down.defaultPrevented, false);
  assert.equal(t.isOpen(), true);
  assert.equal(cleaned, 0);
  assert.equal(clicks, 1, 'the click reached the popover');
  // A press on a text node inside the layer counts as inside too.
  t.press(next.firstChild);
  assert.equal(t.isOpen(), true);
  layer.remove();
  off();
  await t.teardown();
});

test('a press that is never clicked does not swallow the next click', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'a', title: 'A', icon: 'A', render() {} });
  t.icon('a').click();
  const chip = t.roomEl('2').querySelector('.tdf-rail-room-chip');
  chip.dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  chip.dispatchEvent(new t.win.MouseEvent('mouseup', { bubbles: true }));
  await nextFrame();
  chip.click();
  assert.equal(t.roomEl('2').classList.contains('tdf-open'), true);
  off();
  await t.teardown();
});

test('the flyout contents settle after the slide, at once when switching or with reduced motion', async () => {
  const t = setup();
  const offA = registerRailPanel({ id: 'a', title: 'A', icon: 'A', render() {} });
  const offB = registerRailPanel({ id: 'b', title: 'B', icon: 'B', render() {} });
  const settled = () => t.flyout().classList.contains('tdf-settled');
  t.icon('a').click();
  assert.equal(settled(), false);
  const end = new t.win.Event('transitionend');
  end.propertyName = 'transform';
  t.flyout().dispatchEvent(end);
  assert.equal(settled(), true);
  t.icon('b').click();
  assert.equal(settled(), true, 'switching panels has no slide to wait for');
  t.icon('b').click();
  assert.equal(settled(), false);
  t.icon('a').click();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(settled(), true, 'settles even if no transitionend arrives');
  offA();
  offB();
  await t.teardown();

  const reduced = setup({
    prepare: (doc) => {
      doc.defaultView.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    },
  });
  const offR = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render() {} });
  reduced.icon('r').click();
  assert.equal(reduced.flyout().classList.contains('tdf-settled'), true);
  offR();
  await reduced.teardown();
});

test('open(arg) shows the panel and passes arg to render; an icon click passes none', async () => {
  const t = setup();
  const args = [];
  const handle = registerRailPanel({ id: 'o', title: 'O', icon: 'O', render: (_el, arg) => { args.push(arg); } });
  handle.open({ user: '12' });
  assert.equal(t.isOpen(), true);
  assert.equal(t.flyout().getAttribute('aria-label'), 'O');
  assert.equal(t.icon('o').getAttribute('aria-expanded'), 'true');
  t.icon('o').click();
  t.icon('o').click();
  assert.deepEqual(args, [{ user: '12' }, undefined]);
  // A replacement under the same id re-opens with the arg it was opened with.
  handle.open('again');
  const offNew = registerRailPanel({ id: 'o', title: 'O2', icon: 'O', render: (_el, arg) => { args.push(['new', arg]); } });
  assert.deepEqual(args.at(-1), ['new', 'again']);
  // The replaced handle no longer opens anything, and says so.
  t.icon('o').click();
  handle.open();
  assert.equal(t.isOpen(), false);
  assert.deepEqual(t.errors(), ['Rail: rail panel o is no longer registered']);
  offNew();
  handle();
  await t.teardown();
  // After teardown there is no rail to open in: a no-op, not a throw.
  const late = registerRailPanel({ id: 'late', title: 'L', icon: 'L', render() {} });
  late.open();
  late();
});

test('a panel whose render throws is reported, not fatal', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'bad', title: 'Bad', icon: 'B', render: () => { throw new Error('boom'); } });
  t.icon('bad').click();
  assert.deepEqual(t.errors(), ['Rail: boom']);
  assert.deepEqual(t.users(), ['me', 'Alice']);
  off();
  await t.teardown();
});

test('the rail waits for #tdf-chat, mounts once with its style, and tears down when it goes', async () => {
  const t = setup({ host: false });
  assert.equal(t.doc.getElementById('tdf-rail'), null);
  t.doc.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await nextFrame();
  assert.ok(t.doc.querySelector('body > #tdf-rail'));
  assert.equal(t.doc.getElementById('tdf-rail-style').textContent, '/* rail */');
  // A second copy of the script does not start a rail of its own.
  assert.equal(startRail({ doc: t.doc, win: t.win, css: '', shell: stubShell() }), false);
  await nextFrame();
  assert.equal(t.doc.querySelectorAll('#tdf-rail').length, 1);
  await t.teardown();
  assert.equal(t.doc.getElementById('tdf-rail'), null);
  assert.equal(t.doc.querySelector('.tdf-rail-menu'), null);
  assert.deepEqual(listPanels(), []);
});

test('the rail mounts again when #tdf-chat comes back', async () => {
  const t = setup();
  await t.teardown();
  t.doc.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await nextFrame();
  assert.ok(t.doc.getElementById('tdf-rail'));
  assert.deepEqual(t.users(), ['me', 'Alice']);
  assert.equal(t.doc.querySelectorAll('.tdf-rail-menu').length, 1);
  await t.teardown();
});

test('a page with no user list mounts nothing', () => {
  const win = new Window();
  win.document.body.innerHTML = '<div id="tdf-chat"></div>';
  let ready = 0;
  assert.equal(startRail({ doc: win.document, win, css: '', shell: stubShell(), onReady: () => ready++ }), false);
  assert.equal(win.document.getElementById('tdf-rail'), null);
  assert.equal(ready, 1, 'a rail that will not start reports ready at once');
});

test('onReady fires once, after the first mount beside #tdf-chat, and not on a remount', async () => {
  let ready = 0;
  const t = setup({ host: false, onReady: () => ready++ });
  await nextFrame();
  assert.equal(ready, 0, 'not before #tdf-chat exists');
  t.doc.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await nextFrame();
  assert.ok(t.doc.getElementById('tdf-rail'));
  assert.equal(ready, 1);
  await t.teardown();
  t.doc.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await nextFrame();
  assert.ok(t.doc.getElementById('tdf-rail'));
  assert.equal(ready, 1);
  let second = 0;
  assert.equal(startRail({ doc: t.doc, win: t.win, css: '', shell: stubShell(), onReady: () => second++ }), false);
  assert.equal(second, 1, 'a second copy reports ready at once');
  await t.teardown();
});

test('a status rewrite with the same text does not re-render the list', async () => {
  const t = setup();
  const list = t.doc.querySelector('.tdf-rail-users ul li');
  t.doc.getElementById('ustatusID_7').innerHTML = '';
  await nextFrame();
  assert.equal(t.doc.querySelector('.tdf-rail-users ul li'), list);
  await t.teardown();
});

test('a room the page is not in shows the unavailable notice; Intelli-bot gets only Whisper', async () => {
  const t = setup({ flags: { roomID: 99 } });
  assert.equal(t.doc.querySelector('.tdf-rail-current .tdf-rail-empty').textContent, 'The user list is not available.');
  t.win.roomID = 1;
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('40', 'Intelli-bot', '1'));
  await nextFrame();
  assert.equal(t.roomEl('1').parentElement.className, 'tdf-rail-current');
  t.nameMenu('40');
  assert.deepEqual(t.items(), ['whisper']);
  await t.teardown();
});

test('engine and registered-action failures are shown in the rail with their cause', async () => {
  const t = setup();
  delete t.win.viewProfile;
  const off = registerUserMenuAction({ id: 'odd', label: 'Odd', isVisible: () => { throw new Error('no idea'); }, run() {} });
  t.nameMenu('12');
  assert.equal(t.doc.querySelector('[data-action="odd"]'), null);
  t.doc.querySelector('[data-action="profile"]').click();
  t.nameMenu('12');
  t.doc.querySelector('[data-action="profile"]').click();
  delete t.win.changeRooms;
  t.roomEl('2').querySelector('.tdf-rail-room-chip').click();
  t.roomEl('2').querySelector('.tdf-rail-join').click();
  assert.deepEqual(t.errors(), [
    'Rail: user menu action odd: no idea (×2)',
    'Rail: the chat engine has no viewProfile() (×2)',
    'Rail: the chat engine has no changeRooms()',
  ]);
  t.doc.querySelector('.tdf-rail-error').click();
  assert.equal(t.doc.querySelector('.tdf-rail-error').hidden, true);
  off();
  await t.teardown();
});

test('an open panel replaced under its id re-opens; one unregistered closes', async () => {
  const t = setup();
  const off1 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.append('one'); } });
  t.icon('r').click();
  const off2 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.append('two'); } });
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'two');
  off1();
  off2();
  assert.equal(t.isOpen(), false);
  await t.teardown();
});

test('a user list that cannot mount is reported and leaves the engine controls showing', async () => {
  let ready = 0;
  const t = setup({
    onReady: () => ready++,
    extra: '<div id="roomIcon"></div>',
    prepare: (doc) => {
      doc.getElementById('userContainer').getBoundingClientRect = () => ({ top: 80, left: 900, width: 236, height: 500 });
      doc.getElementById('roomIcon').getBoundingClientRect = () => ({ top: 50 });
      Object.defineProperty(doc.getElementById('userContainer'), 'children', {
        get() {
          throw new Error('unreadable');
        },
      });
    },
  });
  assert.ok(t.doc.getElementById('tdf-rail').classList.contains('tdf-rail-failed'));
  assert.deepEqual(t.errors(), ['Rail: unreadable']);
  assert.equal(ready, 1, 'a failed mount still reports ready');
  assert.equal(t.doc.querySelector('.tdf-rail-users'), null);
  const { top, height } = t.doc.getElementById('tdf-rail').style;
  assert.deepEqual([top, height], ['80px', '500px'], 'no raise over the engine row it re-shows');
  await t.teardown();
  assert.equal(t.doc.getElementById('tdf-rail'), null);
});

test('the user store reports an unreadable list and a throwing subscriber, and still tells the rest', async () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = `<div id="userContainer">${room('1', 'Lobby', [row('7', 'me', '1')])}</div>`;
  const container = doc.getElementById('userContainer');
  const errors = [];
  const store = createUserStore(win, container, (e) => errors.push(e.message));
  let told = 0;
  store.subscribe(() => {
    throw new Error('bad subscriber');
  });
  store.subscribe(() => told++);
  doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('8', 'Al', '1'));
  await nextFrame();
  assert.deepEqual(errors, ['bad subscriber']);
  assert.equal(told, 1);
  Object.defineProperty(container, 'children', {
    get() {
      throw new Error('unreadable');
    },
  });
  doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('9', 'Bo', '1'));
  await nextFrame();
  assert.deepEqual(errors, ['bad subscriber', 'unreadable']);
  assert.equal(told, 1);
  assert.deepEqual(store.rooms()[0].users.map((u) => u.name), ['me', 'Al']);
  store.disconnect();
});

test('rail slot cleanups run on every re-render and on teardown; a throwing slot is reported', async () => {
  const t = setup();
  let cleaned = 0;
  const off = registerRailPanel({ id: 's', title: 'S', icon: 'S', render() {}, renderRailSlot: () => () => cleaned++ });
  const offBad = registerRailPanel({
    id: 'x', title: 'X', icon: 'X', render() {},
    renderRailSlot: () => {
      throw new Error('slot broke');
    },
  });
  assert.equal(cleaned, 1, 'the second registration re-rendered the icons');
  assert.deepEqual(t.errors(), ['Rail: slot broke']);
  offBad();
  assert.equal(cleaned, 2);
  await t.teardown();
  assert.equal(cleaned, 3);
  off();
  assert.equal(cleaned, 3, 'a destroyed rail no longer renders');
});

test('a panel with a bad icon is reported and the rest of the rail still mounts', async () => {
  const off = registerRailPanel({ id: 'bad-icon', title: 'Bad', icon: /** @type {any} */ (42), render() {} });
  const t = setup();
  assert.equal(t.doc.getElementById('tdf-rail').classList.contains('tdf-rail-failed'), false);
  assert.deepEqual(t.users(), ['me', 'Alice']);
  assert.equal(t.errors().length, 1);
  assert.deepEqual(t.icons(), ['theme']);
  const offGood = registerRailPanel({ id: 'good', title: 'Good', icon: 'G', render() {} });
  assert.deepEqual(t.icons(), ['good', 'theme'], 'a good panel still gets its icon');
  offGood();
  off();
  await t.teardown();
});

test('a rail that throws while mounting is marked failed, leaving the engine controls showing', async () => {
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => logged.push(args);
  const t = setup({
    extra: '<div id="roomIcon"></div>',
    prepare: (doc) => {
      doc.getElementById('userContainer').getBoundingClientRect = () => ({ top: 80, left: 900, width: 236, height: 500 });
      doc.getElementById('roomIcon').getBoundingClientRect = () => ({ top: 50 });
      const append = doc.body.appendChild.bind(doc.body);
      doc.body.appendChild = (node) => {
        append(node);
        if (node.id === 'tdf-rail') throw new Error('mount broke');
        return node;
      };
    },
  });
  console.error = consoleError;
  assert.ok(t.doc.getElementById('tdf-rail').classList.contains('tdf-rail-failed'));
  assert.equal(logged[0]?.[1]?.message, 'mount broke');
  const box = t.doc.querySelector('#tdf-rail .tdf-rail-error');
  assert.equal(box.hidden, false);
  assert.equal(box.textContent, 'Rail: mount broke', 'the cause shows in the rail');
  assert.equal(t.doc.getElementById('tdf-rail').style.top, '80px', 'no raise over the engine row');
  await t.teardown();
  assert.equal(t.doc.getElementById('tdf-rail'), null);
});

test('a repeated failure bumps the count on its line, and the box keeps only the latest lines', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'e', title: 'E', icon: 'E', render: () => { throw new Error('again'); } });
  for (let i = 0; i < 3; i++) {
    t.icon('e').click();
    t.icon('e').click();
  }
  assert.deepEqual(t.errors(), ['Rail: again (×3)']);
  off();
  let n = 0;
  const offMany = registerRailPanel({ id: 'm', title: 'M', icon: 'M', render: () => { throw new Error(`fail ${n++}`); } });
  for (let i = 0; i < 30; i++) {
    t.icon('m').click();
    t.icon('m').click();
  }
  assert.equal(t.errors().length, 20);
  assert.equal(t.errors().at(-1), 'Rail: fail 29');
  offMany();
  await t.teardown();
});

test('a room with no name is labelled by its id', async () => {
  const t = setup({
    prepare: (doc) => {
      doc.querySelector('#room_1 .roomheader span').innerHTML = '<img>&nbsp;&nbsp;';
    },
  });
  assert.equal(t.roomEl('1').querySelector('.tdf-rail-room-name').textContent, '1');
  await t.teardown();
});

test('a user with online.gif shows the initials tile, then the forum picture found by their forum id', async () => {
  const asked = [];
  const made = [];
  const t = setup({
    flags: { __tdfChat2Avatars: { resolve: (name, userID) => (asked.push([name, userID]), Promise.resolve('https://f/alice.jpg')) } },
    prepare: (doc) => {
      const span = [...doc.querySelectorAll('span[onclick]')].find((s) => s.textContent === 'Alice');
      span.setAttribute('onclick', span.getAttribute('onclick').replace('"a12.gif"', '"online.gif"'));
      const create = doc.createElement.bind(doc);
      doc.createElement = (tag) => {
        const el = create(tag);
        if (tag === 'img') made.push(el);
        return el;
      };
    },
  });
  const alice = () => t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-avatar');
  assert.equal(alice().querySelector('.tdf-tile').textContent, 'AL');
  assert.equal(alice().querySelector('img'), null);
  await nextFrame();
  // Every user's forum picture is asked for on sight, picked chat avatar or not; Alice's is checked here.
  assert.deepEqual(asked.find(([name]) => name === 'Alice'), ['Alice', '912']);
  for (const img of made.filter((i) => i.getAttribute('src') === 'https://f/alice.jpg')) img.dispatchEvent(new t.win.Event('load'));
  assert.equal(alice().querySelector('img').getAttribute('src'), 'https://f/alice.jpg');
  await t.teardown();
});

test("the popover class the rail exempts matches the lightbox's own layer class", () => {
  const rail = readFileSync(new URL('./rail.js', import.meta.url), 'utf8');
  const lightbox = readFileSync(new URL('../gallery/lightbox.js', import.meta.url), 'utf8');
  const layer = /const LAYER = '([^']+)';/.exec(lightbox)?.[1];
  assert.ok(layer, 'lightbox.js declares its LAYER class');
  assert.ok(rail.includes(`closest('.${layer}')`), `rail.js exempts .${layer}`);
});

// Recently online (TDF-0058): ghosted below the current room's online users.

const seenLine = (uuID, name, kind, mTime) => ({ uuID, name, kind, mTime: String(mTime) });
const offlineNames = (doc, roomID = '1') =>
  [...doc.querySelectorAll(`.tdf-rail-room[data-room="${roomID}"] .tdf-rail-offline .tdf-rail-user-name`)].map((s) => s.textContent);
const onlineNames = (doc, roomID = '1') =>
  [...doc.querySelectorAll(`.tdf-rail-room[data-room="${roomID}"] .tdf-rail-user:not(.tdf-rail-offline) .tdf-rail-user-name`)].map((s) => s.textContent);

test('recently online users show ghosted under a rule and a header, newest first, online users excluded', async () => {
  const presence = createPresence();
  presence.ingest('1', [
    seenLine('30', 'Old', 'exit', 100),
    seenLine('12', 'Alice', 'entry', 400), // online now: not ghosted
    seenLine('31', 'New', 'exit', 300),
    seenLine('32', 'Gone quiet', 'entry', 200), // an entry with no exit, but not online: ghosted
  ]);
  const t = setup({ presence });
  assert.deepEqual(onlineNames(t.doc), ['me', 'Alice']);
  assert.deepEqual(offlineNames(t.doc), ['New', 'Gone quiet', 'Old']);
  const list = t.roomEl('1').querySelector('ul');
  const kinds = [...list.children].map((li) => li.className);
  assert.deepEqual(kinds.slice(2, 4), ['tdf-rail-rule', 'tdf-rail-section-head']);
  assert.equal(list.querySelector('.tdf-rail-section-head').textContent, 'Recently online');
  assert.equal(list.querySelector('.tdf-rail-rule').getAttribute('role'), 'separator');
  const ghost = list.querySelector('.tdf-rail-offline');
  assert.equal(ghost.querySelector('.tdf-rail-user-status'), null, 'no status tag');
  assert.equal(ghost.querySelector('.tdf-rail-avatar img'), null, 'no avatars/ file requested');
  assert.ok(ghost.querySelector('.tdf-rail-avatar .tdf-tile').textContent.length > 0);
  await t.teardown();
});

test('with nobody recently online there is no rule or header', async () => {
  const t = setup({ presence: createPresence() });
  const list = t.roomEl('1').querySelector('ul');
  assert.equal(list.querySelector('.tdf-rail-rule'), null);
  assert.equal(list.querySelector('.tdf-rail-section-head'), null);
  await t.teardown();
});

test('only the current room gets a recently online section', async () => {
  const presence = createPresence();
  presence.ingest('2', [seenLine('40', 'Zed', 'exit', 100)]);
  const t = setup({ presence });
  t.roomEl('2').querySelector('.tdf-rail-room-chip').click();
  assert.deepEqual(offlineNames(t.doc, '2'), []);
  assert.equal(t.roomEl('2').querySelector('.tdf-rail-section-head'), null);
  await t.teardown();
});

test(`the list holds at most ${LIST_CAP} rows: offline users fill what online users leave`, async () => {
  const presence = createPresence();
  presence.ingest('1', Array.from({ length: 30 }, (_, i) => seenLine(`${100 + i}`, `Gone${i}`, 'exit', 1000 + i)));
  const t = setup({ presence });
  assert.equal(offlineNames(t.doc).length, LIST_CAP - 2);
  assert.equal(offlineNames(t.doc)[0], 'Gone29', 'newest first');
  await t.teardown();
});

test('online users are never hidden by the cap, and leave no room for offline ones', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('99', 'Gone', 'exit', 100)]);
  const extra = Array.from({ length: LIST_CAP }, (_, i) => row(`${200 + i}`, `On${i}`, '1')).join('');
  const t = setup({ presence, prepare: (doc) => doc.getElementById('room_1').insertAdjacentHTML('beforeend', extra) });
  assert.equal(onlineNames(t.doc).length, LIST_CAP + 2);
  assert.deepEqual(offlineNames(t.doc), []);
  assert.equal(t.roomEl('1').querySelector('.tdf-rail-section-head'), null);
  await t.teardown();
});

test('live lines move users between the sections without a reload', async () => {
  const presence = createPresence();
  const t = setup({ presence });
  // Alice leaves: her exit line arrives and the engine drops her row.
  presence.ingest('1', [seenLine('12', 'Alice', 'exit', 500)]);
  t.doc.getElementById('userlist_121').remove();
  await nextFrame();
  assert.deepEqual(onlineNames(t.doc), ['me']);
  assert.deepEqual(offlineNames(t.doc), ['Alice']);
  // She comes back: her entry line, then her row.
  presence.ingest('1', [seenLine('12', 'Alice', 'entry', 600)]);
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('12', 'Alice', '1'));
  await nextFrame();
  assert.deepEqual(onlineNames(t.doc), ['me', 'Alice']);
  assert.deepEqual(offlineNames(t.doc), []);
  await t.teardown();
});

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

/**
 * A presence store whose server clock reads `serverSeconds`, so last-seen tooltips are fixed.
 * @param {ReturnType<typeof createPresence>} presence
 * @param {number} serverSeconds
 */
const atServerTime = (presence, serverSeconds) => {
  presence.setServerOffset(serverSeconds * 1000 - Date.now());
  return presence;
};

/**
 * Open a ghosted row's menu, by a left (or right) click on its name.
 * @returns {{ event: MouseEvent, menu: HTMLElement, note: string | undefined, profile: HTMLButtonElement | null }}
 */
const ghostMenu = (t, uuID, { right = false, x = 600, y = 100 } = {}) => {
  const event = new t.win.MouseEvent(right ? 'contextmenu' : 'click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  t.doc.querySelector(`.tdf-rail-offline[data-uuid="${uuID}"] .tdf-rail-user-name`).dispatchEvent(event);
  const menu = t.doc.querySelector('.tdf-rail-menu');
  return {
    event,
    menu,
    note: menu.querySelector('.tdf-rail-menu-note')?.textContent,
    profile: menu.querySelector('.tdf-rail-menu-item[data-action="profile"]'),
  };
};

test("a ghosted row whose line has no usable time has no tooltip, and its menu reads 'Last seen time unknown'", async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 0)]);
  const t = setup({ presence, flags: { profileOn: 0 } });
  const ghost = t.doc.querySelector('.tdf-rail-offline[data-uuid="77"]');
  assert.equal(ghost.title, '', "no 'User offline' fallback");
  assert.ok(!ghost.classList.contains('tdf-rail-inert'));
  assert.equal(ghostMenu(t, '77').note, 'Last seen time unknown');
  await t.teardown();
});

test('last-seen is aged on the server clock, not the device clock', async () => {
  const presence = createPresence();
  const deviceNow = Math.floor(Date.now() / 1000);
  // The server runs a day behind the device: a line sent one hour ago on its clock is an hour old.
  presence.setServerOffset(-DAY_S * 1000);
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', deviceNow - DAY_S - 2 * HOUR_S)]);
  const t = setup({ presence });
  assert.equal(t.doc.querySelector('.tdf-rail-offline[data-uuid="77"]').title, 'Last seen 2 hours ago');
  await t.teardown();
});

test('a ghosted row re-ages its last-seen tooltip on hover and focus, without a re-render', async () => {
  const presence = atServerTime(createPresence(), 100 + 30 * 60);
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence });
  const ghost = t.doc.querySelector('.tdf-rail-offline[data-uuid="77"]');
  assert.equal(ghost.title, 'Last seen < 1 hour ago');
  atServerTime(presence, 100 + 5 * HOUR_S);
  assert.equal(ghost.title, 'Last seen < 1 hour ago', 'a clock change alone does not re-render');
  ghost.dispatchEvent(new t.win.MouseEvent('mouseenter'));
  assert.equal(ghost.title, 'Last seen 5 hours ago');
  atServerTime(presence, 100 + 3 * DAY_S);
  ghost.dispatchEvent(new t.win.FocusEvent('focus'));
  assert.equal(ghost.title, 'Last seen 3 days ago');
  assert.equal(t.doc.querySelector('.tdf-rail-offline[data-uuid="77"]'), ghost, 'the same row');
  await t.teardown();
});

test("a ghosted row opens a menu of its 'Last seen …' line and View Profile, by the forum id from its online row", async () => {
  const presence = atServerTime(createPresence(), 500 + 3 * HOUR_S);
  const t = setup({ presence }); // profileRef 2
  presence.ingest('1', [seenLine('12', 'Alice', 'exit', 500)]);
  t.doc.getElementById('userlist_121').remove();
  await nextFrame();
  const ghost = t.doc.querySelector('.tdf-rail-offline[data-uuid="12"]');
  assert.equal(ghost.title, 'Last seen 3 hours ago');
  for (const right of [false, true]) {
    const { event, menu, note, profile } = ghostMenu(t, '12', { right });
    assert.equal(event.defaultPrevented, true);
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelector('.tdf-rail-menu-title').textContent, 'Alice');
    assert.equal(note, 'Last seen 3 hours ago');
    assert.equal(menu.querySelectorAll('.tdf-rail-menu-note').length, 1);
    assert.deepEqual(t.items(), ['profile'], 'exactly one item');
    assert.equal(profile.textContent, 'View Profile');
    assert.equal(profile.disabled, false);
    assert.deepEqual(t.calls, [], 'opening the menu calls nothing');
    t.doc.body.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  const { menu, profile } = ghostMenu(t, '12');
  profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '912', 'Alice']]);
  assert.equal(menu.hidden, true, 'the item closes the menu');
  await t.teardown();
});

test('the ghosted menu opens leftward from the pointer, like the name menu', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence });
  const { menu } = ghostMenu(t, '77', { x: 600, y: 100 });
  const width = menu.getBoundingClientRect().width;
  assert.equal(menu.style.left, `${Math.max(8, 600 - width)}px`);
  assert.equal(menu.style.top, '100px');
  await t.teardown();
});

test("a ghosted row with no profile id opens the menu with View Profile disabled; its tooltip reads 'Last seen …'", async () => {
  const presence = atServerTime(createPresence(), 100 + 2 * DAY_S);
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence }); // profileRef 2, and Stranger was never online, this load or before
  const ghost = t.doc.querySelector('.tdf-rail-offline[data-uuid="77"]');
  assert.ok(!ghost.classList.contains('tdf-rail-inert'));
  assert.equal(ghost.title, 'Last seen 2 days ago');
  const { menu, note, profile } = ghostMenu(t, '77');
  assert.equal(menu.hidden, false);
  assert.equal(note, 'Last seen 2 days ago');
  assert.equal(profile.disabled, true);
  profile.click();
  assert.deepEqual(t.calls, []);
  await t.teardown();
});

/**
 * A stand-in for core/seenUsers.js: `saved` is what an earlier page load stored. Like the real
 * store, a subscriber added after the load finished is told once, on a microtask, unless it
 * unsubscribes first; one added before is told when the load finishes.
 * @param {Record<string, { userID: string, rawName: string }>} saved
 */
const fakeSeen = (saved = {}) => {
  const listeners = new Set();
  let loaded = false;
  const store = {
    saved: { ...saved },
    remembered: [],
    /** How many late subscribers were told on a microtask that the load had already finished. */
    lateNotified: 0,
    get: (uuID) => store.saved[uuID],
    remember: (user) => store.remembered.push(user),
    subscribe(fn) {
      listeners.add(fn);
      if (loaded) {
        queueMicrotask(() => {
          if (!listeners.has(fn)) return;
          store.lateNotified++;
          fn();
        });
      }
      return () => listeners.delete(fn);
    },
    /** Finish the load with `records`, telling subscribers. */
    load(records) {
      Object.assign(store.saved, records);
      loaded = true;
      for (const fn of listeners) fn();
    },
    listeners,
  };
  return store;
};

test('after a reload a ghosted row gets the forum id saved by an earlier load, and View Profile opens it', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const seen = fakeSeen({ 77: { userID: '4077', rawName: 'Stranger' } });
  const t = setup({ presence, flags: { __tdfChat2Seen: seen } });
  const { profile } = ghostMenu(t, '77');
  assert.equal(profile.disabled, false);
  profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '4077', 'Stranger']]);
  await t.teardown();
});

test('the saved users loading after the first render re-renders the ghosted rows', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const seen = fakeSeen();
  const t = setup({ presence, flags: { __tdfChat2Seen: seen } });
  assert.equal(ghostMenu(t, '77').profile.disabled, true);
  seen.load({ 77: { userID: '4077', rawName: 'Stranger' } });
  assert.equal(ghostMenu(t, '77').profile.disabled, false);
  await t.teardown();
  assert.equal(seen.listeners.size, 0, 'unsubscribed on teardown');
});

test('saved users published after the first render are subscribed on the next render, and their load re-renders', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence }); // the bootstrap has not published the store yet
  assert.equal(ghostMenu(t, '77').profile.disabled, true);
  const seen = fakeSeen();
  t.win.__tdfChat2Seen = seen;
  assert.equal(seen.listeners.size, 0, 'nothing reads the store until a render');
  presence.ingest('1', [seenLine('78', 'Other', 'exit', 50)]);
  assert.equal(seen.listeners.size, 1, 'the next render subscribes');
  seen.load({ 77: { userID: '4077', rawName: 'Stranger' } });
  const { profile } = ghostMenu(t, '77');
  assert.equal(profile.disabled, false);
  profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '4077', 'Stranger']]);
  await t.teardown();
  assert.equal(seen.listeners.size, 0, 'unsubscribed on teardown');
});

test('saved users published after the first render, their load already finished, re-render on the late-subscribe notice', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence });
  assert.equal(ghostMenu(t, '77').profile.disabled, true);
  const seen = fakeSeen();
  seen.load({ 77: { userID: '4077', rawName: 'Stranger' } });
  t.win.__tdfChat2Seen = seen;
  presence.ingest('1', [seenLine('78', 'Other', 'exit', 50)]);
  await Promise.resolve();
  assert.equal(seen.lateNotified, 1, 'the late subscriber was told the load had finished');
  const { profile } = ghostMenu(t, '77');
  assert.equal(profile.disabled, false);
  profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '4077', 'Stranger']]);
  await t.teardown();
  assert.equal(seen.listeners.size, 0, 'unsubscribed on teardown');
});

test('every online row is remembered in the saved users, with its forum id and encoded name', async () => {
  const seen = fakeSeen();
  const t = setup({ presence: createPresence(), flags: { __tdfChat2Seen: seen } });
  const byId = Object.fromEntries(seen.remembered.map((u) => [u.uuID, u]));
  assert.deepEqual(byId['12'], { uuID: '12', userID: '912', rawName: 'Alice' });
  assert.deepEqual(byId['13'], { uuID: '13', userID: '913', rawName: 'Bob' });
  assert.deepEqual(byId['7'], { uuID: '7', userID: '97', rawName: 'me' });
  await t.teardown();
});

test('an online row this load wins over a saved earlier record', async () => {
  const presence = createPresence();
  const seen = fakeSeen({ 12: { userID: 'stale', rawName: 'Alice' } });
  const t = setup({ presence, flags: { __tdfChat2Seen: seen } });
  presence.ingest('1', [seenLine('12', 'Alice', 'exit', 500)]);
  t.doc.getElementById('userlist_121').remove();
  await nextFrame();
  ghostMenu(t, '12').profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '912', 'Alice']]);
  await t.teardown();
});

test('a user online in another listed room is not ghosted in this one', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('13', 'Bob', 'exit', 200), seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence }); // Bob is online in room 2
  assert.deepEqual(offlineNames(t.doc), ['Stranger']);
  await t.teardown();
});

test("profiles off, or an unsupported profileRef, disable View Profile; the row still reads 'Last seen …'", async () => {
  for (const flags of [{ profileOn: 0 }, { profileRef: 9 }]) {
    const presence = atServerTime(createPresence(), 500 + 59 * 60);
    presence.ingest('1', [seenLine('12', 'Alice', 'exit', 500)]);
    const t = setup({ presence, flags });
    t.doc.getElementById('userlist_121').remove();
    await nextFrame();
    const ghost = t.doc.querySelector('.tdf-rail-offline[data-uuid="12"]');
    assert.ok(!ghost.classList.contains('tdf-rail-inert'));
    assert.equal(ghost.title, 'Last seen < 1 hour ago');
    const { note, profile } = ghostMenu(t, '12');
    assert.equal(note, 'Last seen < 1 hour ago');
    assert.equal(profile.disabled, true);
    profile.click();
    assert.deepEqual(t.calls, []);
    await t.teardown();
  }
});

test('under profileRef 2 a never-online ghosted row opens the forum profile by name (TDF-0078)', async () => {
  const presence = createPresence();
  presence.ingest('1', [{ ...seenLine('77', 'Dan B', 'exit', 100), rawName: 'Dan%20B' }]);
  const t = setup({ presence, flags: { profileUrl: 'https://example.test/forum/memberlist.php?mode=viewprofile&u=' } });
  const { profile } = ghostMenu(t, '77');
  assert.equal(profile.disabled, false);
  profile.click();
  assert.deepEqual(t.calls, [['newWin', 'https://example.test/forum/memberlist.php?mode=viewprofile&un=Dan+B']]);
  await t.teardown();
});

test("under profileRef 1 a never-online ghosted row passes the line's encoded name", async () => {
  const presence = createPresence();
  presence.ingest('1', [{ ...seenLine('77', 'Dan B', 'exit', 100), rawName: 'Dan%20B' }]);
  const t = setup({ presence, flags: { profileRef: 1 } });
  ghostMenu(t, '77').profile.click();
  assert.deepEqual(t.calls, [['viewProfile', 'Dan%20B', 'Dan%20B']]);
  await t.teardown();
});

test('under profileRef 0 a never-online ghosted row opens the profile by uuID', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence, flags: { profileRef: 0 } });
  ghostMenu(t, '77').profile.click();
  assert.deepEqual(t.calls, [['viewProfile', '77', 'Stranger']]);
  await t.teardown();
});

test('online rows keep the name menu beside a recently online section', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence });
  const menu = t.nameMenu('12');
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector('.tdf-rail-menu-title').textContent, 'Alice');
  await t.teardown();
});

test('the ghosted rows are styled faded, behind a thin rule and a muted header', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  assert.match(css, /\.tdf-rail-offline \{\s*opacity: 0\.5;/);
  assert.match(css, /\.tdf-rail-rule \{[^}]*border-top: 1px solid var\(--tdf-rail-chip-border\)/);
  assert.match(css, /\.tdf-rail-rule \{[^}]*margin: 36px 8px 2px;/); // TDF-0059: 30px above the rule
  assert.match(css, /\.tdf-rail-section-head \{[^}]*color: var\(--tdf-muted\)/);
  // TDF-0075: every ghosted row opens a menu, so none is styled inert; the menu's note is muted.
  assert.doesNotMatch(css, /tdf-rail-inert/);
  assert.match(css, /\.tdf-rail-menu-note \{[^}]*color: var\(--tdf-muted\)/);
});

test('a ghosted row whose profile call fails is reported in the rail with its cause', async () => {
  const presence = createPresence();
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  const t = setup({ presence, flags: { profileRef: 0 } });
  delete t.win.viewProfile;
  ghostMenu(t, '77').profile.click();
  assert.ok(t.errors().some((e) => e.includes('the chat engine has no viewProfile()')), t.errors().join(' | '));
  await t.teardown();
});

test('a re-render on a presence change that throws is reported in the rail', async () => {
  const presence = createPresence();
  const t = setup({ presence });
  Object.defineProperty(t.win, 'roomID', {
    configurable: true,
    get() {
      throw new Error('room unreadable');
    },
  });
  presence.ingest('1', [seenLine('77', 'Stranger', 'exit', 100)]);
  assert.ok(t.errors().some((e) => e.includes('room unreadable')), t.errors().join(' | '));
  Object.defineProperty(t.win, 'roomID', { configurable: true, value: 1, writable: true });
  await t.teardown();
});

// Last in the file: it writes the page's own store, shared by every test above in this process.
test('without an injected store the rail reads the page presence store the engine hook writes', async () => {
  pagePresence.ingest('3', [seenLine('88', 'Paged', 'exit', 100)]);
  const t = setup({ flags: { roomID: 3 } });
  assert.deepEqual(offlineNames(t.doc, '3'), ['Paged']);
  await t.teardown();
});

// Narrow layout (TDF-0068).

/** A matchMedia whose NARROW_QUERY answer the test sets, telling its change listeners. */
function stubNarrow(win, matches = false) {
  const listeners = new Set();
  const query = {
    matches,
    media: NARROW_QUERY,
    addEventListener: (type, fn) => type === 'change' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'change' && listeners.delete(fn),
  };
  const base = win.matchMedia.bind(win);
  win.matchMedia = (q) => (q === NARROW_QUERY ? query : base(q));
  return {
    listeners,
    set(on) {
      query.matches = on;
      for (const fn of [...listeners]) fn({ matches: on, media: NARROW_QUERY });
    },
  };
}

/** setup() with the narrow query stubbed before the rail mounts. */
function narrowSetup({ narrow = true, visualViewport = null, ...rest } = {}) {
  let mq;
  const t = setup({
    ...rest,
    prepare: (doc) => {
      const win = doc.defaultView;
      mq = stubNarrow(win, narrow);
      if (visualViewport) Object.defineProperty(win, 'visualViewport', { value: visualViewport, configurable: true });
      rest.prepare?.(doc);
    },
  });
  const html = t.doc.documentElement;
  const rail = t.doc.getElementById('tdf-rail');
  const opener = t.doc.getElementById('tdf-rail-open');
  const scrim = t.doc.getElementById('tdf-rail-scrim');
  const drawerOpen = () => rail.classList.contains('tdf-drawer-open');
  const esc = () => t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { ...t, mq, html, rail, opener, scrim, drawerOpen, esc };
}

const testPanel = (id = 'narrow-test') =>
  registerRailPanel({ id, title: 'Narrow test', icon: 'N', render: (body) => body.append('panel body') });

test('the breakpoint is NARROW_MAX, 640px, and the tdf-narrow class follows the query live', async () => {
  assert.equal(NARROW_MAX, 640);
  assert.equal(NARROW_QUERY, '(max-width: 640px)');
  const t = narrowSetup({ narrow: false });
  assert.equal(t.html.classList.contains('tdf-narrow'), false);
  t.mq.set(true);
  assert.equal(t.html.classList.contains('tdf-narrow'), true);
  t.mq.set(false);
  assert.equal(t.html.classList.contains('tdf-narrow'), false);
  await t.teardown();
  assert.equal(t.mq.listeners.size, 0, 'the change listener is removed on teardown');
});

test('crossing the breakpoint either way closes an open flyout and the drawer', async () => {
  const off = testPanel();
  const t = narrowSetup({ narrow: true });
  t.opener.click();
  t.icon('narrow-test').click();
  assert.ok(t.isOpen() && t.drawerOpen());
  t.mq.set(false);
  assert.equal(t.isOpen(), false, 'the flyout closed');
  assert.equal(t.drawerOpen(), false, 'the drawer closed');
  t.icon('narrow-test').click();
  assert.ok(t.isOpen());
  t.mq.set(true);
  assert.equal(t.isOpen(), false, 'a desktop flyout closes on entering narrow');
  off();
  await t.teardown();
});

test('the open button toggles the drawer; a scrim tap and Esc close it, and the tap is swallowed', async () => {
  const t = narrowSetup();
  assert.equal(t.opener.parentElement, t.doc.body);
  assert.equal(t.opener.getAttribute('aria-controls'), 'tdf-rail');
  assert.equal(t.opener.getAttribute('aria-expanded'), 'false');
  t.opener.click();
  assert.ok(t.drawerOpen());
  assert.ok(t.scrim.classList.contains('tdf-open'));
  assert.equal(t.opener.getAttribute('aria-expanded'), 'true');
  let reached = false;
  t.doc.body.addEventListener('click', () => (reached = true));
  const click = new t.win.MouseEvent('click', { bubbles: true, cancelable: true });
  t.scrim.dispatchEvent(click);
  assert.equal(t.drawerOpen(), false);
  assert.equal(t.scrim.classList.contains('tdf-open'), false);
  assert.ok(click.defaultPrevented && !reached, 'the scrim tap reaches nothing under it');
  t.opener.click();
  t.esc();
  assert.equal(t.drawerOpen(), false, 'Esc closes the drawer');
  t.opener.click();
  t.opener.click();
  assert.equal(t.drawerOpen(), false, 'the button toggles');
  await t.teardown();
  assert.equal(t.doc.getElementById('tdf-rail-open'), null, 'the button is removed on teardown');
  assert.equal(t.doc.getElementById('tdf-rail-scrim'), null, 'the scrim is removed on teardown');
  assert.equal(t.html.classList.contains('tdf-narrow'), false, 'the class is removed on teardown');
});

test('Esc closes the flyout first, back to the open drawer, then the drawer', async () => {
  const off = testPanel();
  const t = narrowSetup();
  t.opener.click();
  t.icon('narrow-test').click();
  t.esc();
  assert.equal(t.isOpen(), false);
  assert.ok(t.drawerOpen(), 'closing the flyout returns to the open drawer');
  t.esc();
  assert.equal(t.drawerOpen(), false);
  off();
  await t.teardown();
});

test('the flyout close button closes it, back to the drawer, and survives a panel switch', async () => {
  const offA = testPanel('narrow-a');
  const offB = testPanel('narrow-b');
  const t = narrowSetup();
  t.opener.click();
  t.icon('narrow-a').click();
  const closeBtn = t.flyout().querySelector('.tdf-rail-flyout-close');
  assert.ok(closeBtn, 'the flyout has a close button');
  assert.equal(closeBtn.getAttribute('aria-label'), 'Close');
  assert.ok(t.flyout().querySelector('.tdf-rail-body'), 'the body sits beside it');
  t.icon('narrow-b').click();
  assert.equal(t.flyout().querySelector('.tdf-rail-flyout-close'), closeBtn, 'the same button after a switch');
  assert.equal(t.flyout().querySelectorAll('.tdf-rail-body').length, 1);
  closeBtn.click();
  assert.equal(t.isOpen(), false);
  assert.ok(t.drawerOpen(), 'the drawer stays open');
  offA();
  offB();
  await t.teardown();
});

test('a flyout opened by its handle under narrow opens the drawer it lives in', async () => {
  const handle = testPanel();
  const t = narrowSetup();
  handle.open();
  assert.ok(t.isOpen() && t.drawerOpen());
  handle();
  await t.teardown();
});

test('under narrow the copied rect is cleared, and restored on leaving', async () => {
  const rect = { top: 80, left: 900, width: 236, height: 500 };
  const t = narrowSetup({
    narrow: false,
    prepare: (doc) => (doc.getElementById('userContainer').getBoundingClientRect = () => rect),
  });
  const style = () => {
    const s = t.rail.style;
    return [s.top, s.left, s.width, s.height];
  };
  assert.deepEqual(style(), ['80px', '900px', '236px', '500px']);
  t.mq.set(true);
  assert.deepEqual(style(), ['', '', '', '']);
  t.win.dispatchEvent(new t.win.Event('resize'));
  await nextFrame();
  assert.deepEqual(style(), ['', '', '', ''], 'a resize under narrow writes no rect');
  t.mq.set(false);
  assert.deepEqual(style(), ['80px', '900px', '236px', '500px']);
  await t.teardown();
});

test("the open button shows the current room's online count and follows the list", async () => {
  const t = narrowSetup();
  const count = t.opener.querySelector('.tdf-rail-open-count');
  assert.equal(count.hidden, false);
  assert.equal(count.textContent, '2');
  assert.equal(t.opener.getAttribute('aria-label'), 'Users and rooms, 2 online');
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('20', 'Carol', '1'));
  t.doc.getElementById('userCount_1').textContent = '3';
  await nextFrame();
  assert.equal(count.textContent, '3');
  await t.teardown();
});

test('the open button hides its count when the current room is not in the list', async () => {
  const t = narrowSetup({ flags: { roomID: 99 } });
  const count = t.opener.querySelector('.tdf-rail-open-count');
  assert.equal(count.hidden, true);
  assert.equal(count.textContent, '');
  assert.equal(t.opener.getAttribute('aria-label'), 'Users and rooms');
  await t.teardown();
});

/**
 * mountRail itself under the narrow query, for the API startRail keeps to itself (fail). The
 * narrow wrapper (narrowSetup) goes through startRail, which calls fail only while mounting.
 */
function narrowMount(rect = { top: 80, left: 900, width: 236, height: 500 }) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = '<div id="userContainer"></div>';
  const target = doc.getElementById('userContainer');
  target.getBoundingClientRect = () => rect;
  stubNarrow(win, true);
  const rail = mountRail({ doc, win, target, raise: 30, shell: stubShell() });
  const root = doc.getElementById('tdf-rail');
  const opener = doc.getElementById('tdf-rail-open');
  const scrim = doc.getElementById('tdf-rail-scrim');
  const drawerOpen = () => root.classList.contains('tdf-drawer-open');
  return { win, doc, rail, root, opener, scrim, drawerOpen };
}

test('a rail that fails under narrow closes its drawer and scrim, and nothing reopens them', () => {
  const off = testPanel();
  const t = narrowMount();
  t.opener.click();
  assert.ok(t.drawerOpen() && t.scrim.classList.contains('tdf-open'));
  t.rail.fail(new Error('x'));
  assert.equal(t.drawerOpen(), false, 'the drawer closed');
  assert.equal(t.scrim.classList.contains('tdf-open'), false, 'the scrim closed');
  assert.equal(t.opener.getAttribute('aria-expanded'), 'false');
  off.open();
  assert.equal(t.drawerOpen(), false, 'show() after fail does not open the drawer');
  assert.equal(t.scrim.classList.contains('tdf-open'), false);
  t.opener.click();
  assert.equal(t.drawerOpen(), false, 'nor does the open button');
  off();
  t.rail.destroy();
});

test('a failed rail under narrow falls back to the copied rect, without the raise, and has no open button', () => {
  const t = narrowMount();
  const style = () => {
    const s = t.root.style;
    return [s.top, s.left, s.width, s.height];
  };
  assert.deepEqual(style(), ['', '', '', ''], 'a working narrow rail copies no rect');
  t.rail.fail(new Error('x'));
  assert.ok(t.root.classList.contains('tdf-rail-failed'));
  assert.deepEqual(style(), ['80px', '900px', '236px', '500px'], "it covers #userContainer's box again");
  // The open button shows only beside a working rail (rail.css); a press does nothing.
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  assert.match(css, /#tdf-rail-open \{\s*display: none;\s*\}/);
  assert.match(css, /:root\.tdf-narrow body:has\(#tdf-rail:not\(\.tdf-rail-failed\)\) #tdf-rail-open \{[^}]*display: inline-flex/);
  t.opener.click();
  assert.equal(t.drawerOpen(), false);
  assert.equal(t.opener.getAttribute('aria-expanded'), 'false');
  t.rail.destroy();
});

test('the visual viewport writes --tdf-vvh and --tdf-vvtop while narrow, and they go on leaving', async () => {
  const listeners = new Map();
  const vv = {
    height: 400,
    offsetTop: 0,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => listeners.get(type) === fn && listeners.delete(type),
  };
  const t = narrowSetup({ visualViewport: vv });
  const prop = (name) => t.html.style.getPropertyValue(name);
  assert.equal(prop('--tdf-vvh'), '400px');
  assert.equal(prop('--tdf-vvtop'), '0px');
  vv.height = 250;
  vv.offsetTop = 30;
  listeners.get('resize')();
  assert.equal(prop('--tdf-vvh'), '250px');
  assert.equal(prop('--tdf-vvtop'), '30px');
  t.mq.set(false);
  assert.equal(prop('--tdf-vvh'), '');
  assert.equal(listeners.size, 0, 'the viewport listeners are removed on leaving narrow');
  t.mq.set(true);
  assert.equal(listeners.size, 2);
  await t.teardown();
  assert.equal(listeners.size, 0, 'and on teardown');
  assert.equal(prop('--tdf-vvh'), '');
});

test('a viewport meta is injected only when the page has none; an existing one is kept as it is', () => {
  const bare = new Window().document;
  ensureViewport(bare);
  const metas = bare.querySelectorAll('meta[name="viewport"]');
  assert.equal(metas.length, 1);
  assert.equal(metas[0].getAttribute('content'), 'width=device-width, initial-scale=1');
  ensureViewport(bare);
  assert.equal(bare.querySelectorAll('meta[name="viewport"]').length, 1, 'idempotent');

  const engine = new Window().document;
  engine.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes">';
  ensureViewport(engine);
  const kept = engine.querySelectorAll('meta[name="viewport"]');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].getAttribute('content'), 'width=device-width, initial-scale=1, user-scalable=yes');
});

test('startRail injects a viewport meta when the page has none', async () => {
  const t = setup();
  assert.equal(t.doc.querySelectorAll('meta[name="viewport"]').length, 1);
  await t.teardown();
});

test('narrow CSS keys on :root.tdf-narrow and never on a width media query', () => {
  const files = [
    './rail.css',
    '../../core/theme.css',
    '../composer/composer.css',
    '../gallery/gallery.css',
    '../options/options.css',
    '../profile/profile.css',
  ];
  for (const file of files) {
    const css = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /@media[^{]*(max|min)-width/, `${file} has no width media query`);
  }
  const rail = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  assert.match(rail, /:root\.tdf-narrow #tdf-rail:not\(\.tdf-rail-failed\) \{[^}]*width: min\(300px, 85vw\)/);
  assert.match(rail, /:root\.tdf-narrow #tdf-rail\.tdf-drawer-open:not\(\.tdf-rail-failed\) \{[^}]*transform: none/);
  assert.match(rail, /:root\.tdf-narrow #tdf-rail:not\(\.tdf-rail-failed\) \.tdf-rail-flyout \{[^}]*position: fixed;[^}]*inset: 0/);
  const theme = readFileSync(new URL('../../core/theme.css', import.meta.url), 'utf8');
  assert.match(theme, /:root\.tdf-narrow #mainContainer \{[^}]*height: var\(--tdf-vvh, 100dvh\) !important/);
  assert.match(theme, /:root\.tdf-narrow #chatContainer \{[^}]*width: calc\(100% - 10px\) !important/);
  assert.match(theme, /#tdf-chat \.tdf-list \{[^}]*padding: 4px 0 16px/, 'the TDF-0042 bottom padding is kept');
  const gallery = readFileSync(new URL('../gallery/gallery.css', import.meta.url), 'utf8');
  assert.match(gallery, /:root\.tdf-narrow\[data-tdf-theme\] #tdf-rail \.tdf-gallery-grid \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
});

test('narrow touch targets are at least 44px: icon buttons, rows, Logout, menu items, the open and close buttons', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  assert.match(css, /:root\.tdf-narrow #tdf-rail \.tdf-rail-icon-btn \{[^}]*min-width: 44px;[^}]*height: 44px/);
  const rows = /:root\.tdf-narrow #tdf-rail :is\(([^)]*)\) \{([^}]*)\}/.exec(css);
  assert.ok(rows);
  assert.deepEqual(rows[1].split(',').map((s) => s.trim()),
    ['.tdf-rail-room-chip', '.tdf-rail-join', '.tdf-rail-logout', '.tdf-rail-user', '.tdf-rail-menu-item']);
  assert.match(rows[2], /min-height: 44px/);
  assert.match(css, /#tdf-rail-open \{[^}]*min-width: 44px;[^}]*height: 44px/);
  assert.match(css, /\.tdf-rail-flyout-close \{[^}]*width: 44px;[^}]*height: 44px/);
  assert.match(css, /#tdf-rail \.tdf-rail-rule \{[^}]*margin: 36px 8px 2px/, 'the TDF-0059 spacing is unchanged');
});
