import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { createEngine } from './engine.js';

function page(html = '', globals = {}) {
  const win = new Window();
  win.document.body.innerHTML = html;
  Object.assign(win, globals);
  return { win, engine: createEngine(win, win.document) };
}

test('flags read the engine globals, the credit counter and the whisper target', () => {
  const { engine } = page('<span id="eCreditsID">0</span><input id="whisperID" value="bob">', {
    uID: 7, admin: 1, profileRef: 2, lang33: 'PM',
  });
  const flags = engine.flags();
  assert.equal(flags.uID, 7);
  assert.equal(flags.admin, 1);
  assert.equal(flags.noCredits, true);
  assert.equal(flags.whispering, true);
  assert.equal(flags.lang.lang33, 'PM');
  const none = page('<span id="eCreditsID">3</span><input id="whisperID" value="">').engine.flags();
  assert.equal(none.noCredits, false);
  assert.equal(none.whispering, false);
});

test('call makes the calls in order and refuses a function outside the menu set or missing', () => {
  const made = [];
  const { win, engine } = page('', {
    clearWhisper: () => made.push('clear'),
    createPChatDiv: (...a) => made.push(a),
    eval: () => made.push('eval'),
  });
  engine.call([['clearWhisper'], ['createPChatDiv', 'me', 'bob', '12', '7']]);
  assert.deepEqual(made, ['clear', ['me', 'bob', '12', '7']]);
  assert.throws(() => engine.call([['eval', '1']]), /no eval\(\)/);
  delete win.clearWhisper;
  assert.throws(() => engine.call([['clearWhisper'], ['createPChatDiv']]), /no clearWhisper\(\)/);
  assert.equal(made.length, 2, 'a missing function stops the sequence');
});

test('statuses decode userStatusMes from index 1, with the engine default when absent', () => {
  assert.deepEqual(page('', { userStatusMes: ['select', 'Here', 'Be%20right%20back'] }).engine.statuses(), [
    { index: 1, label: 'Here' },
    { index: 2, label: 'Be right back' },
  ]);
  assert.deepEqual(page().engine.statuses().map((s) => s.label), ['Here', 'BRB', 'Away']);
});

test('selectedStatus reads the engine selector only once it is built and set', () => {
  assert.equal(page().engine.selectedStatus(), null);
  assert.equal(page('<select id="selectStatusID"><option value="0">select</option></select>').engine.selectedStatus(), null);
  assert.equal(page('<select id="selectStatusID"><option value="3" selected>Away</option></select>').engine.selectedStatus(), 3);
});

test('sendStatus and changeRooms call the engine, and refuse when it has neither', () => {
  const made = [];
  const { engine } = page('', { sendStatus: (i) => made.push(['status', i]), changeRooms: (r) => made.push(['room', r]), roomID: 4 });
  engine.sendStatus(2);
  engine.changeRooms('9');
  assert.deepEqual(made, [['status', 2], ['room', '9']]);
  assert.equal(engine.roomID(), '4');
  const bare = page().engine;
  assert.throws(() => bare.sendStatus(1), /no sendStatus\(\)/);
  assert.throws(() => bare.changeRooms('1'), /no changeRooms\(\)/);
  assert.equal(bare.roomID(), '');
  assert.equal(bare.uID(), '');
});
