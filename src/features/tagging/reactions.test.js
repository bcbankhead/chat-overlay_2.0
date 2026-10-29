import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SMILIE_CODES_FIXTURE as CODES, parseReaction, reactionText } from './reactions.js';

test('a bare code is a bare reaction, with surrounding whitespace stripped', () => {
  assert.deepEqual(parseReaction(':h', CODES), { code: ':h', suffix: null, retract: false });
  assert.deepEqual(parseReaction('  8)\n', CODES), { code: '8)', suffix: null, retract: false });
});

test('a token names the image by the share id suffix', () => {
  assert.deepEqual(parseReaction(':L ^123456', CODES), { code: ':L', suffix: '123456', retract: false });
  assert.deepEqual(parseReaction('-:L ^123456', CODES), { code: ':L', suffix: '123456', retract: true });
});

test('anything else is not a reaction', () => {
  for (const text of [':h nice', 'nice :h', ':H', ':h ^12345', ':h ^1234567', '-:h', ':h^123456', '', 'lol', '-lol ^123456']) {
    assert.equal(parseReaction(text, CODES), null, text);
  }
});

test('codes are the given list, not a built-in one', () => {
  assert.equal(parseReaction(':h', [':)']), null);
  assert.deepEqual(parseReaction('xx', ['xx']), { code: 'xx', suffix: null, retract: false });
});

test('reactionText round-trips through parseReaction', () => {
  const id = '100000000123456';
  assert.equal(reactionText(':h', id, false), ':h ^123456');
  assert.equal(reactionText(':h', id, true), '-:h ^123456');
  for (const code of CODES) {
    for (const retract of [false, true]) {
      assert.deepEqual(parseReaction(reactionText(code, id, retract), CODES), { code, suffix: '123456', retract });
    }
  }
});
