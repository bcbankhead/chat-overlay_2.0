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
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(describeError(cyclic), '[object Object]');
});
