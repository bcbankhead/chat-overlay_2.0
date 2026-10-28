import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { listPanels, registerRailPanel, registerUserMenuAction } from './api.js';
import { ICONS } from './icons.js';
import { startRail } from './rail.js';
import { createUserStore } from './userList.js';

const row = (uuID, uUser, roomID) =>
  `<div id="userlist_${uuID}${roomID}" class="userlist"><div><span style='float:left;'><img id='avatar_${uuID}' src='avatars/a.gif'>&nbsp;<span onclick='userPanel("me","${uUser}","${uuID}","${roomID}","9${uuID}","a.gif","1","1.1.1.${uuID}")'>${uUser}</span><span id='ustatusID_${uuID}'></span></span></div></div>`;
const room = (roomID, name, rows) =>
  `<div id="room_${roomID}"><div class="roomheader"> <span style="float:left;"><img>&nbsp;${name}&nbsp;</span> <span class="usercount">[<span id="userCount_${roomID}">${rows.length}</span>]</span> </div>${rows.join('')}</div>`;

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

function setup({ host = true, extra = '', flags = {}, prepare = (_doc) => {} } = {}) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    `${host ? '<div id="tdf-chat" data-theme="light"></div>' : ''}<input id="whisperID" value="">${extra}` +
    `<div id="userContainer">${room('1', 'Lobby', [row('7', 'me', '1'), row('12', 'Alice', '1')])}${room('2', 'Back', [row('13', 'Bob', '2')])}${room('3', 'Den', [])}</div>`;
  const calls = [];
  Object.assign(win, {
    uID: 7, userName: 'me', roomID: 1, privateOn: 1, whisperOn: 1, profileOn: 1, profileRef: 2, groupPChat: 1,
    eCredits: 0, share: 0, admin: 0, moderator: 0, roomOwner: 0, intelliBotName: 'Intelli-bot',
    userStatusMes: ['select', 'Here', 'BRB', 'Away'],
    ...flags,
  });
  for (const fn of ['whisperUser', 'clearWhisper', 'blockUsers', 'viewProfile', 'createPChatDiv', 'showInfoBox', 'sendStatus', 'changeRooms']) {
    win[fn] = (...args) => calls.push([fn, ...args]);
  }
  win.whisperUser = (name) => {
    calls.push(['whisperUser', name]);
    doc.getElementById('whisperID').value = decodeURI(name);
  };
  prepare(doc);
  assert.equal(startRail({ doc, win, css: '/* rail */' }), true);
  // Removing #tdf-chat is the rail's teardown path (a failed start); tests use it to clean up.
  const teardown = async () => {
    doc.getElementById('tdf-chat')?.remove();
    await nextFrame();
  };
  const errors = () => [...doc.querySelectorAll('.tdf-rail-error div')].map((d) => d.textContent);
  const users = () => [...doc.querySelectorAll('.tdf-rail-user-name span:first-child')].map((s) => s.textContent);
  const chips = () => [...doc.querySelectorAll('.tdf-rail-chip[data-panel]')].map((b) => b.dataset.panel);
  const chip = (id) => doc.querySelector(`.tdf-rail-chip[data-panel="${id}"]`);
  const flyout = () => doc.querySelector('.tdf-rail-flyout');
  return { win, doc, calls, errors, teardown, users, chips, chip, flyout };
}

test('the docked list shows the current room with no click, inside #tdf-chat', async () => {
  const t = setup();
  assert.equal(t.doc.getElementById('tdf-rail').parentElement.id, 'tdf-chat');
  assert.deepEqual(t.users(), ['me', 'Alice']);
  assert.equal(t.doc.querySelector('.tdf-rail-room-name').textContent, 'Lobby (2)');
  assert.equal(t.flyout().hidden, true);
  assert.deepEqual(t.chips(), [], 'the user list is not a registered panel');
  await t.teardown();
});

test('the column copies #userContainer\'s rect, and follows it on resize and scroll', async () => {
  let rect = { top: 40, left: 900, width: 236, height: 500 };
  const t = setup({
    prepare: (doc) => {
      doc.getElementById('userContainer').getBoundingClientRect = () => rect;
    },
  });
  const style = () => {
    const s = t.doc.getElementById('tdf-rail').style;
    return [s.top, s.left, s.width, s.height];
  };
  assert.deepEqual(style(), ['40px', '900px', '236px', '500px']);
  rect = { top: 40, left: 700, width: 236, height: 300 };
  t.win.dispatchEvent(new t.win.Event('resize'));
  assert.deepEqual(style(), ['40px', '700px', '236px', '300px']);
  rect = { top: 10, left: 700, width: 236, height: 300 };
  t.doc.dispatchEvent(new t.win.Event('scroll'));
  assert.deepEqual(style(), ['10px', '700px', '236px', '300px']);
  await t.teardown();
  rect = { top: 0, left: 0, width: 1, height: 1 };
  t.win.dispatchEvent(new t.win.Event('resize'));
});

test('the engine panel is hidden with visibility, not display, and only while the rail works', () => {
  const css = readFileSync(new URL('./rail.css', import.meta.url), 'utf8');
  const rule = /body:has\(#tdf-rail:not\(\.tdf-rail-failed\)\) #userContainer \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the hiding rule is keyed on a working rail');
  assert.match(rule[1], /visibility: hidden !important/);
  assert.doesNotMatch(css, /display:\s*none\s*!important/);
});

test('whisper from the accordion calls the engine and then offers Clear Whisper', async () => {
  const t = setup();
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  const actions = [...t.doc.querySelectorAll('.tdf-rail-action')].map((b) => b.dataset.action);
  assert.deepEqual(actions, ['private', 'whisper', 'profile', 'block', 'unblock', 'report']);
  t.doc.querySelector('[data-action="whisper"]').click();
  assert.deepEqual(t.calls, [['whisperUser', 'Alice']]);
  assert.equal(t.doc.querySelector('.tdf-rail-menu'), null, 'the accordion closes after an action');
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  assert.ok(t.doc.querySelector('[data-action="clear-whisper"]'));
  await t.teardown();
});

test('the status picker sits in the header and calls sendStatus(index)', async () => {
  const t = setup();
  const status = t.doc.querySelector('.tdf-rail-header .tdf-rail-status');
  assert.equal(status.value, '1');
  status.value = '3';
  status.dispatchEvent(new t.win.Event('change'));
  assert.deepEqual(t.calls, [['sendStatus', 3]]);
  await t.teardown();
});

test('other rooms start collapsed, expand to one chip per other room, and switch with changeRooms', async () => {
  const t = setup();
  const toggle = t.doc.querySelector('.tdf-rail-rooms-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.textContent, 'Other rooms (2)');
  assert.equal(t.doc.querySelector('.tdf-rail-room'), null);
  toggle.click();
  const rooms = () => [...t.doc.querySelectorAll('.tdf-rail-room')].map((c) => [c.dataset.room, c.textContent]);
  assert.deepEqual(rooms(), [['2', 'Back (1)'], ['3', 'Den (0)']]);
  // A re-render from the poll keeps it expanded.
  t.doc.getElementById('userCount_2').textContent = '2';
  await nextFrame();
  assert.deepEqual(rooms(), [['2', 'Back (2)'], ['3', 'Den (0)']]);
  t.doc.querySelector('.tdf-rail-room[data-room="2"]').click();
  assert.deepEqual(t.calls, [['changeRooms', '2']]);
  t.doc.querySelector('.tdf-rail-rooms-toggle').click();
  assert.equal(t.doc.querySelector('.tdf-rail-room'), null);
  await t.teardown();
});

test('the list follows joins and leaves without a reload', async () => {
  const t = setup();
  const lobby = t.doc.getElementById('room_1');
  lobby.insertAdjacentHTML('beforeend', row('20', 'Carol', '1'));
  await nextFrame();
  assert.deepEqual(t.users(), ['me', 'Alice', 'Carol']);
  t.doc.getElementById('userlist_121').remove();
  await nextFrame();
  assert.deepEqual(t.users(), ['me', 'Carol']);
  await t.teardown();
});

test('a registered panel and user-menu action appear without editing rail code', async () => {
  const t = setup();
  let rendered = 0;
  let slot = 0;
  const offPanel = registerRailPanel({
    id: 'gallery', title: 'Gallery', icon: 'G', order: 10,
    render: (el) => {
      rendered++;
      el.textContent = 'gallery body';
    },
    renderRailSlot: (el) => {
      slot++;
      el.textContent = 'top3';
    },
  });
  const ran = [];
  const offAction = registerUserMenuAction({ id: 'tag', label: 'Tag images', run: (u) => ran.push(u.uuID) });
  assert.deepEqual(t.chips(), ['gallery']);
  t.chip('gallery').click();
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'gallery body');
  assert.deepEqual(t.users(), ['me', 'Alice'], 'the docked list stays visible while a panel is open');
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  t.doc.querySelector('[data-action="tag"]').click();
  assert.deepEqual(ran, ['12']);
  assert.equal(rendered, 1);
  assert.ok(slot >= 1);
  offPanel();
  offAction();
  assert.deepEqual(t.chips(), []);
  await t.teardown();
});

test('renderRailSlot renders inside its chip, after the icon, and a click on it opens the panel', async () => {
  const t = setup();
  const off = registerRailPanel({
    id: 'g', title: 'G', icon: 'G', render: (el) => { el.textContent = 'opened'; },
    renderRailSlot: (el) => { el.innerHTML = '<img class="thumb">'; },
  });
  const chip = t.chip('g');
  assert.deepEqual([...chip.children].map((c) => c.className), ['tdf-rail-icon', 'tdf-rail-slot']);
  chip.querySelector('.thumb').click();
  assert.equal(t.flyout().hidden, false);
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'opened');
  off();
  await t.teardown();
});

test('an SVG icon renders as markup and a text icon as text', async () => {
  const t = setup();
  const offs = [
    registerRailPanel({ id: 'svg', title: 'Svg', icon: ICONS.image, render() {} }),
    registerRailPanel({ id: 'txt', title: 'Txt', icon: '<b>x</b>', render() {} }),
  ];
  const svg = t.chip('svg').querySelector('.tdf-rail-icon');
  assert.ok(svg.querySelector('svg'));
  assert.equal(svg.querySelectorAll('path').length, 2);
  const txt = t.chip('txt').querySelector('.tdf-rail-icon');
  assert.equal(txt.textContent, '<b>x</b>');
  assert.equal(txt.querySelector('b'), null);
  offs.forEach((off) => off());
  await t.teardown();
});

test('Escape, an outside click and the same chip close the flyout, running the panel cleanup', async () => {
  const t = setup();
  let cleaned = 0;
  const off = registerRailPanel({ id: 'p', title: 'P', icon: 'P', render: () => () => cleaned++ });
  t.chip('p').click();
  assert.equal(t.chip('p').getAttribute('aria-expanded'), 'true');
  t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(t.flyout().hidden, true);
  t.chip('p').click();
  t.doc.body.dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(t.flyout().hidden, true);
  t.chip('p').click();
  t.doc.querySelector('.tdf-rail-users').dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(t.flyout().hidden, false, 'a click inside the rail keeps it open');
  t.chip('p').click();
  assert.equal(t.flyout().hidden, true);
  assert.equal(t.chip('p').getAttribute('aria-expanded'), 'false');
  assert.equal(cleaned, 3);
  off();
  await t.teardown();
});

test('open(arg) shows the panel and passes arg to render; a click passes none', async () => {
  const t = setup();
  const args = [];
  const handle = registerRailPanel({ id: 'o', title: 'O', icon: 'O', render: (_el, arg) => { args.push(arg); } });
  handle.open({ user: '12' });
  assert.equal(t.flyout().hidden, false);
  assert.equal(t.doc.querySelector('.tdf-rail-title').textContent, 'O');
  assert.equal(t.chip('o').getAttribute('aria-expanded'), 'true');
  t.chip('o').click();
  t.chip('o').click();
  assert.deepEqual(args, [{ user: '12' }, undefined]);
  // A replacement under the same id re-opens with the arg it was opened with.
  handle.open('again');
  const offNew = registerRailPanel({ id: 'o', title: 'O2', icon: 'O', render: (_el, arg) => { args.push(['new', arg]); } });
  assert.deepEqual(args.at(-1), ['new', 'again']);
  // The replaced handle no longer opens anything, and says so.
  t.chip('o').click();
  handle.open();
  assert.equal(t.flyout().hidden, true);
  assert.deepEqual(t.errors(), ['Rail: rail panel o is no longer registered']);
  offNew();
  handle();
  await t.teardown();
  // After teardown there is no rail to open in: a no-op, not a throw.
  const late = registerRailPanel({ id: 'late', title: 'L', icon: 'L', render() {} });
  late.open();
  late();
});

test('the Profile chip opens your own profile under profileRef, and waits for your own row', async () => {
  for (const [profileRef, id] of [[0, '7'], [1, 'me'], [2, '97']]) {
    const t = setup({ flags: { profileRef } });
    const chip = t.doc.querySelector('.tdf-rail-profile');
    assert.equal(chip.hidden, false);
    assert.equal(chip.disabled, false);
    assert.ok(chip.querySelector('svg'));
    assert.equal(t.doc.querySelector('.tdf-rail-header .tdf-rail-chip'), chip, 'first in the header chips');
    chip.click();
    assert.deepEqual(t.calls, [['viewProfile', id, 'me']]);
    await t.teardown();
  }

  const t = setup({ prepare: (doc) => doc.getElementById('userlist_71').remove() });
  const chip = t.doc.querySelector('.tdf-rail-profile');
  assert.equal(chip.disabled, true);
  chip.click();
  assert.deepEqual(t.calls, []);
  t.doc.getElementById('room_1').insertAdjacentHTML('afterbegin', row('7', 'me', '1'));
  await nextFrame();
  assert.equal(chip.disabled, false);
  await t.teardown();
});

test('the Profile chip is absent when the engine has profiles off', async () => {
  const t = setup({ flags: { profileOn: 0 } });
  assert.equal(t.doc.querySelector('.tdf-rail-profile').hidden, true);
  await t.teardown();
});

test('a panel whose render throws is reported, not fatal', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'bad', title: 'Bad', icon: 'B', render: () => { throw new Error('boom'); } });
  t.chip('bad').click();
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
  assert.ok(t.doc.querySelector('#tdf-chat > #tdf-rail'));
  assert.equal(t.doc.getElementById('tdf-rail-style').textContent, '/* rail */');
  // A second copy of the script does not start a rail of its own.
  assert.equal(startRail({ doc: t.doc, win: t.win, css: '' }), false);
  await nextFrame();
  assert.equal(t.doc.querySelectorAll('#tdf-rail').length, 1);
  await t.teardown();
  assert.equal(t.doc.getElementById('tdf-rail'), null);
  assert.deepEqual(listPanels(), []);
});

test('a page with no user list mounts nothing', () => {
  const win = new Window();
  win.document.body.innerHTML = '<div id="tdf-chat"></div>';
  assert.equal(startRail({ doc: win.document, win, css: '' }), false);
  assert.equal(win.document.getElementById('tdf-rail'), null);
});

test('status starts from the engine selector, then the own row, then Here; a pick outranks both', async () => {
  let t = setup({ extra: '<select id="selectStatusID"><option value="1">Here</option><option value="2" selected>BRB</option></select>' });
  const first = t.doc.querySelector('.tdf-rail-status');
  assert.equal(first.value, '2');
  first.value = '1';
  first.dispatchEvent(new t.win.Event('change'));
  assert.equal(t.doc.getElementById('selectStatusID').value, '1', 'the engine selector follows');
  await t.teardown();

  t = setup();
  t.doc.getElementById('ustatusID_7').innerHTML = '&nbsp;[Away]';
  await nextFrame();
  const sel = t.doc.querySelector('.tdf-rail-status');
  assert.equal(sel.value, '3');
  sel.value = '2';
  sel.dispatchEvent(new t.win.Event('change'));
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('30', 'Dan', '1'));
  await nextFrame();
  assert.equal(t.doc.querySelector('.tdf-rail-status').value, '2', 'the pick survives a re-render');
  await t.teardown();
});

test('a status rewrite with the same text does not re-render the list', async () => {
  const t = setup();
  const list = t.doc.querySelector('.tdf-rail-users');
  t.doc.getElementById('ustatusID_12').innerHTML = '';
  await nextFrame();
  assert.equal(t.doc.querySelector('.tdf-rail-users'), list);
  await t.teardown();
});

test('a room the page is not in shows the unavailable notice; Intelli-bot shows No actions', async () => {
  const t = setup({ flags: { roomID: 99 } });
  assert.equal(t.doc.querySelector('.tdf-rail-users .tdf-rail-empty').textContent, 'The user list is not available.');
  assert.equal(t.doc.querySelector('.tdf-rail-room-name').hidden, true);
  t.win.roomID = 1;
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('40', 'Intelli-bot', '1'));
  await nextFrame();
  t.doc.querySelector('.tdf-rail-user[data-uuid="40"] .tdf-rail-user-name').click();
  assert.equal(t.doc.querySelector('.tdf-rail-menu .tdf-rail-empty').textContent, 'No actions');
  await t.teardown();
});

test('engine and registered-action failures are shown in the rail with their cause', async () => {
  const t = setup();
  delete t.win.viewProfile;
  const off = registerUserMenuAction({ id: 'odd', label: 'Odd', isVisible: () => { throw new Error('no idea'); }, run() {} });
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  assert.equal(t.doc.querySelector('[data-action="odd"]'), null);
  t.doc.querySelector('[data-action="profile"]').click();
  t.doc.querySelector('.tdf-rail-profile').click();
  assert.deepEqual(t.errors(), [
    'Rail: user menu action odd: no idea',
    'Rail: the chat engine has no viewProfile()',
    'Rail: the chat engine has no viewProfile()',
  ]);
  t.doc.querySelector('.tdf-rail-error').click();
  assert.equal(t.doc.querySelector('.tdf-rail-error').hidden, true);
  off();
  await t.teardown();
});

test('an open panel replaced under its id re-opens; one unregistered closes', async () => {
  const t = setup();
  const off1 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.textContent = 'one'; } });
  t.chip('r').click();
  const off2 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.textContent = 'two'; } });
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'two');
  off1();
  off2();
  assert.equal(t.flyout().hidden, true);
  await t.teardown();
});

test('a user list that cannot mount is reported and leaves the engine panel showing', async () => {
  const t = setup({
    prepare: (doc) => {
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
  assert.equal(cleaned, 1, 'the second registration re-rendered the chips');
  assert.deepEqual(t.errors(), ['Rail: slot broke']);
  offBad();
  assert.equal(cleaned, 2);
  await t.teardown();
  assert.equal(cleaned, 3);
  off();
  assert.equal(cleaned, 3, 'a destroyed rail no longer renders');
});

test('the rail mounts again when #tdf-chat comes back', async () => {
  const t = setup();
  await t.teardown();
  t.doc.body.insertAdjacentHTML('afterbegin', '<div id="tdf-chat"></div>');
  await nextFrame();
  assert.ok(t.doc.querySelector('#tdf-chat > #tdf-rail'));
  assert.deepEqual(t.users(), ['me', 'Alice']);
  assert.equal(t.doc.querySelectorAll('.tdf-rail-profile').length, 1);
  await t.teardown();
});

test('a status the engine is too busy to send is reported and the picker stays on the real one', async () => {
  const t = setup();
  t.win.sendReq = { readyState: 1 };
  const sel = t.doc.querySelector('.tdf-rail-status');
  sel.value = '3';
  sel.dispatchEvent(new t.win.Event('change'));
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.errors(), ['Rail: the chat engine is busy sending; the status was not changed']);
  assert.equal(t.doc.querySelector('.tdf-rail-status').value, '1');
  await t.teardown();
});
