/**
 * Prépare une base HÉBERGÉE (Neon…) pour un environnement en ligne, en UNE commande — pensé pour un débutant :
 *
 *   pnpm online:setup
 *
 * Elle : vérifie que la base n'appartient pas à un autre environnement, crée les rôles (deploy/prepare-managed-db.sql), donne leurs
 * mots de passe aux comptes de l'application, applique les migrations, crée le super-administrateur, puis écrit DEUX fichiers locaux
 * (jamais versionnés) à copier dans Vercel / GitHub. Les secrets ne sont JAMAIS affichés dans le terminal (captures d'écran, partage).
 * Relançable sans risque : les secrets déjà générés (ENCRYPTION_KEY surtout) sont réutilisés, jamais régénérés.
 *
 * Variables d'automatisation (facultatives) : ONLINE_ENV, ONLINE_DB_URL, ONLINE_PROJECT, ONLINE_YES=1,
 * HMP_ADMIN_EMAIL, HMP_ADMIN_NAME, ADMIN_PASSWORD.
 */
import { assertEnvironmentAsAdmin, isAppEnvironment, migrate, readEnvironmentAsAdmin, type AppEnvironment } from '@hmp/db';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { askHidden } from './prompt';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(API_DIR, '..', '..');

const say = (m = '') => console.log(m);
function fail(message: string): never {
  console.error(`\nERREUR : ${message}\n`);
  process.exit(1);
}
function ask(label: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(label, (a) => { rl.close(); done(a); });
  });
}
function readKeyValues(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const eq = raw.indexOf('=');
    if (raw.trim() && !raw.startsWith('#') && eq > 0) out[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
  }
  return out;
}
const passwordOf = (url: string | undefined) => { try { return decodeURIComponent(new URL(url ?? '').password); } catch { return ''; } };

say('=== Hotel Manager Pro — préparation d\'une base en ligne ===\n');

// 1. Environnement visé
const envInput = (process.env.ONLINE_ENV ?? (await ask('Environnement à préparer (staging = tests, production = vrais clients) [staging] : ')).trim()) || 'staging';
if (!isAppEnvironment(envInput) || envInput === 'development') fail('Environnement invalide : tapez « staging » ou « production ».');
const appEnv: AppEnvironment = envInput;
if (appEnv === 'production' && !process.env.ONLINE_YES) {
  if ((await ask('ATTENTION : base de PRODUCTION (vrais clients). Tapez PRODUCTION en majuscules pour continuer : ')).trim() !== 'PRODUCTION') fail('Abandon.');
}

// 2. Adresse de connexion fournie par l'hébergeur (collée, affichée en étoiles)
const raw = (process.env.ONLINE_DB_URL ?? (await askHidden("Collez l'adresse de connexion de la base (Neon : bouton Connect). Des * s'affichent : "))).trim();
let source: URL;
try { source = new URL(raw); } catch { fail("Adresse illisible. Elle doit commencer par postgresql:// ou postgres:// (copiez-la depuis le bouton « Connect » de Neon)."); }
if (!/^postgres(ql)?:$/.test(source.protocol) || !source.hostname || !source.username || !source.password || source.pathname.length < 2) {
  fail("Adresse incomplète : elle doit contenir l'utilisateur, le mot de passe, le serveur et le nom de la base.");
}
const database = source.pathname.slice(1);
const local = /^(localhost|127\.|\[?::1)/.test(source.hostname);
const directHost = source.hostname.replace(/-pooler(?=\.)/, '');
const pooledHost = source.hostname.endsWith('.neon.tech') ? directHost.replace(/^([^.]+)/, '$1-pooler') : directHost;
const withHost = (host: string, user?: string, password?: string) => {
  const u = new URL(source.toString());
  u.hostname = host;
  if (user) u.username = user;
  if (password) u.password = password;
  if (!local && !u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  return u.toString();
};
const adminUrl = withHost(directHost); // compte propriétaire, adresse DIRECTE : migrations uniquement

// 3. Nom du projet Vercel -> adresse du site
const project = ((process.env.ONLINE_PROJECT ?? (await ask(`Nom prévu du projet Vercel [hmp-${appEnv}] : `))).trim() || `hmp-${appEnv}`).toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(project)) fail('Nom de projet invalide (minuscules, chiffres, tirets).');
const site = `https://${project}.vercel.app`;

say(`\nRécapitulatif :\n  environnement : ${appEnv}\n  serveur       : ${directHost}\n  base          : ${database}   (compte : ${decodeURIComponent(source.username)})\n  site prévu    : ${site}\n`);
if (!process.env.ONLINE_YES && (await ask('Tout est correct ? Tapez o pour continuer : ')).trim().toLowerCase() !== 'o') fail('Abandon, rien n\'a été modifié.');

// 4. Connexion et garde-fou d'environnement
const admin = new pg.Client({ connectionString: adminUrl });
try {
  await admin.connect();
} catch (e) {
  const code = (e as { code?: string }).code;
  fail(code === '28P01' ? "Mot de passe refusé : recopiez l'adresse depuis Neon (bouton Connect)." : `Connexion impossible (${code ?? 'erreur'} : ${(e as Error).message}).`);
}
const files = { vercel: join(ROOT, `online-${appEnv}-vercel.txt`), admin: join(ROOT, `online-${appEnv}-admin.txt`) };
let adminCount = 0;
try {
  const marker = await readEnvironmentAsAdmin(admin);
  if (marker && marker !== appEnv) fail(`REFUSÉ : cette base est marquée « ${marker} » alors que vous préparez « ${appEnv} ». Vous avez probablement collé l'adresse de la mauvaise base. Rien n'a été modifié.`);
  say('✔ Base vérifiée (aucun mélange d\'environnement).');

  await admin.query(readFileSync(join(ROOT, 'deploy', 'prepare-managed-db.sql'), 'utf8'));
  say('✔ Rôles de l\'application créés.');

  // 5. Secrets : réutilisés s'ils existent déjà (régénérer ENCRYPTION_KEY rendrait illisibles les données déjà chiffrées)
  const previous = readKeyValues(files.vercel);
  const appPassword = passwordOf(previous.DATABASE_URL_APP) || randomBytes(24).toString('hex');
  const platformPassword = passwordOf(previous.DATABASE_URL_PLATFORM) || randomBytes(24).toString('hex');
  await admin.query(`ALTER ROLE hmp_app LOGIN PASSWORD '${appPassword}'`);
  await admin.query(`ALTER ROLE hmp_platform LOGIN PASSWORD '${platformPassword}'`);

  const { applied, skipped } = await migrate(admin);
  await assertEnvironmentAsAdmin(admin, appEnv);
  say(`✔ Tables : ${applied.length} migration(s) appliquée(s), ${skipped.length} déjà à jour. Base marquée « ${appEnv} ».`);
  adminCount = Number((await admin.query<{ n: string }>('SELECT count(*) AS n FROM platform_admins')).rows[0]!.n);

  const vars = [
    'NODE_ENV=production',
    `APP_ENV=${appEnv}`,
    `DATABASE_URL_APP=${withHost(pooledHost, 'hmp_app', appPassword)}`,
    `DATABASE_URL_PLATFORM=${withHost(pooledHost, 'hmp_platform', platformPassword)}`,
    `CSRF_SECRET=${previous.CSRF_SECRET || randomBytes(48).toString('base64')}`,
    `ENCRYPTION_KEY=${previous.ENCRYPTION_KEY || randomBytes(32).toString('base64')}`,
    `ALLOWED_ORIGINS=${previous.ALLOWED_ORIGINS || site}`,
    `PUBLIC_URL=${previous.PUBLIC_URL || site}`,
    'TRUST_PROXY=true',
    'DB_POOL_MAX_APP=3',
    'DB_POOL_MAX_PLATFORM=2',
    'LOG_LEVEL=info',
    '',
  ];
  writeFileSync(files.vercel, vars.join('\n'), { mode: 0o600 });
  writeFileSync(files.admin, `DATABASE_ADMIN_URL=${adminUrl}\n`, { mode: 0o600 });
  say('✔ Fichiers de réglages écrits (voir plus bas).');
} finally {
  await admin.end().catch(() => undefined);
}

// 6. Premier super-administrateur de cet environnement
if (adminCount === 0) {
  say('\nCréation du compte SUPER-ADMINISTRATEUR de cet environnement (console de gestion).');
  const email = (process.env.HMP_ADMIN_EMAIL ?? (await ask('Votre e-mail : '))).trim();
  if (email) {
    const name = (process.env.HMP_ADMIN_NAME ?? (await ask('Votre nom complet : '))).trim() || 'Administrateur';
    const r = spawnSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts'], {
      cwd: API_DIR, stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, ADMIN_EMAIL: email, ADMIN_NAME: name },
    });
    if (r.status !== 0) say('Compte non créé : relancez « pnpm online:setup » pour réessayer.');
  }
} else {
  say(`✔ ${adminCount} super-administrateur(s) déjà enregistré(s).`);
}

say(`
=== Terminé. Deux fichiers ont été créés dans le dossier du projet (SECRETS : ne les envoyez à personne, ni dans le chat) ===
  1) online-${appEnv}-vercel.txt   → à COLLER dans Vercel (Settings > Environment Variables, collez tout le contenu dans le premier champ)
  2) online-${appEnv}-admin.txt    → adresse d'administration de la base : à garder pour plus tard (secret GitHub DATABASE_ADMIN_URL), JAMAIS dans Vercel

Ouvrez le premier avec :   notepad online-${appEnv}-vercel.txt

CONSERVEZ à part (gestionnaire de mots de passe) la ligne ENCRYPTION_KEY : sans elle, les pièces d'identité chiffrées deviennent illisibles.
Si le nom de projet Vercel obtenu diffère de « ${project} », corrigez ALLOWED_ORIGINS et PUBLIC_URL avec l'adresse réelle du site.`);
