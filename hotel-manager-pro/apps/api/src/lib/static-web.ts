import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Sert l'interface web (fichiers construits par Vite) depuis le MÊME serveur que l'API : une seule adresse, un seul processus.
 * Utilisé par l'installation locale (WEB_DIST) ; en ligne, c'est Vercel qui sert les fichiers statiques.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/**
 * En-têtes de sécurité des pages : mêmes règles qu'en ligne (voir scripts/vercel-build.mjs), SANS « strict-transport-security » (le réseau
 * de l'hôtel est en HTTP). Les scripts « inline » de index.html sont autorisés un par un par leur empreinte SHA-256, jamais par « unsafe-inline ».
 */
export function webSecurityHeaders(indexHtml: string): Record<string, string> {
  const hashes = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`);
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  };
}

const statOrNull = (p: string) => { try { return statSync(p); } catch { return null; } };

export function registerWebApp(app: FastifyInstance, webDir: string): void {
  const root = resolve(webDir);
  const index = readFileSync(join(root, 'index.html')); // absent : on s'arrête au démarrage plutôt que de servir des pages vides
  const headers = webSecurityHeaders(index.toString('utf8'));

  // Fichiers statiques : jamais soumis à la limite de requêtes (une page en charge des dizaines) ; l'API garde la sienne.
  app.get('/*', { config: { rateLimit: false }, schema: { hide: true } }, async (req, reply) => {
    const raw = req.url.split('?')[0] ?? '/';
    if (raw === '/api' || raw.startsWith('/api/')) return reply.callNotFound(); // une route d'API inconnue reste une 404 JSON
    let rel: string;
    try { rel = decodeURIComponent(raw); } catch { return reply.callNotFound(); }
    if (rel.includes('\0')) return reply.callNotFound();
    const file = resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + sep)) return reply.callNotFound(); // jamais en dehors du dossier de l'interface
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    if (statOrNull(file)?.isFile()) {
      reply.header('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
      reply.header('cache-control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.send(createReadStream(file));
    }
    if (extname(rel)) return reply.callNotFound(); // fichier (image, script…) absent : pas de repli sur la page d'accueil
    // Page de l'application (routage côté navigateur) : toujours index.html
    reply.header('content-type', TYPES['.html']!).header('cache-control', 'no-store');
    return reply.send(index);
  });
}
