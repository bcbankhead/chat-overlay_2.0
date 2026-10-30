import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { parseUserPanelArgs, readRooms, readRow } from './rowParse.js';

// The two row templates from createUsersDiv (userlist.js.php:74 webcams on, :78 off), and
// the room template from createRoomsdiv (:317), built with the same string concatenation.
function rowHtml({ webcamsOn, userName, uUser, uuID, uRoom, userID, uAvatar, uBlock, uIP, badges = '' }) {
  const panel = `userPanel("${userName}","${uUser}","${uuID}","${uRoom}","${userID}","${uAvatar}","${uBlock}","${uIP}")`;
  const name = `<span onclick='${panel}'>${decodeURI(uUser)}${badges}</span><span id='ustatusID_${uuID}'></span>`;
  if (webcamsOn) {
    return `<div><span style='float:left;'><img id='avatar_${uuID}' style='vertical-align:middle;' src='avatars/${uAvatar}'>&nbsp;${name}</span><span style='float:right;'><img id='watch_${uuID}' style='vertical-align:middle;' src='images/inv.gif'><img id='webcam_${uuID}' style='vertical-align:middle;' src='images/inv.gif'></span></div>`;
  }
  return `<div><span style='float:left;'><img id='avatar_${uuID}' style='vertical-align:middle;' src='avatars/${uAvatar}'>&nbsp;${name}</span></div>`;
}

function roomHtml(room, roomid, rows, count = rows.length) {
  return `<div id="room_${roomid}"><div class="roomheader" onclick=toggleHeader("room_${roomid}");> <span style="float:left;"><img style="vertical-align:middle;" src="templates/default/images/rooms.png">&nbsp;${decodeURI(room.replace(/\+/g, ' '))}&nbsp;</span> <span style="float:right;" class="usercount">[<span id="userCount_${roomid}">${count}</span>]</span> </div>${rows
    .map((r) => `<div id="userlist_${r.uuID}${roomid}" class="userlist">${rowHtml({ ...r, uRoom: roomid })}</div>`)
    .join('')}</div>`;
}

function container(html) {
  const doc = new Window().document;
  doc.body.innerHTML = `<div id="userContainer">${html}</div>`;
  return doc.getElementById('userContainer');
}

const alice = { userName: 'me', uUser: 'Alice%20Smith', uuID: '12', userID: '345', uAvatar: 'female.gif', uBlock: '1', uIP: '10.0.0.1' };

for (const webcamsOn of [false, true]) {
  test(`readRow reads every field from the ${webcamsOn ? 'webcam' : 'plain'} row template`, () => {
    const c = container(roomHtml('Main+Room', '1', [{ ...alice, webcamsOn }]));
    const user = readRow(c.querySelector('.userlist'));
    assert.deepEqual(user, {
      uuID: '12',
      name: 'Alice Smith',
      rawName: 'Alice%20Smith',
      roomID: '1',
      userID: '345',
      avatar: 'female.gif',
      block: '1',
      ip: '10.0.0.1',
      statusText: '',
    });
  });
}

test('readRow takes uuID from the avatar child, not the concatenated row id', () => {
  // userlist_1 + 23 and userlist_12 + 3 are the same id; the children disambiguate.
  const c = container(roomHtml('Lobby', '23', [{ ...alice, uuID: '1', webcamsOn: false }]) + roomHtml('Other', '3', [{ ...alice, uuID: '12', webcamsOn: false }]));
  const [a, b] = [...c.querySelectorAll('.userlist')].map(readRow);
  assert.equal(a.uuID, '1');
  assert.equal(a.roomID, '23');
  assert.equal(b.uuID, '12');
  assert.equal(b.roomID, '3');
});

test('readRow keeps status text, including the engine idle marker', () => {
  const c = container(roomHtml('Lobby', '1', [{ ...alice, webcamsOn: false }]));
  c.querySelector('#ustatusID_12').innerHTML = '&nbsp;[BRB] [Idle]';
  assert.equal(readRow(c.querySelector('.userlist')).statusText, ' [BRB] [Idle]');
});

test('readRow keeps admin badges out of the name and reads block 0', () => {
  const c = container(roomHtml('Lobby', '1', [{ ...alice, uBlock: '0', badges: ' (A) ', webcamsOn: true }]));
  const user = readRow(c.querySelector('.userlist'));
  assert.equal(user.name, 'Alice Smith');
  assert.equal(user.block, '0');
});

test('readRow tolerates a malformed URI-encoded name', () => {
  const doc = new Window().document;
  doc.body.innerHTML = `<div id="room_1"><div class="userlist"><img id="avatar_5"><span onclick='userPanel("me","bad%E0","5","1","9","a.gif","1","")'>x</span></div></div>`;
  const user = readRow(doc.querySelector('.userlist'));
  assert.equal(user.name, 'bad%E0');
});

test('readRow returns null for a row it cannot identify', () => {
  const doc = new Window().document;
  doc.body.innerHTML = '<div id="room_1"><div class="userlist"><span>no avatar</span></div></div>';
  assert.equal(readRow(doc.querySelector('.userlist')), null);
});

test('parseUserPanelArgs requires exactly the eight userPanel arguments', () => {
  assert.deepEqual(parseUserPanelArgs('userPanel("a","b","1","2","3","x.gif","1","ip")'), ['a', 'b', '1', '2', '3', 'x.gif', '1', 'ip']);
  assert.equal(parseUserPanelArgs('userPanel("a","b")'), null);
  assert.equal(parseUserPanelArgs('whisperUser("a")'), null);
  assert.equal(parseUserPanelArgs(null), null);
});

test('readRooms reads every room with name, count and users', () => {
  const c = container(
    roomHtml('Main+Room', '1', [{ ...alice, webcamsOn: false }, { ...alice, uuID: '13', uUser: 'Bob', webcamsOn: false }]) +
      roomHtml('Quiet', '2', []),
  );
  const rooms = readRooms(c);
  assert.deepEqual(
    rooms.map((r) => [r.roomID, r.name, r.count, r.users.map((u) => u.name)]),
    [
      ['1', 'Main Room', 2, ['Alice Smith', 'Bob']],
      ['2', 'Quiet', 0, []],
    ],
  );
});

test('readRooms skips non-room children and unidentifiable rows, and falls back to the row count', () => {
  const c = container(
    '<div id="other"></div>' +
      '<div id="room_4"><div class="roomheader"><span>Odd</span></div>' +
      `<div class="userlist">${rowHtml({ ...alice, uRoom: '4', webcamsOn: false })}</div>` +
      '<div class="userlist"><span>broken</span></div></div>',
  );
  const rooms = readRooms(c);
  assert.deepEqual(rooms.map((r) => [r.roomID, r.name, r.count, r.users.length]), [['4', 'Odd', 1, 1]]);
});
