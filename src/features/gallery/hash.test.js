import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Hex } from './hash.js';

test('sha256Hex matches the FIPS 180-2 vector for "abc"', async () => {
  assert.equal(
    await sha256Hex(new Blob(['abc'])),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('different bytes hash differently; equal bytes hash the same', async () => {
  const a = await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(await sha256Hex(new Blob([new Uint8Array([1, 2, 3])])), a);
  assert.notEqual(await sha256Hex(new Blob([new Uint8Array([1, 2, 4])])), a);
});
