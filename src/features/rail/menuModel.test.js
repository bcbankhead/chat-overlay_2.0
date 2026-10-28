import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtInActions, profileID } from './menuModel.js';

const user = {
  uuID: '12',
  name: 'Alice Smith',
  rawName: 'Alice%20Smith',
  roomID: '1',
  userID: '345',
  avatar: 'female.gif',
  block: '1',
  ip: '10.0.0.1',
  statusText: '',
};

/** A member with the site's settings.js.php values, chat and PM allowed. */
const flags = (over = {}) => ({
  uID: 7,
  userName: 'me',
  privateOn: 1,
  whisperOn: 1,
  webcamsOn: 0,
  profileOn: 1,
  profileRef: 2,
  groupPChat: 1,
  groupWatch: 1,
  eCredits: 0,
  noCredits: false,
  share: 0,
  admin: 0,
  moderator: 0,
  roomOwner: 0,
  moderatedChat: 0,
  styleFolder: 'default',
  intelliBotName: 'Intelli-bot',
  whispering: false,
  lang: {},
  ...over,
});

const ids = (actions) => actions.map((a) => a.id);
const find = (actions, id) => actions.find((a) => a.id === id);

test('a member sees private chat, whisper, profile, block, unblock and report on another user', () => {
  const actions = builtInActions(user, flags());
  assert.deepEqual(ids(actions), ['private', 'whisper', 'profile', 'block', 'unblock', 'report']);
  assert.deepEqual(find(actions, 'private').calls, [['clearWhisper'], ['createPChatDiv', 'me', 'Alice%20Smith', '12', '7']]);
  assert.deepEqual(find(actions, 'whisper').calls, [['whisperUser', 'Alice%20Smith']]);
  assert.deepEqual(find(actions, 'block').calls, [
    ['blockUsers', 'block', '12'],
    ['showInfoBox', 'system', '220', '300', '200', '', 'You have blocked Alice Smith'],
  ]);
  assert.deepEqual(find(actions, 'unblock').calls[0], ['blockUsers', 'unblock', '12']);
  assert.deepEqual(find(actions, 'report').calls, [
    ['showInfoBox', 'report', '280', '360', '200', 'templates/default/report.php?id=Alice%20Smith', ''],
  ]);
});

test('on yourself only profile shows (uID compared loosely, number against string)', () => {
  assert.deepEqual(ids(builtInActions({ ...user, uuID: '7' }, flags())), ['profile']);
});

test('a guest (groupPChat 0) gets the group notice for private chat and whisper', () => {
  const actions = builtInActions(user, flags({ groupPChat: 0, lang: { lang6: 'Not for guests' } }));
  const notice = [['showInfoBox', 'system', '220', '300', '200', '', 'Not for guests']];
  assert.deepEqual(find(actions, 'private').calls, notice);
  assert.deepEqual(find(actions, 'whisper').calls, notice);
});

test('no eCredits outranks the group gate', () => {
  const actions = builtInActions(user, flags({ eCredits: 1, noCredits: true, groupPChat: 0 }));
  assert.deepEqual(find(actions, 'private').calls, [['showInfoBox', 'system', '220', '300', '200', '', 'You do not have any eCredits']]);
  // eCredits off: an empty credit counter is ignored, as the engine does.
  assert.deepEqual(find(builtInActions(user, flags({ noCredits: true })), 'whisper').calls, [['whisperUser', 'Alice%20Smith']]);
});

test('profileRef 0, 1 and 2 pass uuID, the raw name and the forum id', () => {
  assert.equal(profileID(user, 0), '12');
  assert.equal(profileID(user, 1), 'Alice%20Smith');
  assert.equal(profileID(user, 2), '345');
  assert.equal(profileID(user, 9), '');
  for (const [ref, id] of [[0, '12'], [1, 'Alice%20Smith'], [2, '345']]) {
    assert.deepEqual(find(builtInActions(user, flags({ profileRef: ref })), 'profile').calls, [['viewProfile', id, 'Alice%20Smith']]);
  }
  assert.equal(find(builtInActions(user, flags({ profileOn: 0 })), 'profile'), undefined);
});

test('an unblockable user (admin, mod, speaker) has no block, unblock or report', () => {
  assert.deepEqual(ids(builtInActions({ ...user, block: '0' }, flags())), ['private', 'whisper', 'profile']);
});

test('an admin also gets silence, kick, ban and IP on others, and the admin area on themself', () => {
  const actions = builtInActions(user, flags({ admin: 1 }));
  assert.deepEqual(ids(actions).slice(-4), ['silence', 'kick', 'ban', 'ip']);
  assert.deepEqual(find(actions, 'kick').calls, [['adminControls', 'Alice%20Smith', 'KICK']]);
  assert.deepEqual(find(actions, 'ip').calls, [['newWin', 'http://www.infosniper.net/index.php?ip_address=10.0.0.1']]);
  assert.deepEqual(ids(builtInActions({ ...user, uuID: '7' }, flags({ admin: 1 }))), ['profile', 'admin-area']);
  assert.deepEqual(ids(builtInActions({ ...user, uuID: '7' }, flags({ admin: 1, moderatedChat: '1' }))), ['profile', 'admin-area', 'moderated-chat']);
});

test('a room owner gets silence and kick but not ban or IP', () => {
  const actions = ids(builtInActions(user, flags({ roomOwner: 1 })));
  assert.ok(actions.includes('silence') && actions.includes('kick'));
  assert.ok(!actions.includes('ban') && !actions.includes('ip'));
});

test('share files and webcam follow their own engine gates', () => {
  const actions = builtInActions(user, flags({ share: 1, webcamsOn: 1 }));
  assert.deepEqual(ids(actions), ['private', 'whisper', 'webcam', 'profile', 'share', 'block', 'unblock', 'report']);
  assert.deepEqual(find(actions, 'webcam').calls, [['requestViewWebcam', 'Alice%20Smith']]);
  assert.deepEqual(find(builtInActions(user, flags({ webcamsOn: 1, groupWatch: 0 })), 'webcam').calls[0][0], 'showInfoBox');
});

test('clear whisper appears whenever a whisper target is set', () => {
  assert.ok(ids(builtInActions(user, flags({ whispering: true }))).includes('clear-whisper'));
  assert.deepEqual(ids(builtInActions({ ...user, uuID: '7' }, flags({ whispering: true }))), ['clear-whisper', 'profile']);
});

test('Intelli-bot has no menu, matched case-insensitively', () => {
  assert.deepEqual(builtInActions({ ...user, rawName: 'intelli-BOT' }, flags()), []);
});

test('labels come from the engine lang strings when present', () => {
  const actions = builtInActions(user, flags({ lang: { lang33: 'PM', lang34: '' } }));
  assert.equal(find(actions, 'private').label, 'PM');
  assert.equal(find(actions, 'whisper').label, 'Whisper User');
});
