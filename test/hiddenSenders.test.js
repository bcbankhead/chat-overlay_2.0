import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hidesLine, parseHidden, pickerEntries, toggleHidden } from '../src/core/hiddenSenders.js';

test('toggleHidden adds an absent sender and removes a present one, sorted and deduplicated', () => {
  assert.deepEqual(toggleHidden([], 'bob'), ['bob']);
  assert.deepEqual(toggleHidden(['zed', 'amy'], 'bob'), ['amy', 'bob', 'zed']);
  assert.deepEqual(toggleHidden(['amy', 'bob', 'bob'], 'bob'), ['amy']);
  assert.deepEqual(toggleHidden(['amy', 'amy'], 'zed'), ['amy', 'zed']);
});

test('toggleHidden returns a new array and leaves a frozen list alone', () => {
  const list = Object.freeze(['amy']);
  const next = toggleHidden(list, 'bob');
  assert.notEqual(next, list);
  assert.deepEqual(list, ['amy']);
});

test('toggleHidden matches the raw sender exactly, not its decoded label', () => {
  assert.deepEqual(toggleHidden(['Big%20Bob'], 'Big Bob'), ['Big Bob', 'Big%20Bob']);
});

test('hidesLine hides only public messages and whispers of a hidden sender', () => {
  const hidden = new Set(['bob']);
  assert.equal(hidesLine({ kind: 'public', user: 'bob' }, hidden), true);
  assert.equal(hidesLine({ kind: 'whisper', user: 'bob' }, hidden), true);
  for (const kind of ['entry', 'exit', 'system']) {
    assert.equal(hidesLine({ kind, user: 'bob' }, hidden), false, kind);
  }
  assert.equal(hidesLine({ kind: 'public', user: 'amy' }, hidden), false);
  assert.equal(hidesLine({ kind: 'public', user: 'bob' }, new Set()), false);
});

test('parseHidden keeps the strings of an array and reads anything else as none', () => {
  assert.deepEqual(parseHidden(['a', 2, 'b', null]), ['a', 'b']);
  assert.deepEqual(parseHidden(undefined), []);
  assert.deepEqual(parseHidden('bob'), []);
  assert.deepEqual(parseHidden({ 0: 'bob' }), []);
});

test('pickerEntries flags hidden senders and lists hidden ones with no saved lines, count 0, after', () => {
  const senders = [
    { user: 'carol', count: 3 },
    { user: 'bob', count: 1 },
  ];
  assert.deepEqual(pickerEntries(senders, new Set(['zed', 'bob', 'amy'])), [
    { user: 'carol', count: 3, hidden: false },
    { user: 'bob', count: 1, hidden: true },
    { user: 'amy', count: 0, hidden: true },
    { user: 'zed', count: 0, hidden: true },
  ]);
  assert.deepEqual(pickerEntries([], new Set()), []);
  assert.deepEqual(pickerEntries([], new Set(['amy'])), [{ user: 'amy', count: 0, hidden: true }]);
});
