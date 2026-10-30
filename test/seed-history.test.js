import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { MAIN_DIV, WHISPER_PREFIX, isWhisper } from '../src/core/parse.js';

// The mockup's seed-history.js is a classic script loaded by the saved page, so it cannot
// import parse.js; it carries copies instead. Evaluate it and pin the copies to the source.
function loadSeedHistory() {
  const source = readFileSync(new URL('../reference/mockup/mockup/seed-history.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  return context;
}

test('drift: seed-history WHISPER_PREFIX matches parse.js', () => {
  assert.equal(loadSeedHistory().WHISPER_PREFIX, WHISPER_PREFIX);
});

test('drift: seed-history isStaleWhisper matches the db.js v3 rule built on isWhisper', () => {
  const { isStaleWhisper } = loadSeedHistory();
  const echo = `${WHISPER_PREFIX}Bob: hi`;
  const records = [
    { kind: 'whisper', toUser: '_', ircFlag: '0', text: 'hi' },
    { kind: 'whisper', toUser: '', ircFlag: '0', text: 'hi' },
    { kind: 'whisper', toUser: 'Bob', ircFlag: '0', text: 'hi' },
    { kind: 'whisper', toUser: '', ircFlag: '1', text: echo },
    { kind: 'whisper', toUser: '_', ircFlag: '1', text: echo },
    { kind: 'whisper', toUser: '', ircFlag: '0', text: echo },
    { kind: 'whisper', toUser: '', ircFlag: '1', text: 'hi' },
    { kind: 'whisper', toUser: '_', ircFlag: '0' },
    { kind: 'whisper', toUser: 'Bob', ircFlag: '0' },
    ...['public', 'system', 'entry', 'exit'].flatMap((kind) => [
      { kind, toUser: '', ircFlag: '0', text: 'hi' },
      { kind, toUser: '_', ircFlag: '0', text: 'hi' },
      { kind, toUser: 'Bob', ircFlag: '0', text: 'hi' },
      { kind, toUser: '', ircFlag: '1', text: echo },
    ]),
  ];
  for (const r of records) {
    const expected = r.kind === 'whisper' && !isWhisper({ targetDiv: MAIN_DIV, toUser: r.toUser, body: r });
    assert.equal(isStaleWhisper(r), expected, JSON.stringify(r));
  }
});
