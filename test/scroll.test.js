import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atBottom } from '../src/core/scroll.js';

test('exactly at the bottom is pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 300, clientHeight: 200 }), true);
});

test('one pixel off the bottom still counts as pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 299, clientHeight: 200 }), true);
});

test('scrolled up is not pinned', () => {
  assert.equal(atBottom({ scrollHeight: 500, scrollTop: 100, clientHeight: 200 }), false);
});
