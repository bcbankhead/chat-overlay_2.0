import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXED_SMILIES, fixedSmilieSrc } from '../src/core/smiliefix.js';

test('the three matted smilies have cleaned GIF copies', () => {
  assert.deepEqual(Object.keys(FIXED_SMILIES).sort(), ['biggrin.gif', 'loveit.gif', 'omg.gif']);
  for (const [name, uri] of Object.entries(FIXED_SMILIES)) {
    const [, b64] = /^data:image\/gif;base64,(.+)$/.exec(uri) ?? [];
    assert.ok(b64, name);
    assert.equal(Buffer.from(b64, 'base64').toString('latin1', 0, 6), 'GIF89a', name);
  }
});

test('fixedSmilieSrc swaps a matted smilie by file name, wherever it is served from', () => {
  assert.equal(fixedSmilieSrc('smilies/biggrin.gif'), FIXED_SMILIES['biggrin.gif']);
  assert.equal(fixedSmilieSrc('https://chat.example.com/forum/chat/smilies/omg.gif?v=2'), FIXED_SMILIES['omg.gif']);
  assert.equal(fixedSmilieSrc('../smilies/loveit.gif'), FIXED_SMILIES['loveit.gif']);
});

test('fixedSmilieSrc leaves every other source alone', () => {
  for (const src of ['smilies/smile.gif', 'biggrin.gif', 'avatars/biggrin.gif', 'smilies/toString', '', 'smilies/biggrin.gif/x']) {
    assert.equal(fixedSmilieSrc(src), src);
  }
});
