/**
 * Lancement LOCAL de Hotel Manager Pro (développement) — conçu pour un débutant sous Windows, macOS ou Linux.
 * N'utilise ni `psql` ni bash : tout passe par Node.js (donc rien à ajouter au PATH).
 *
 *   pnpm local:setup   prépare tout (une seule fois) : base de données, rôles, migrations, fichier .env, 1er super-administrateur
 *   pnpm local:start   démarre l'API et l'interface, puis ouvre Google Chrome sur http://127.0.0.1:5173 (Ctrl+C pour arrêter)
 *
 * Variables facultatives : HMP_PG_ADMIN_USER (défaut « postgres »), HMP_PG_ADMIN_PASSWORD (sinon saisi à l'invite),
 * HMP_PG_HOST (127.0.0.1), HMP_PG_PORT (5432), HMP_LOCAL_DB (hmp_dev), HMP_API_PORT (3000), HMP_WEB_PORT (5173),
 * HMP_ADMIN_EMAIL / HMP_ADMIN_NAME / ADMIN_PASSWORD (création du super-administrateur sans questions : automatisation).
 * Ce script ne sert qu'au développement local : aucun secret de production ici, le .env créé n'est jamais versionné.
 */
import { migrate } from '@hmp/db';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { askHidden } from './prompt';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(API_DIR, '..', '..');
const WEB_DIR = join(ROOT, 'apps', 'web');
const ENV_FILE = join(ROOT, '.env');

const HOST = process.env.HMP_PG_HOST ?? '127.0.0.1';
const PORT = Number(process.env.HMP_PG_PORT ?? 5432);
const DB_NAME = process.env.HMP_LOCAL_DB ?? 'hmp_dev';
const API_PORT = Number(process.env.HMP_API_PORT ?? 3000);
const WEB_PORT = Number(process.env.HMP_WEB_PORT ?? 5173);
const DEV_ADMIN = { user: 'hmp_dev', password: 'hmp_dev' }; // compte de DÉVELOPPEMENT (même convention que scripts/setup-dev-db.sh)

const say = (m = '') => console.log(m);
function fail(message: string): never {
  console.error(`\nERREUR : ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------------------------------------ utilitaires */
function ask(label: string): Promise<string> {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(label, (answer) => { rl.close(); resolveAnswer(answer); });
  });
}

function readEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return env;
  for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const ident = (v: string) => (/^[a-z_][a-z0-9_]*$/.test(v) ? v : fail(`Nom de base invalide : « ${v} » (minuscules, chiffres et _ uniquement).`));

function explainConnectionError(e: unknown, who: string): never {
  const err = e as { code?: string; message?: string };
  if (err.code === '28P01') fail(`Mot de passe refusé pour « ${who} ». Relancez la commande et saisissez le mot de passe choisi lors de l'installation de PostgreSQL.`);
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') fail(`PostgreSQL ne répond pas sur ${HOST}:${PORT}. Est-il installé et démarré ? (Windows : ouvrez « Services », cherchez « postgresql-x64-16 » et démarrez-le.)`);
  fail(`Connexion à PostgreSQL impossible (${err.code ?? 'erreur'} : ${err.message ?? e}).`);
}

/* ------------------------------------------------------------------------------------------------ setup */
async function setup() {
  say('=== Hotel Manager Pro — préparation du lancement local ===\n');
  const dbName = ident(DB_NAME);

  // 1. Connexion au compte administrateur de PostgreSQL (créé lors de l'installation de PostgreSQL)
  const adminUser = process.env.HMP_PG_ADMIN_USER ?? 'postgres';
  let admin: pg.Client | undefined;
  for (let attempt = 1; !admin; attempt++) {
    const password = process.env.HMP_PG_ADMIN_PASSWORD ?? (await askHidden(`Mot de passe de l'utilisateur « ${adminUser} » de PostgreSQL (choisi à l'installation ; des * s'affichent pendant la saisie) : `));
    const client = new pg.Client({ host: HOST, port: PORT, user: adminUser, password, database: 'postgres' });
    try {
      await client.connect();
      admin = client;
    } catch (e) {
      const retry = (e as { code?: string }).code === '28P01' && !process.env.HMP_PG_ADMIN_PASSWORD && attempt < 3;
      if (!retry) explainConnectionError(e, adminUser);
      say(`✘ Mot de passe refusé (${password.length} caractère(s) reçu(s)). Essai ${attempt}/3 : vérifiez les majuscules et le clavier (AZERTY / QWERTY).\n`);
    }
  }

  try {
    const version = Number((await admin.query<{ v: string }>("SELECT current_setting('server_version_num') AS v")).rows[0]!.v);
    if (version < 160000) say(`⚠ PostgreSQL ${Math.floor(version / 10000)} détecté : le logiciel est testé avec la version 16 ; installez la 16 en cas de problème.`);
    // 2. Compte de développement + base
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DEV_ADMIN.user}') THEN CREATE ROLE ${DEV_ADMIN.user} SUPERUSER LOGIN PASSWORD '${DEV_ADMIN.password}'; END IF; END $$`);
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE ${dbName} OWNER ${DEV_ADMIN.user}`);
    say(`✔ Base de données « ${dbName} » prête.`);
  } finally {
    await admin.end();
  }

  // 3. Migrations (création des tables, des rôles applicatifs, des forfaits…)
  const adminUrl = `postgres://${DEV_ADMIN.user}:${DEV_ADMIN.password}@${HOST}:${PORT}/${dbName}`;
  const dev = new pg.Client({ connectionString: adminUrl });
  try { await dev.connect(); } catch (e) { explainConnectionError(e, DEV_ADMIN.user); }
  const current = readEnvFile();
  const passwordOf = (key: string) => { try { return decodeURIComponent(new URL(current[key] ?? '').password); } catch { return ''; } };
  const appPassword = passwordOf('DATABASE_URL_APP') || randomBytes(18).toString('hex');
  const platformPassword = passwordOf('DATABASE_URL_PLATFORM') || randomBytes(18).toString('hex');
  let adminCount = 0;
  try {
    const { applied, skipped } = await migrate(dev);
    say(`✔ Tables : ${applied.length} migration(s) appliquée(s), ${skipped.length} déjà à jour.`);
    // 4. Deux comptes de connexion distincts pour l'API (moindre privilège), comme en production
    await dev.query(`ALTER ROLE hmp_app LOGIN PASSWORD '${appPassword}'`);
    await dev.query(`ALTER ROLE hmp_platform LOGIN PASSWORD '${platformPassword}'`);
    adminCount = Number((await dev.query<{ n: string }>('SELECT count(*) AS n FROM platform_admins')).rows[0]!.n);
  } finally {
    await dev.end();
  }

  // 5. Fichier de configuration .env (jamais versionné, jamais écrasé)
  if (existsSync(ENV_FILE)) {
    say('✔ Fichier .env déjà présent : conservé tel quel.');
  } else {
    const lines = [
      '# Configuration LOCALE générée par « pnpm local:setup ». Ne jamais partager ni versionner ce fichier.',
      `DATABASE_ADMIN_URL=${adminUrl}`,
      `DATABASE_URL_APP=postgres://hmp_app:${appPassword}@${HOST}:${PORT}/${dbName}`,
      `DATABASE_URL_PLATFORM=postgres://hmp_platform:${platformPassword}@${HOST}:${PORT}/${dbName}`,
      'NODE_ENV=development',
      'HOST=127.0.0.1',
      `PORT=${API_PORT}`,
      `ALLOWED_ORIGINS=http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
      `CSRF_SECRET=${randomBytes(36).toString('base64')}`,
      'LOG_LEVEL=warn',
      '# Confort de test : on ne se fait pas bloquer après quelques erreurs de mot de passe',
      'AUTH_RATE_LIMIT_MAX=100',
      'PLATFORM_AUTH_RATE_LIMIT_MAX=100',
      '',
    ];
    writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
    say('✔ Fichier .env créé (secrets générés pour vous).');
  }

  // 6. Premier super-administrateur (console de la plateforme) — facultatif pour tester un hôtel
  if (adminCount === 0) {
    say('\nCréation du compte SUPER-ADMINISTRATEUR (console de gestion de la plateforme).');
    say('Vous pourrez tester un hôtel sans ce compte ; appuyez simplement sur Entrée pour le créer plus tard.\n');
    const email = (process.env.HMP_ADMIN_EMAIL ?? (await ask('Votre e-mail (ou Entrée pour passer) : '))).trim();
    if (email) {
      const name = (process.env.HMP_ADMIN_NAME ?? (await ask('Votre nom complet : '))).trim() || 'Administrateur';
      const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/create-admin.ts'], {
        cwd: API_DIR, stdio: 'inherit', shell: true,
        env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, ADMIN_EMAIL: email, ADMIN_NAME: name },
      });
      if (result.status !== 0) say('Le compte super-administrateur n\'a pas été créé ; relancez « pnpm local:setup » pour réessayer.');
    }
  } else {
    say(`✔ ${adminCount} super-administrateur(s) déjà enregistré(s).`);
  }

  say('\n=== Terminé. Prochaine commande :  pnpm local:start ===');
}

/* ------------------------------------------------------------------------------------------------ start */
const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code = 0): never {
  if (!stopping) {
    stopping = true;
    for (const c of children) {
      if (c.pid === undefined || c.exitCode !== null) continue;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else { try { process.kill(-c.pid, 'SIGTERM'); } catch { c.kill('SIGTERM'); } } // tout le groupe : le shell ET les programmes lancés par lui
    }
  }
  process.exit(code);
}

function run(label: string, cwd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn('pnpm', ['exec', ...args], { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const pipe = (stream: NodeJS.ReadableStream | null, sink: NodeJS.WriteStream) => {
    if (!stream) return;
    createInterface({ input: stream }).on('line', (l) => { if (l.trim()) sink.write(`[${label}] ${l}\n`); });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => { if (!stopping) { console.error(`\n[${label}] s'est arrêté (code ${code}). Voir les messages ci-dessus.`); stopAll(1); } });
  children.push(child);
  return child;
}

async function waitFor(url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (stopping) return false;
    try { if ((await fetch(url)).ok) return true; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function openBrowser(url: string) {
  const tryRun = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'ignore', shell: false }).status === 0;
  if (process.platform === 'win32') {
    if (!tryRun('cmd', ['/c', 'start', '', 'chrome', url])) tryRun('cmd', ['/c', 'start', '', url]); // Chrome, sinon le navigateur par défaut
  } else if (process.platform === 'darwin') {
    if (!tryRun('open', ['-a', 'Google Chrome', url])) tryRun('open', [url]);
  } else if (!tryRun('xdg-open', [url])) {
    say(`Ouvrez ${url} dans votre navigateur.`);
  }
}

async function start() {
  if (!existsSync(ENV_FILE)) fail('Fichier .env introuvable : lancez d\'abord « pnpm local:setup ».');
  const env = { ...process.env, ...readEnvFile() };
  const apiUrl = `http://127.0.0.1:${API_PORT}`;
  const webUrl = `http://127.0.0.1:${WEB_PORT}`;
  process.on('SIGINT', () => { say('\nArrêt en cours…'); stopAll(0); });
  process.on('SIGTERM', () => stopAll(0));

  say('Démarrage de l\'API et de l\'interface (30 à 60 secondes la première fois)…\n');
  run('api', API_DIR, ['tsx', 'src/index.ts'], env);
  if (!(await waitFor(`${apiUrl}/health/ready`, 90))) { console.error('\nL\'API n\'a pas démarré (base inaccessible ? port occupé ?). Voir les messages [api] ci-dessus.'); stopAll(1); }
  say('✔ API prête.');
  run('web', WEB_DIR, ['vite', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { ...env, API_URL: apiUrl });
  if (!(await waitFor(webUrl, 90))) { console.error('\nL\'interface n\'a pas démarré (port occupé ?). Voir les messages [web] ci-dessus.'); stopAll(1); }

  say(`\n✔ Hotel Manager Pro est prêt :  ${webUrl}`);
  say('   • Créer un hôtel de test :  /inscription        • Console super-administrateur :  /platform/connexion');
  say('   • Pour tout arrêter : Ctrl+C dans cette fenêtre.\n');
  openBrowser(webUrl);
}

const command = process.argv[2];
if (command === 'setup') await setup();
else if (command === 'start') await start();
else fail('Usage : pnpm local:setup   puis   pnpm local:start');
