// Serves the local harness on http://localhost:<port>/ (default 5173).
// /tdf-chat.user.js is read fresh on every request from <worktree>/dist, so a rebuild in
// that worktree shows on reload. /gallery/ serves a folder of placeholder images for the
// gallery mockup; /gallery/index.json lists them as { url, size, mtime }.
// Usage: node local/serve.mjs <worktree> [port] [gallery dir]

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 5173);
const gallery = process.argv[4] ? path.resolve(process.argv[4]) : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.php': 'text/javascript; charset=utf-8',
  '.download': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const IMAGE = /\.(gif|jpe?g|png|webp)$/i;

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (url === '/gallery/index.json') {
    const names = gallery ? (await readdir(gallery).catch(() => [])).filter((n) => IMAGE.test(n)).sort() : [];
    const list = await Promise.all(
      names.map(async (n) => {
        const st = await stat(path.join(gallery, n));
        return { url: '/gallery/' + encodeURIComponent(n), size: st.size, mtime: st.mtimeMs };
      }),
    );
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }

  const file =
    url === '/' ? path.join(here, 'harness.html')
    : url === '/tdf-chat.user.js' ? path.join(worktree, 'dist', 'tdf-chat.user.js')
    : gallery && url.startsWith('/gallery/') ? path.join(gallery, path.basename(url))
    : path.join(here, path.normalize(url));
  const allowed = [here, worktree, gallery].filter(Boolean);
  if (!allowed.some((root) => file.startsWith(root))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`harness: http://localhost:${port}/  (overlay from ${path.join(worktree, 'dist')})`);
  if (gallery) console.log(`gallery: ${gallery}`);
});
