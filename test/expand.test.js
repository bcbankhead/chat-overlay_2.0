import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expand } from '../src/core/expand.js';

test('bbcode and [[ ]] expand to tags', () => {
  assert.equal(expand('[b]x[/b] [i]y[/i] [u]z[/u]'), '<b>x</b> <i>y</i> <u>z</u>');
  assert.equal(expand('[[br]]'), '<br>');
});

test('&#127; becomes a literal pipe', () => {
  assert.equal(expand('a&#127;b'), 'a|b');
});

test('urls and emails are auto-linked', () => {
  assert.equal(expand('see https://x.test/a'), "see <a href='https://x.test/a' target='_blank'>https://x.test/a</a>");
  assert.equal(expand('me@x.test'), "<a href='mailto:me@x.test'>me@x.test</a>");
  assert.equal(expand('https://x.test', { enableUrl: false }), 'https://x.test');
});

test('smilies are delegated to the injected function', () => {
  const smilie = (t) => t.split(':h').join('<img src="smilies/heart.gif">');
  assert.equal(expand('love :h', { smilie }), 'love <img src="smilies/heart.gif">');
});

test('youtu.be renders as a plain link, not an iframe', () => {
  const html = expand('http://youtu.be/abc123');
  assert.ok(!html.includes('iframe'));
  assert.ok(html.includes("href='https://youtu.be/abc123'"));
});

test('the final decodeURIComponent is applied, and tolerated when malformed', () => {
  assert.equal(expand('caf%C3%A9'), 'café');
  assert.equal(expand('100%'), '100%');
});
