// One build command: `npm run build` → dist/tdf-chat.user.js.
// The entry is virtual: src/core/bootstrap.js, then every src/features/*/index.js found, so
// no slice edits a shared entry file (TDF-0009 Shared Contract, Build).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ENTRY = 'tdf-chat:entry';

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
function banner(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return [
    '// ==UserScript==',
    '// @name         TDF Chat 2.0',
    '// @namespace    https://github.com/bcbankhead/chat-overlay_2.0',
    `// @version      ${pkg.version}`,
    '// @description  Modern message view with local chat history for the TDF chat',
    '// @match        https://dollforum.com/forum/chat/*',
    '// @grant        none',
    '// @run-at       document-idle',
    '// ==/UserScript==',
  ].join('\n');
}

/**
 * @param {{ root?: string, outfile?: string }} [options]
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

  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    loader: { '.css': 'text' },
    banner: { js: banner(root) },
    plugins: [virtualEntry],
    outfile: outfile ?? path.join(root, 'dist', 'tdf-chat.user.js'),
    logLevel: 'warning',
  });
  return { features };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { features } = await build();
  console.log(`built dist/tdf-chat.user.js (features: ${features.join(', ') || 'none'})`);
}
