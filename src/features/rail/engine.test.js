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

test('flags read the engine globals and the credit counter', () => {
  const { engine } = page('<span id="eCreditsID">0</span><input id="whisperID" value="bob">', {
    uID: 7, admin: 1, profileRef: 2, lang33: 'PM',
  });
  const flags = engine.flags();
  assert.equal(flags.uID, 7);
  assert.equal(flags.admin, 1);
  assert.equal(flags.noCredits, true);
  assert.equal(flags.lang.lang33, 'PM');
  const none = page('<span id="eCreditsID">3</span><input id="whisperID" value="">').engine.flags();
  assert.equal(none.noCredits, false);
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

test('changeRooms calls the engine, and refuses when it has none', () => {
  const made = [];
  const { engine } = page('', { changeRooms: (r) => made.push(['room', r]), roomID: 4 });
  engine.changeRooms('9');
  assert.deepEqual(made, [['room', '9']]);
  assert.equal(engine.roomID(), '4');
  const bare = page().engine;
  assert.throws(() => bare.changeRooms('1'), /no changeRooms\(\)/);
  assert.equal(bare.roomID(), '');
  assert.equal(bare.uID(), '');
});

