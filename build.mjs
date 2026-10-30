// One build command: `npm run build` → dist/tdf-chat.user.js (userscript) and dist/tdf-chat.js
// (site include), from the same entry; only the banner and the output file differ.
// The entry is virtual: src/core/bootstrap.js, then every src/features/*/index.js found, so
// no slice edits a shared entry file (TDF-0009 Shared Contract, Build).
// Both outputs are checked before either is written, and the build fails on any wrong state.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

const ENTRY = 'tdf-chat:entry';
const FLAG_PREFIX = '__tdfChat2';

/** @param {string} root */
export function findFeatures(root) {
  const dir = path.join(root, 'src', 'features');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'index.js')))
    .map((d) => d.name)
    .sort();
}

/** @param {string} root */
function version(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/**
 * The userscript's @match, from the untracked build.local.json beside build.mjs, so the
 * real host never enters the repo. build.local.example.json is the committed template.
 * @param {string} root
 * @returns {string}
 */
export function readMatch(root) {
  const file = path.join(root, 'build.local.json');
  if (!existsSync(file)) {
    throw new Error('build.local.json not found; copy build.local.example.json to build.local.json and set "match"');
  }
  /** @type {unknown} */
  let config;
  try {
    // Windows PowerShell 5.1 and some editors write a UTF-8 BOM, which JSON.parse rejects.
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`build.local.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const match = /** @type {{ match?: unknown } | null} */ (config)?.match;
  if (!isMatch(match)) {
    throw new Error('build.local.json must set "match" to a non-empty, single-line string');
  }
  return match;
}

/**
 * A usable @match: a non-empty string on one line, so nothing else can enter the header.
 * @param {unknown} match
 * @returns {match is string}
 */
function isMatch(match) {
  return typeof match === 'string' && match.trim() !== '' &&!/[\r\n]/.test(match);
}

/** @param {string} root @param {string} match */
function userscriptBanner(root, match) {
  return [
    '// ==UserScript==',
    '// @name         TDF Chat 2.0',
    '// @namespace    https://github.com/bcbankhead/chat-overlay_2.0',
    `// @version      ${version(root)}`,
    '// @description  Modern message view with local chat history for the TDF chat',
    `// @match        ${match}`,
    '// @grant        none',
    '// @run-at       document-idle',
    '// ==/UserScript==',
  ].join('\n');
}

/** @param {string} root */
function includeBanner(root) {
  return `// TDF Chat 2.0 v${version(root)} — site include build (https://github.com/bcbankhead/chat-overlay_2.0)`;
}

/**
 * The page-only contract (TDF-0009 Shared Contract): no userscript-manager API, in either output.
 * @param {string} code
 * @returns {string[]}
 */
export function checkNoManagerApi(code) {
  return code
    .split('\n')
    .flatMap((line, i) => (/\bGM[_.]|\bunsafeWindow\b/.test(line) ? [`line ${i + 1} uses a userscript-manager API: ${line.trim()}`] : []));
}

/**
 * The userscript must run unsandboxed: any grant other than `none` gives it its own `window`,
 * and the include would no longer see its `__tdfChat2Loaded` flag.
 * @param {string} code
 * @returns {string[]}
 */
export function checkGrantNone(code) {
  const header = /\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==/.exec(code);
  if (!header) return ['no userscript metadata header'];
  const grants = [...header[1].matchAll(/^\/\/\s*@grant\s+(.*?)\s*$/gm)].map((m) => m[1]);
  if (grants.length === 1 && grants[0] === 'none') return [];
  return [`the header must grant exactly "none", found: ${grants.length ? grants.join(', ') : 'no @grant'}`];
}

/**
 * The double-load guard, checked by behaviour rather than statement order: esbuild emits
 * imported modules' declarations ahead of bootstrap.js's body, so the guard is not literally
 * the bundle's first statement. Instead the bundle runs as a second copy would — every
 * `__tdfChat2*` flag already set — and must touch nothing else on `window` or `document`.
 * `globalThis`, `self` and `top` are the window, as in a page; a bare global write and work
 * queued as a microtask are caught too. Timers and other Web APIs are absent, so using one
 * before the guard fails as "not defined".
 * @param {string} code
 * @returns {string[]}
 */
export function checkSecondCopyInert(code) {
  /** @type {string[]} */
  const touched = [];
  /** @param {string} name */
  const recorder = (name) =>
    new Proxy(
      {},
      {
        get(_, key) {
          if (name === 'window' && typeof key === 'string' && key.startsWith(FLAG_PREFIX)) return true;
          touched.push(`${name}.${String(key)} read`);
          return undefined;
        },
        set(_, key) {
          touched.push(`${name}.${String(key)} written`);
          return true;
        },
        has(_, key) {
          touched.push(`${name}.${String(key)} tested`);
          return false;
        },
        defineProperty(_, key) {
          touched.push(`${name}.${String(key)} defined`);
          return true;
        },
        deleteProperty(_, key) {
          touched.push(`${name}.${String(key)} deleted`);
          return true;
        },
      },
    );
  const window = recorder('window');
  /** @type {Record<string, unknown>} */
  const sandbox = { window, document: recorder('document'), globalThis: window, self: window, top: window };
  const own = new Set(Object.keys(sandbox));
  try {
    vm.runInNewContext(code, sandbox, { microtaskMode: 'afterEvaluate' });
  } catch (err) {
    // The error comes from the vm's realm, so `instanceof Error` is false for it.
    const message = /** @type {{ message?: unknown }} */ (err)?.message;
    touched.push(`threw: ${typeof message === 'string' ? message : JSON.stringify(err)}`);
  }
  for (const key of Object.keys(sandbox)) if (!own.has(key)) touched.push(`global ${key} written`);
  return touched.map((t) => `a second copy is not inert (${t})`);
}

/**
 * Every check for one output, as `<name>: <problem>` lines.
 * @param {string} name
 * @param {string} code
 * @param {{ userscript: boolean }} kind
 * @returns {string[]}
 */
export function verify(name, code, { userscript }) {
  return [
    ...checkNoManagerApi(code),
    ...(userscript ? checkGrantNone(code) : []),
    ...checkSecondCopyInert(code),
  ].map((problem) => `${name}: ${problem}`);
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ match: string, root?: string, outfile?: string }} options
 *   `match` is the userscript's @match (the CLI reads it with readMatch); `outfile` is the
 *   userscript, and the include is written as `tdf-chat.js` beside it.
 */
export async function build({ match, root = ROOT, outfile } = /** @type {any} */ ({})) {
  if (!isMatch(match)) {
    throw new Error('build() needs a non-empty, single-line "match" option');
  }
  const features = findFeatures(root);
  const entry = [
    `import './src/core/bootstrap.js';`,
    ...features.map((name) => `import './src/features/${name}/index.js';`),
  ].join('\n');

  /** @type {esbuild.Plugin} */
  const virtualEntry = {
    name: 'tdf-chat-entry',
    setup(b) {
      b.onResolve({ filter: /^tdf-chat:entry$/ }, () => ({ path: ENTRY, namespace: 'tdf-chat' }));
      b.onLoad({ filter: /.*/, namespace: 'tdf-chat' }, () => ({ contents: entry, resolveDir: root, loader: 'js' }));
    },
  };

  /** @type {esbuild.BuildOptions} */
  const options = {
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    loader: { '.css': 'text' },
    // The Settings flyout shows this, so a member can tell which build is loaded.
    define: { __TDF_CHAT_VERSION__: JSON.stringify(version(root)) },
    plugins: [virtualEntry],
    logLevel: 'warning',
  };
  const userscript = outfile ?? path.join(root, 'dist', 'tdf-chat.user.js');
  const include = path.join(path.dirname(userscript), 'tdf-chat.js');
  // Built in memory and written only once both pass, so a failed build leaves nothing to upload.
  /** @param {string} banner @param {string} file */
  const bundle = async (banner, file) =>
    (await esbuild.build({ ...options, banner: { js: banner }, outfile: file, write: false })).outputFiles[0].text;
  const userscriptCode = await bundle(userscriptBanner(root, match), userscript);
  const includeCode = await bundle(includeBanner(root), include);

  const problems = [
    ...verify(path.basename(userscript), userscriptCode, { userscript: true }),
    ...verify(path.basename(include), includeCode, { userscript: false }),
  ];
  if (problems.length) throw new Error(`the build failed its checks; nothing was written:\n  ${problems.join('\n  ')}`);
  mkdirSync(path.dirname(userscript), { recursive: true });
  writeFileSync(userscript, userscriptCode);
  writeFileSync(include, includeCode);
  return { features, outputs: { userscript, include } };
}

/**
 * The `npm run build` entry: reads the match from `root`'s build.local.json and builds there.
 * Reports any failure on stderr and returns the process exit code.
 * @param {string} [root]
 * @returns {Promise<number>}
 */
export async function main(root = ROOT) {
  try {
    const { features } = await build({ match: readMatch(root), root });
    console.log(`built dist/tdf-chat.user.js and dist/tdf-chat.js (features: ${features.join(', ') || 'none'})`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
