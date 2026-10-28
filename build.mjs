// One build command: `npm run build` → dist/tdf-chat.user.js (userscript) and dist/tdf-chat.js
// (site include), from the same entry; only the banner and the output file differ.
// The entry is virtual: src/core/bootstrap.js, then every src/features/*/index.js found, so
// no slice edits a shared entry file (TDF-0009 Shared Contract, Build).
// Both outputs are checked after building, and the build fails on any wrong state.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** @param {string} root */
function userscriptBanner(root) {
  return [
    '// ==UserScript==',
    '// @name         TDF Chat 2.0',
    '// @namespace    https://github.com/bcbankhead/chat-overlay_2.0',
    `// @version      ${version(root)}`,
    '// @description  Modern message view with local chat history for the TDF chat',
    '// @match        https://dollforum.com/forum/chat/*',
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
  try {
    vm.runInNewContext(code, { window: recorder('window'), document: recorder('document') });
  } catch (err) {
    // The error comes from the vm's realm, so `instanceof Error` is false for it.
    const message = /** @type {{ message?: unknown }} */ (err)?.message;
    touched.push(`threw: ${typeof message === 'string' ? message : JSON.stringify(err)}`);
  }
  return touched.map((t) => `a second copy is not inert (${t})`);
}

/**
 * @param {string} file
 * @param {{ userscript: boolean }} kind
 */
function verify(file, { userscript }) {
  const code = readFileSync(file, 'utf8');
  const problems = [
    ...checkNoManagerApi(code),
    ...(userscript ? checkGrantNone(code) : []),
    ...checkSecondCopyInert(code),
  ];
  if (problems.length) throw new Error(`${path.basename(file)} failed its build checks:\n  ${problems.join('\n  ')}`);
}

/**
 * @param {{ root?: string, outfile?: string }} [options]
 *   `outfile` is the userscript; the include is written as `tdf-chat.js` beside it.
 */
export async function build({ root = path.dirname(fileURLToPath(import.meta.url)), outfile } = {}) {
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
    plugins: [virtualEntry],
    logLevel: 'warning',
  };
  const userscript = outfile ?? path.join(root, 'dist', 'tdf-chat.user.js');
  const include = path.join(path.dirname(userscript), 'tdf-chat.js');
  await esbuild.build({ ...options, banner: { js: userscriptBanner(root) }, outfile: userscript });
  await esbuild.build({ ...options, banner: { js: includeBanner(root) }, outfile: include });

  verify(userscript, { userscript: true });
  verify(include, { userscript: false });
  return { features, outputs: { userscript, include } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { features } = await build();
    console.log(`built dist/tdf-chat.user.js and dist/tdf-chat.js (features: ${features.join(', ') || 'none'})`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
