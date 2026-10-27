import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeError } from '../src/core/errors.js';

test('describeError renders errors, strings and objects readably', () => {
  assert.equal(describeError(new Error('boom')), 'boom');
  assert.equal(describeError(new TypeError('')), 'TypeError');
  assert.equal(describeError('plain'), 'plain');
  assert.equal(describeError({ code: 7 }), '{"code":7}');
  assert.equal(describeError(undefined), 'unknown error');
  assert.equal(describeError(new AggregateError([new Error('a'), 'b'])), 'a; b');
});

test('describeError describes unserialisable values readably', () => {
  const cyclic = { code: 7 };
  cyclic.self = cyclic;
  const throwing = { code: 7, toJSON: () => { throw new Error('no'); } };
  const cases = [
    [cyclic, '{"code":7,"self":"[Circular]"}'],
    [{ size: 10n }, '{"size":"10n"}'],
    [10n, '10n'],
    [throwing, 'Object { code, toJSON }'],
  ];
  for (const [value, expected] of cases) {
    const text = describeError(value);
    assert.equal(text, expected);
    assert.ok(!text.includes('[object Object]'), text);
  }
});
