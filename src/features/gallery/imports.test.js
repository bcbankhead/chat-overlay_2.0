// Narrowing guard (TDF-0043, Vector 18): the gallery reaches the composer only through its typed
// seam, composer/api.js. Any other gallery import from ../composer/ fails here.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every module specifier a source names: static imports and re-exports, and dynamic import(). */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

test('gallery modules import from the composer only through composer/api.js', () => {
  const files = readdirSync(here).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  assert.ok(files.includes('start.js'), 'the scan reads the gallery folder');
  /** @type {string[]} */
  const offending = [];
  for (const file of files) {
    const source = readFileSync(path.join(here, file), 'utf8');
    for (const [, , spec] of source.matchAll(SPECIFIER)) {
      const resolved = path.posix.normalize(path.posix.join('gallery', spec));
      if (resolved.startsWith('composer/') && resolved !== 'composer/api.js') offending.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(offending, []);
});

test('the scan catches a composer import other than api.js', () => {
  const source = "import { uploadShare } from '../composer/share.js';\nimport { stageAttachment } from '../composer/api.js';";
  const specs = [...source.matchAll(SPECIFIER)].map((m) => path.posix.normalize(path.posix.join('gallery', m[2])));
  assert.deepEqual(specs, ['composer/share.js', 'composer/api.js']);
});
