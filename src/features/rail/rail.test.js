import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { listPanels, registerRailPanel, registerUserMenuAction } from './api.js';
import { startRail } from './rail.js';

const row = (uuID, uUser, roomID) =>
  `<div id="userlist_${uuID}${roomID}" class="userlist"><div><span style='float:left;'><img id='avatar_${uuID}' src='avatars/a.gif'>&nbsp;<span onclick='userPanel("me","${uUser}","${uuID}","${roomID}","9${uuID}","a.gif","1","1.1.1.${uuID}")'>${uUser}</span><span id='ustatusID_${uuID}'></span></span></div></div>`;
const room = (roomID, name, rows) =>
  `<div id="room_${roomID}"><div class="roomheader"> <span style="float:left;"><img>&nbsp;${name}&nbsp;</span> <span class="usercount">[<span id="userCount_${roomID}">${rows.length}</span>]</span> </div>${rows.join('')}</div>`;

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

function setup({ host = true, extra = '' } = {}) {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML =
    `${host ? '<div id="tdf-chat" data-theme="light"></div>' : ''}<input id="whisperID" value="">${extra}` +
    `<div id="userContainer">${room('1', 'Lobby', [row('7', 'me', '1'), row('12', 'Alice', '1')])}${room('2', 'Back', [row('13', 'Bob', '2')])}</div>`;
  const calls = [];
  Object.assign(win, {
    uID: 7, userName: 'me', roomID: 1, privateOn: 1, whisperOn: 1, profileOn: 1, profileRef: 2, groupPChat: 1,
    eCredits: 0, share: 0, admin: 0, moderator: 0, roomOwner: 0, intelliBotName: 'Intelli-bot',
    userStatusMes: ['select', 'Here', 'BRB', 'Away'],
  });
  for (const fn of ['whisperUser', 'clearWhisper', 'blockUsers', 'viewProfile', 'createPChatDiv', 'showInfoBox', 'sendStatus', 'changeRooms']) {
    win[fn] = (...args) => calls.push([fn, ...args]);
  }
  win.whisperUser = (name) => {
    calls.push(['whisperUser', name]);
    doc.getElementById('whisperID').value = decodeURI(name);
  };
  assert.equal(startRail({ doc, win, css: '/* rail */' }), true);
  // Removing #tdf-chat is the rail's teardown path (a failed start); tests use it to clean up.
  const teardown = async () => {
    doc.getElementById('tdf-chat')?.remove();
    await nextFrame();
  };
  const errors = () => [...doc.querySelectorAll('.tdf-rail-error div')].map((d) => d.textContent);
  const openUsers = () => doc.querySelector('[data-panel="users"]').click();
  const users = () => [...doc.querySelectorAll('.tdf-rail-user-name span:first-child')].map((s) => s.textContent);
  return { win, doc, calls, errors, teardown, openUsers, users };
}

test('the rail mounts inside #tdf-chat and lists the current room only', async () => {
  const t = setup();
  assert.equal(t.doc.getElementById('tdf-rail').parentElement.id, 'tdf-chat');
  t.openUsers();
  assert.deepEqual(t.users(), ['me', 'Alice']);
  const rooms = [...t.doc.querySelectorAll('.tdf-rail-room option')].map((o) => [o.value, o.textContent, o.selected]);
  assert.deepEqual(rooms, [['1', 'Lobby (2)', true], ['2', 'Back (1)', false]]);
  await t.teardown();
});

test('whisper from the accordion calls the engine and then offers Clear Whisper', async () => {
  const t = setup();
  t.openUsers();
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

test('status and room pickers call sendStatus(index) and changeRooms(id)', async () => {
  const t = setup();
  t.openUsers();
  const status = t.doc.querySelector('.tdf-rail-status');
  assert.equal(status.value, '1');
  status.value = '3';
  status.dispatchEvent(new t.win.Event('change'));
  const roomSel = t.doc.querySelector('.tdf-rail-room');
  roomSel.value = '2';
  roomSel.dispatchEvent(new t.win.Event('change'));
  assert.deepEqual(t.calls, [['sendStatus', 3], ['changeRooms', '2']]);
  await t.teardown();
});

test('the list follows joins and leaves without a reload', async () => {
  const t = setup();
  t.openUsers();
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
  assert.deepEqual([...t.doc.querySelectorAll('.tdf-rail-button')].map((b) => b.dataset.panel), ['users', 'gallery']);
  assert.equal(t.doc.querySelector('.tdf-rail-slot').textContent, 'top3');
  t.doc.querySelector('[data-panel="gallery"]').click();
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'gallery body');
  t.openUsers();
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  t.doc.querySelector('[data-action="tag"]').click();
  assert.deepEqual(ran, ['12']);
  assert.equal(rendered, 1);
  assert.ok(slot >= 1);
  offPanel();
  offAction();
  assert.deepEqual([...t.doc.querySelectorAll('.tdf-rail-button')].map((b) => b.dataset.panel), ['users']);
  await t.teardown();
});

test('Escape and an outside click close the flyout, running the panel cleanup', async () => {
  const t = setup();
  let cleaned = 0;
  const off = registerRailPanel({ id: 'p', title: 'P', icon: 'P', render: () => () => cleaned++ });
  t.doc.querySelector('[data-panel="p"]').click();
  t.doc.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(t.doc.querySelector('.tdf-rail-flyout').hidden, true);
  t.doc.querySelector('[data-panel="p"]').click();
  t.doc.body.dispatchEvent(new t.win.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(t.doc.querySelector('.tdf-rail-flyout').hidden, true);
  assert.equal(cleaned, 2);
  off();
  await t.teardown();
});

test('a panel whose render throws is reported, not fatal', async () => {
  const t = setup();
  const off = registerRailPanel({ id: 'bad', title: 'Bad', icon: 'B', render: () => { throw new Error('boom'); } });
  t.doc.querySelector('[data-panel="bad"]').click();
  assert.deepEqual(t.errors(), ['Rail: boom']);
  t.openUsers();
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
  // A second copy of the script finds the rail mounted.
  startRail({ doc: t.doc, win: t.win, css: '' });
  await nextFrame();
  assert.equal(t.doc.querySelectorAll('#tdf-rail').length, 1);
  assert.deepEqual(listPanels().map((p) => p.id), ['users']);
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
  t.openUsers();
  const first = t.doc.querySelector('.tdf-rail-status');
  assert.equal(first.value, '2');
  first.value = '1';
  first.dispatchEvent(new t.win.Event('change'));
  assert.equal(t.doc.getElementById('selectStatusID').value, '1', 'the engine selector follows');
  await t.teardown();

  t = setup();
  t.doc.getElementById('ustatusID_7').innerHTML = '&nbsp;[Away]';
  await nextFrame();
  t.openUsers();
  const sel = t.doc.querySelector('.tdf-rail-status');
  assert.equal(sel.value, '3');
  sel.value = '2';
  sel.dispatchEvent(new t.win.Event('change'));
  t.doc.getElementById('room_1').insertAdjacentHTML('beforeend', row('30', 'Dan', '1'));
  await nextFrame();
  assert.equal(t.doc.querySelector('.tdf-rail-status').value, '2', 'the pick survives a re-render');
  await t.teardown();
});

test('a status rewrite with the same text does not re-render the open panel', async () => {
  const t = setup();
  t.openUsers();
  const list = t.doc.querySelector('.tdf-rail-users');
  t.doc.getElementById('ustatusID_12').innerHTML = '';
  await nextFrame();
  assert.equal(t.doc.querySelector('.tdf-rail-users'), list);
  await t.teardown();
});

test('a room the page is not in shows the unavailable notice; Intelli-bot shows No actions', async () => {
  const t = setup();
  t.win.roomID = 99;
  t.openUsers();
  assert.equal(t.doc.querySelector('.tdf-rail-users .tdf-rail-empty').textContent, 'The user list is not available.');
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
  t.openUsers();
  t.doc.querySelector('.tdf-rail-user[data-uuid="12"] .tdf-rail-user-name').click();
  assert.equal(t.doc.querySelector('[data-action="odd"]'), null);
  t.doc.querySelector('[data-action="profile"]').click();
  assert.deepEqual(t.errors(), ['Rail: user menu action odd: no idea', 'Rail: the chat engine has no viewProfile()']);
  t.doc.querySelector('.tdf-rail-error').click();
  assert.equal(t.doc.querySelector('.tdf-rail-error').hidden, true);
  off();
  await t.teardown();
});

test('an open panel replaced under its id re-opens; one unregistered closes', async () => {
  const t = setup();
  const off1 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.textContent = 'one'; } });
  t.doc.querySelector('[data-panel="r"]').click();
  const off2 = registerRailPanel({ id: 'r', title: 'R', icon: 'R', render: (el) => { el.textContent = 'two'; } });
  assert.equal(t.doc.querySelector('.tdf-rail-body').textContent, 'two');
  off1();
  off2();
  assert.equal(t.doc.querySelector('.tdf-rail-flyout').hidden, true);
  await t.teardown();
});
