import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { listPanels, registerRailPanel, registerUserMenuAction } from './api.js';
import { ICONS } from './icons.js';
import { startRail } from './rail.js';
import { createUserStore } from './userList.js';

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

function setup({ host = true, extra = '', flags = {}, shell = stubShell(), prepare = (_doc) => {} } = {}) {
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
  for (const fn of ['clearWhisper', 'blockUsers', 'viewProfile', 'createPChatDiv', 'showInfoBox', 'changeRooms']) {
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
  assert.equal(startRail({ doc, win, css: '/* rail */', shell }), true);
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
  assert.equal(startRail({ doc: win.document, win, css: '', shell: stubShell() }), false);
  assert.equal(win.document.getElementById('tdf-rail'), null);
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
  const t = setup({
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
