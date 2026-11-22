#!/usr/bin/env node
/**
 * Simulation LOCALE de Vercel pour vérifier la sortie de scripts/vercel-build.mjs sans compte Vercel : même routage
 * (config.json), mêmes en-têtes, même fonction. Ce n'est PAS Vercel (pas de pooleur, de CDN ni de limites de durée) :
 * une validation sur un vrai déploiement « staging » reste indispensable.
 *
 *   node scripts/vercel-build.mjs
 *   NODE_ENV=production APP_ENV=staging DATABASE_URL_APP=… DATABASE_URL_PLATFORM=… CSRF_SECRET=… ENCRYPTION_KEY=… \
 *   ALLOWED_ORIGINS=http://127.0.0.1:4300 TRUST_PROXY=true node scripts/vercel-preview.mjs      → http://127.0.0.1:4300
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.vercel', 'output');
const config = JSON.parse(readFileSync(join(OUT, 'config.json'), 'utf8'));
const { default: handler } = await import(pathToFileURL(join(OUT, 'functions', 'api.func', 'index.mjs')).href);
const PORT = Number(process.env.PREVIEW_PORT ?? 4300);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

const staticFile = (p) => {
  const file = normalize(join(OUT, 'static', p));
  return file.startsWith(join(OUT, 'static')) && existsSync(file) && statSync(file).isFile() ? file : null;
};

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  let dest = null;
  let file = null;
  for (const route of config.routes) {
    if (route.handle === 'filesystem') { file = staticFile(path); if (file) break; continue; }
    if (!new RegExp(`^${route.src}$`).test(path)) continue;
    for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v);
    if (route.dest) { dest = route.dest; break; }
  }
  if (dest === '/api') return void handler(req, res);
  file ??= dest ? staticFile(dest.replace(/^\//, '')) : null;
  if (!file) { res.statusCode = 404; return void res.end('Not found'); }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Simulation Vercel : http://127.0.0.1:${PORT}`));
