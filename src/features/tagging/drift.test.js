// Copies this slice keeps of another module's code, because the owner does not export it and
// is outside this slice's Touch Set. Each test fails when the copies diverge.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (/** @type {string} */ rel) => readFileSync(path.join(here, rel), 'utf8');

test('a failure notice uses the view\'s own notice markup (core/view.js)', () => {
  const view = read('../../core/view.js');
  const start = read('start.js');
  for (const line of ["el.className = 'tdf-msg tdf-kind-system tdf-notice';", "el.setAttribute('role', 'status');"]) {
    assert.ok(view.includes(line), `view.js lost: ${line}`);
    assert.ok(start.includes(line), `start.js lost: ${line}`);
  }
});
