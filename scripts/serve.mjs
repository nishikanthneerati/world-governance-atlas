#!/usr/bin/env node
/**
 * Local server for World Governance Atlas.
 *   node scripts/serve.mjs            -> http://localhost:8080
 *   PORT=3000 node scripts/serve.mjs
 * Serves the site and re-runs the data fetch once a day while it is running
 * (set REFRESH_HOURS=0 to turn that off). No dependencies.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8080;
const REFRESH_HOURS = process.env.REFRESH_HOURS != null ? +process.env.REFRESH_HOURS : 24;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || /[\\/](\.git|node_modules)[\\/]/.test(file)) throw new Error('forbidden');
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`World Governance Atlas: http://localhost:${PORT}`));

let running = false;
function refresh() {
  if (running) return;
  running = true;
  console.log(`[${new Date().toISOString()}] Refreshing data (takes ~30 min)…`);
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch-data.mjs')], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    console.log(`[${new Date().toISOString()}] Data refresh ${code === 0 ? 'finished' : `failed (exit ${code}); the previous data is still served`}.`);
  });
}
if (REFRESH_HOURS > 0) {
  setInterval(refresh, REFRESH_HOURS * 3600e3);
  console.log(`Data refreshes every ${REFRESH_HOURS} h while this is running.`);
}
