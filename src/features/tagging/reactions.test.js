import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReaction, reactionText, toHexColor } from './reactions.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';

test('a bare code is a bare reaction, with surrounding whitespace stripped', () => {
  assert.deepEqual(parseReaction(':h', CODES), { code: ':h', suffix: null, retract: false });
  assert.deepEqual(parseReaction('  8)\n', CODES), { code: '8)', suffix: null, retract: false });
});

test('a token names the image by the share id suffix', () => {
  assert.deepEqual(parseReaction(':L ^123456', CODES), { code: ':L', suffix: '123456', retract: false });
  assert.deepEqual(parseReaction('-:L ^123456', CODES), { code: ':L', suffix: '123456', retract: true });
});

test('a sender text style wrapping the message is not part of it (message.js.php addMessage)', () => {
  assert.deepEqual(parseReaction('[b]:h ^111111 [/b]', CODES), { code: ':h', suffix: '111111', retract: false });
  assert.deepEqual(parseReaction('[u][i][b]-:L ^123456 [/b] [/i] [/u]', CODES), { code: ':L', suffix: '123456', retract: true });
  assert.deepEqual(parseReaction('[i]:d [/i]', CODES), { code: ':d', suffix: null, retract: false });
  assert.equal(parseReaction('[b]:h[/i]', CODES), null, 'mismatched wrapper');
  assert.equal(parseReaction('[b]:h nice [/b]', CODES), null, 'extra text inside the wrapper');
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

test('a span- or font-wrapped token, quoted or not, names the image as the plain one does', () => {
  const want = { code: ':h', suffix: '123456', retract: false };
  for (const text of [
    ':h [[span style=color:#f0f0f0]]^123456[[/span]]',
    ":h [[span style='color:#f0f0f0']]^123456[[/span]]",
    ':h [[span style="color: rgb(240, 240, 240)"]]^123456[[/span]]',
    ':h [[font color=#f0f0f0]]^123456[[/font]]',
    ":h [[font color='#f0f0f0']]^123456[[/font]]",
    ':h [[font color="#f0f0f0"]]^123456[[/font]]',
    '[b]:h [[span style=color:#f0f0f0]]^123456[[/span]] [/b]',
  ]) {
    assert.deepEqual(parseReaction(text, CODES), want, text);
  }
  assert.deepEqual(parseReaction('-:h [[span style=color:#fff]]^123456[[/span]]', CODES), { ...want, retract: true });
});

test('a malformed wrap is not a reaction', () => {
  for (const text of [
    ':h [[span style=color:#fff]]^123456[[/font]]',
    `:h [[span style='color:#fff"]]^123456[[/span]]`,
    ':h [[span style=font-family:x]]^123456[[/span]]',
    ':h [[span style=color:#fff]]^12345[[/span]]',
    ':h [[span style=color:#fff]]^123456',
    ':h[[span style=color:#fff]]^123456[[/span]]',
  ]) {
    assert.equal(parseReaction(text, CODES), null, text);
  }
});

test('reactionText round-trips through parseReaction, plain and wrapped', () => {
  const id = '100000000123456';
  assert.equal(reactionText(':h', id), ':h ^123456');
  assert.equal(reactionText(':h', id, '#f0f0f0'), ':h [[span style=color:#f0f0f0]]^123456[[/span]]');
  for (const code of CODES) {
    for (const color of [null, '#f0f0f0']) {
      assert.deepEqual(parseReaction(reactionText(code, id, color), CODES), { code, suffix: '123456', retract: false });
    }
  }
});

test('the engine-escaped characters never enter a wrapped reaction', () => {
  assert.doesNotMatch(reactionText(':h', '100000000123456', '#f0f0f0'), /['"<>&]/);
});

test('toHexColor normalises computed colours, and is null for transparent or unknown', () => {
  assert.equal(toHexColor('rgb(240, 240, 240)'), '#f0f0f0');
  assert.equal(toHexColor('rgba(1, 2, 3, 0.5)'), '#010203');
  assert.equal(toHexColor('rgb(255 0 128 / 50%)'), '#ff0080');
  assert.equal(toHexColor('#ABC'), '#aabbcc');
  assert.equal(toHexColor('#a1b2c3'), '#a1b2c3');
  assert.equal(toHexColor('#a1b2c3ff'), '#a1b2c3');
  for (const css of ['rgba(0, 0, 0, 0)', 'transparent', '#00000000', '#0000', 'red', '', 'rgb(1,2)']) {
    assert.equal(toHexColor(css), null, css);
  }
});
