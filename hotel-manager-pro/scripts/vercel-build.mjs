#!/usr/bin/env node
/**
 * Construction pour Vercel (« Build Output API v3 ») : UN SEUL projet Vercel sert l'interface (fichiers statiques) ET l'API
 * (une fonction Node.js, la même application Fastify que le serveur permanent). Même origine => cookies de session sécurisés,
 * pas de CORS, et les variables d'environnement propres à chaque environnement s'appliquent aux deux.
 *
 *   node scripts/vercel-build.mjs        (lancé par Vercel : voir vercel.json ; utilisable en local pour vérifier)
 *
 * Produit .vercel/output/ :
 *   static/                       l'interface construite (apps/web/dist)
 *   functions/api.func/           l'API : index.mjs (notre code, regroupé par esbuild) + node_modules (bibliothèques tierces)
 *   config.json                   routage, en-têtes de sécurité, cache
 * Rien n'est exécuté ici côté base de données : les migrations sont appliquées par la CI (voir .github/workflows/migrate.yml).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.vercel', 'output');
const FUNC = join(OUT, 'functions', 'api.func');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
const step = (m) => console.log(`\n▸ ${m}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FUNC, { recursive: true });

step("Interface web (vérification des types puis construction)");
run('pnpm', ['--filter', '@hmp/web', 'build']);
cpSync(join(ROOT, 'apps', 'web', 'dist'), join(OUT, 'static'), { recursive: true });

step('API : regroupement de notre code (esbuild)');
// Bibliothèques tierces laissées EXTERNES (modules natifs comme argon2, fichiers de polices de pdfkit…) ; les paquets du dépôt (@hmp/*) sont inclus.
const thirdParty = new Set();
for (const dir of ['apps/api', 'packages/db', 'packages/shared']) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.dependencies ?? {})) if (!name.startsWith('@hmp/')) thirdParty.add(name);
}
const { build } = createRequire(join(ROOT, 'apps', 'api', 'package.json'))('esbuild');
await build({
  entryPoints: [join(ROOT, 'apps', 'api', 'src', 'vercel.ts')],
  outfile: join(FUNC, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...thirdParty].flatMap((n) => [n, `${n}/*`]),
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

step('API : bibliothèques tierces de production (pnpm deploy, structure à plat)');
const tmp = join(OUT, '_deploy');
run('pnpm', ['--filter', '@hmp/api', '--config.node-linker=hoisted', 'deploy', '--prod', '--legacy', tmp]);
cpSync(join(tmp, 'node_modules'), join(FUNC, 'node_modules'), { recursive: true });
rmSync(join(FUNC, 'node_modules', '@hmp'), { recursive: true, force: true }); // déjà regroupés dans index.mjs
rmSync(tmp, { recursive: true, force: true });

writeFileSync(join(FUNC, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(FUNC, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false, // l'API lit les requêtes Node brutes : aucun « helper » Vercel ne doit toucher au corps
  maxDuration: 30,
  // Région de la fonction = région de la base (sinon chaque requête SQL traverse un océan). Défaut : Francfort (fra1) ↔ Neon aws-eu-central-1.
  regions: [process.env.HMP_FUNCTION_REGION ?? 'fra1'],
}, null, 2));

step('Routage, en-têtes de sécurité et cache');
// Les scripts « inline » de index.html (ex. thème clair/sombre appliqué avant l'affichage) sont autorisés un par un par leur empreinte SHA-256,
// calculée à chaque construction : aucun « unsafe-inline » pour les scripts, et rien à recalculer à la main.
const html = readFileSync(join(OUT, 'static', 'index.html'), 'utf8');
const inlineHashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
const security = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  // L'interface charge tout depuis son propre domaine (polices et scripts empaquetés) ; styles « inline » nécessaires aux composants
  'content-security-policy': `default-src 'self'; script-src 'self' ${inlineHashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
};
const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: security, continue: true },
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    // L'API pose ses propres en-têtes (CSP dédiée pour /api/docs) : on lui transmet tout /api tel quel
    { src: '/api/(.*)', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html', headers: { 'cache-control': 'no-store' } },
  ],
};
writeFileSync(join(OUT, 'config.json'), JSON.stringify(config, null, 2));
console.log(`\n✔ Sortie prête : ${existsSync(join(OUT, 'config.json')) ? '.vercel/output' : '?'}`);
