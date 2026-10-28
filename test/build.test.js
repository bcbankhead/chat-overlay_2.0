import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, checkGrantNone, checkSecondCopyInert } from '../build.mjs';

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

/** A temp root with the real core and one feature whose index.js is `source`. */
function rootWith(source) {
  const root = mkdtempSync(path.join(tmpdir(), 'tdf-build-'));
  cpSync(path.join(repo, 'src', 'core'), path.join(root, 'src', 'core'), { recursive: true });
  cpSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  if (source !== undefined) {
    mkdirSync(path.join(root, 'src', 'features', 'stub'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'features', 'stub', 'index.js'), source);
  }
  return root;
}

test('one build emits the site include beside the userscript, from the same bundle', async () => {
  const root = rootWith("import { onInbound } from '../../core/events.js';\nonInbound(() => {});\n");
  try {
    const { outputs } = await build({ root, outfile: path.join(root, 'dist', 'tdf-chat.user.js') });
    assert.equal(outputs.include, path.join(root, 'dist', 'tdf-chat.js'));
    const userscript = readFileSync(outputs.userscript, 'utf8');
    const include = readFileSync(outputs.include, 'utf8');
    assert.ok(!include.includes('==UserScript=='));
    assert.match(include.split('\n')[0], /^\/\/ TDF Chat 2\.0 v\d+\.\d+\.\d+ — site include build/);
    const body = (code, skip) => code.split('\n').slice(skip).join('\n');
    assert.equal(body(include, 1), body(userscript, userscript.split('\n').indexOf('// ==/UserScript==') + 1));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the build fails when an output uses a userscript-manager API', async () => {
  for (const call of ["GM_log('x');", "GM.info;", "unsafeWindow.x = 1;"]) {
    const root = rootWith(`${call}\n`);
    try {
      await assert.rejects(build({ root }), /uses a userscript-manager API/, call);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the build fails when a second copy would not be inert', async () => {
  const root = rootWith("window.addEventListener('load', () => {});\n");
  try {
    await assert.rejects(build({ root }), /a second copy is not inert \(window\.addEventListener read\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a feature with its own load flag passes the second-copy check', async () => {
  const root = rootWith(
    "if (!window.__tdfChat2Stub) { window.__tdfChat2Stub = true; window.addEventListener('load', () => {}); }\n",
  );
  try {
    await build({ root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the header check accepts only a single @grant none', () => {
  const header = (...lines) => ['// ==UserScript==', '// @name x', ...lines, '// ==/UserScript==', '(() => {})();'].join('\n');
  assert.deepEqual(checkGrantNone(header('// @grant        none')), []);
  assert.match(checkGrantNone(header())[0], /no @grant/);
  assert.match(checkGrantNone(header('// @grant GM_xmlhttpRequest'))[0], /GM_xmlhttpRequest/);
  assert.match(checkGrantNone(header('// @grant none', '// @grant GM_info'))[0], /none, GM_info/);
  assert.match(checkGrantNone('(() => {})();')[0], /no userscript metadata header/);
});

test('the second-copy check flags code that runs past the guard', () => {
  assert.deepEqual(checkSecondCopyInert('(() => { if (!window.__tdfChat2Loaded) document.title = "x"; })();'), []);
  assert.match(checkSecondCopyInert('(() => { document.title = "x"; })();')[0], /document\.title written/);
  assert.match(checkSecondCopyInert('"onload" in window;')[0], /window\.onload tested/);
  assert.match(checkSecondCopyInert('delete window.x;')[0], /window\.x deleted/);
  assert.match(checkSecondCopyInert('Object.defineProperty(window, "y", { value: 1 });')[0], /window\.y defined/);
  assert.match(checkSecondCopyInert('getComputedStyle(document.body);')[0], /threw: getComputedStyle is not defined/);
  assert.match(checkSecondCopyInert('throw { code: 1 };')[0], /threw: \{"code":1\}/);
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
