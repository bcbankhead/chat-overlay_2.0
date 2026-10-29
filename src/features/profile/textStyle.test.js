import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorList, colorRows, fontList, sameChoice, statusIndex, styleCookie } from './textStyle.js';

test('styleCookie writes the six fields in the order cookie.js.php reads them back', () => {
  const value = styleCookie({ mBold: 1, mItalic: 0, mUnderline: 0, textColor: '#FF3300', textSize: '12px', textFamily: 'Comic Sans MS' });
  assert.equal(value, encodeURI('1|0|0|#FF3300|12px|Comic Sans MS'));
  // cookie.js.php:62-72: decodeURI, split on '|', then mBold, mItalic, mUnderline, textColor, textSize, textFamily.
  const [mBold, mItalic, mUnderline, textColor, textSize, textFamily] = decodeURI(value).split('|');
  assert.deepEqual({ mBold, mItalic, mUnderline, textColor, textSize, textFamily }, {
    mBold: '1', mItalic: '0', mUnderline: '0', textColor: '#FF3300', textSize: '12px', textFamily: 'Comic Sans MS',
  });
});

test('styleCookie writes a missing field as empty, keeping the field count', () => {
  const value = styleCookie({ mBold: 0, mItalic: 0, mUnderline: 0, textColor: undefined, textSize: '12px', textFamily: 'Arial' });
  assert.equal(decodeURI(value).split('|').length, 6);
});

test('fontList and colorList drop empty and non-string entries', () => {
  assert.deepEqual(fontList(['Arial', '', 'Verdana', undefined]), ['Arial', 'Verdana']);
  assert.deepEqual(colorList(['#000000', '', '#FFFFFF']), ['#000000', '#FFFFFF']);
  assert.deepEqual(fontList(undefined), []);
});

test('colorRows makes rows of 12, the last one short', () => {
  const colors = Array.from({ length: 108 }, (_, i) => `#${i}`);
  const rows = colorRows(colors);
  assert.equal(rows.length, 9);
  assert.ok(rows.every((r) => r.length === 12));
  assert.deepEqual(colorRows(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
});

test('sameChoice matches case-insensitively and only strings', () => {
  assert.equal(sameChoice('verdana', 'Verdana'), true);
  assert.equal(sameChoice('#ff3300', '#FF3300'), true);
  assert.equal(sameChoice('Arial', 'Verdana'), false);
  assert.equal(sameChoice(undefined, 'Arial'), false);
});

test('statusIndex reads 1..3 and defaults to Here', () => {
  assert.equal(statusIndex('2'), 2);
  assert.equal(statusIndex('3'), 3);
  assert.equal(statusIndex('1'), 1);
  assert.equal(statusIndex('0'), 1);
  assert.equal(statusIndex(null), 1);
  assert.equal(statusIndex('x'), 1);
});
