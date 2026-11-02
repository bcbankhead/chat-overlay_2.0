import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockHeads, blockLabel } from '../src/core/blockGroups.js';

test('no block ids, no blocks', () => {
  assert.deepEqual(blockHeads([]), []);
  assert.deepEqual(blockHeads([undefined, '', undefined]), []);
});

test("each block's first row and row count, in order of first appearance", () => {
  assert.deepEqual(blockHeads([undefined, 'a', 'a', undefined, 'b', 'a', 'b']), [
    { block: 'a', index: 1, count: 3 },
    { block: 'b', index: 4, count: 2 },
  ]);
});

test('the header label counts the rows', () => {
  assert.equal(blockLabel(7), "From the chat's server history (7)");
});
