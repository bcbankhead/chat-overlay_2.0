import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('build emits the userscript banner and discovers feature modules', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tdf-build-'));
  try {
    cpSync(path.join(repo, 'src', 'core'), path.join(root, 'src', 'core'), { recursive: true });
    cpSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
    mkdirSync(path.join(root, 'src', 'features', 'stub'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'features', 'stub', 'index.js'),
      "import { onInbound } from '../../core/events.js';\nonInbound((r) => console.log('STUB_FEATURE_MARKER', r.id));\n",
    );
    const outfile = path.join(root, 'dist', 'tdf-chat.user.js');
    const { features } = await build({ root, outfile });
    assert.deepEqual(features, ['stub']);
    const out = readFileSync(outfile, 'utf8');
    assert.ok(out.startsWith('// ==UserScript=='));
    assert.match(out, /@match\s+https:\/\/dollforum\.com\/forum\/chat\/\*/);
    assert.match(out, /@grant\s+none/);
    assert.ok(out.includes('STUB_FEATURE_MARKER'));
    // The bootstrap guard runs before any feature module.
    assert.ok(out.indexOf('__tdfChat2Loaded') < out.indexOf('STUB_FEATURE_MARKER'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build succeeds with no feature modules', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tdf-build-'));
  try {
    cpSync(path.join(repo, 'src', 'core'), path.join(root, 'src', 'core'), { recursive: true });
    cpSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
    const { features } = await build({ root, outfile: path.join(root, 'dist', 'out.js') });
    assert.deepEqual(features, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
