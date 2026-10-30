import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, isDelete, isWhisper, NO_RECIPIENT, parseBody, parseUserMessage, whisperTarget } from '../src/core/parse.js';

const lang = { publicEntry: 'has joined the room ...', publicExit: 'has left the room ...' };

test('parseUserMessage splits the }{ fields', () => {
  const m = parseUserMessage('901}{12}{chatContainer}{alice}{}{body%20x}{?}{beep_high.mp3}{1761500000');
  assert.deepEqual(m, {
    id: '901', uid: '12', targetDiv: 'chatContainer', user: 'alice', toUser: '',
    body: 'body%20x', sfx: 'beep_high.mp3', mTime: '1761500000',
  });
});

test('parseBody decodes and splits seven fields', () => {
  const b = parseBody(encodeURI('av.gif|#ff0000|14px|arial|hello world|1|0'));
  assert.deepEqual(b, {
    avatar: 'av.gif', color: '#ff0000', size: '14px', family: 'arial',
    text: 'hello world', ircFlag: '1', lineBreakFlag: '0',
  });
});

test('parseBody accepts the five-field share body', () => {
  const b = parseBody('av.gif|#000|12px|verdana|[[br]]');
  assert.equal(b.text, '[[br]]');
  assert.equal(b.ircFlag, '');
  assert.equal(b.lineBreakFlag, '');
});

test('parseBody survives a malformed URI sequence', () => {
  assert.equal(parseBody('a|b|c|d|100%|0|0').text, '100%');
});

test('classify derives kind from avatar, toUser and body', () => {
  const body = (over) => ({ ...parseBody('av.gif|#000|12px|verdana|hi|0|0'), ...over });
  const at = (over, toUser = '') => classify({ targetDiv: 'chatContainer', toUser, body: body(over) }, lang);
  assert.equal(at({}), 'public');
  assert.equal(at({}, 'bob'), 'whisper');
  assert.equal(at({ avatar: '1', text: '** alice has joined the room ...' }), 'entry');
  assert.equal(at({ avatar: '1', text: '** alice has left the room ...' }), 'exit');
  assert.equal(at({ avatar: '../images/notice.gif' }), 'system');
  assert.equal(at({ ircFlag: '1', text: ' &#187; bob: psst' }), 'whisper');
  assert.equal(at({ ircFlag: '1', text: ' waves ...' }), 'public');
});

test('classify treats the "_" placeholder toUser as no recipient (TDF-0012)', () => {
  const body = (over) => ({ ...parseBody('av.gif|#000|12px|verdana|hi|0|0'), ...over });
  const at = (toUser, over = {}) => classify({ targetDiv: 'chatContainer', toUser, body: body(over) }, lang);
  assert.equal(at('_'), 'public');
  assert.equal(at(''), 'public');
  assert.equal(at('bob'), 'whisper');
  const prefixed = { ircFlag: '1', text: ' &#187; bob: psst' };
  assert.equal(at('', prefixed), 'whisper');
  assert.equal(at('_', prefixed), 'whisper');
});

test('isWhisper requires the main room for a toUser whisper', () => {
  const body = { text: 'hi', ircFlag: '0' };
  assert.equal(isWhisper({ targetDiv: 'chatContainer', toUser: 'bob', body }), true);
  assert.equal(isWhisper({ targetDiv: 'pcontent_bob', toUser: 'bob', body }), false);
  assert.ok(NO_RECIPIENT.has('_') && NO_RECIPIENT.has(''));
});

test('whisperTarget reads the recipient from the prefix', () => {
  assert.equal(whisperTarget(' &#187; bob%20smith: psst'), 'bob smith');
  assert.equal(whisperTarget('hello'), '');
});

test('isDelete returns the targeted mTime', () => {
  assert.equal(isDelete('av|#000|12px|verdana|DELETEMESSAGE_1761500000|0|0'), '1761500000');
  assert.equal(isDelete('av|#000|12px|verdana|[b]DELETEMESSAGE_1761500000 [/b]|0|0'), '1761500000');
  assert.equal(isDelete('av|#000|12px|verdana|hello|0|0'), null);
});
