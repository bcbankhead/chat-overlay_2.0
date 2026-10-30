import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findFeatures } from '../build.mjs';
import { createReadyGate } from '../src/core/reveal.js';

test('the gate opens once, after every registered participant reports', () => {
  const gate = createReadyGate();
  const core = gate.expectReady('core');
  const rail = gate.expectReady('rail');
  let opened = 0;
  gate.whenAllReady(() => (opened += 1));
  assert.equal(opened, 0);
  assert.deepEqual(gate.pendingNames(), ['core', 'rail']);
  rail();
  assert.equal(opened, 0);
  assert.deepEqual(gate.pendingNames(), ['core']);
  core();
  assert.equal(opened, 1);
  assert.deepEqual(gate.pendingNames(), []);
  core();
  rail();
  assert.equal(opened, 1, 'a repeated done does not reopen it');
});

test('done is idempotent: a participant reporting twice does not stand in for another', () => {
  const gate = createReadyGate();
  const a = gate.expectReady('a');
  gate.expectReady('b');
  let opened = false;
  gate.whenAllReady(() => (opened = true));
  a();
  a();
  assert.equal(opened, false);
  assert.deepEqual(gate.pendingNames(), ['b']);
});

test('two participants of the same name are counted apart', () => {
  const gate = createReadyGate();
  const first = gate.expectReady('rail');
  gate.expectReady('rail');
  let opened = false;
  gate.whenAllReady(() => (opened = true));
  first();
  assert.equal(opened, false);
  assert.deepEqual(gate.pendingNames(), ['rail']);
});

test('whenAllReady fires at once when nothing is outstanding', () => {
  const gate = createReadyGate();
  gate.expectReady('core')();
  let opened = 0;
  gate.whenAllReady(() => (opened += 1));
  assert.equal(opened, 1);
});

test('every feature entry the build bundles registers with the ready gate', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const names = findFeatures(root);
  assert.ok(names.length > 0);
  for (const name of names) {
    const source = readFileSync(path.join(root, 'src', 'features', name, 'index.js'), 'utf8');
    assert.match(source, /from '\.\.\/\.\.\/core\/reveal\.js'/, `${name}/index.js imports the gate`);
    assert.match(source, new RegExp(`expectReady\\('${name}'\\)`), `${name}/index.js calls expectReady('${name}')`);
  }
});
