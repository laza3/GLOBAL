/**
 * Lancement LOCAL de Hotel Manager Pro (développement) — conçu pour un débutant sous Windows, macOS ou Linux.
 * N'utilise ni `psql` ni bash : tout passe par Node.js (donc rien à ajouter au PATH).
 *
 *   pnpm local:setup   prépare tout (une seule fois) : base de données, rôles, migrations, fichier .env, 1er super-administrateur
 *   pnpm local:start   démarre l'API et l'interface, puis ouvre Google Chrome sur http://127.0.0.1:5173 (Ctrl+C pour arrêter)
 *
 * Installation chez un CLIENT (hôtel sans Internet) :
 *   pnpm local:setup --client    comme setup, mais mot de passe de base aléatoire, clé de chiffrement propre, réglages de sécurité normaux
 *   pnpm local:start --lan       interface compilée (rapide) accessible aux autres ordinateurs et téléphones du réseau de l'hôtel
 *   pnpm local:backup [--vers DOSSIER]   copie de sécurité vérifiée (+ fichier des clés) ; 30 copies conservées
 *   pnpm local:restore [FICHIER]         remplace les données par une copie (après une copie de sécurité automatique des données actuelles)
 *
 * Variables facultatives : HMP_PG_ADMIN_USER (défaut « postgres »), HMP_PG_ADMIN_PASSWORD (sinon saisi à l'invite),
 * HMP_PG_HOST (127.0.0.1), HMP_PG_PORT (5432), HMP_LOCAL_DB (hmp_dev), HMP_API_PORT (3000), HMP_WEB_PORT (5173),
 * HMP_ADMIN_EMAIL / HMP_ADMIN_NAME / ADMIN_PASSWORD (création du super-administrateur sans questions : automatisation).
 * Ce script ne sert qu'au développement local : aucun secret de production ici, le .env créé n'est jamais versionné.
 */
import { migrate } from '@hmp/db';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
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

const FLAGS = process.argv.slice(3);
const hasFlag = (f: string) => FLAGS.includes(f);
/** Valeur d'une option « --nom valeur » ou « --nom=valeur » (guillemets et barre finale retirés : « E:\\ » sous Windows). */
function flagValue(name: string): string | undefined {
  const i = FLAGS.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  const raw = FLAGS[i]!.includes('=') ? FLAGS[i]!.slice(name.length + 1) : FLAGS[i + 1];
  return raw?.replace(/^["']|["']$/g, '');
}
const BACKUP_DIR = process.env.HMP_BACKUP_DIR ?? join(ROOT, 'sauvegardes');
/** pnpm lance ce script depuis apps/api : les chemins relatifs tapés par l'utilisateur sont lus depuis son dossier d'origine (INIT_CWD). */
const fromUserDir = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

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
  const clientMode = hasFlag('--client');
  const current = readEnvFile();
  const passwordOf = (key: string) => { try { return decodeURIComponent(new URL(current[key] ?? '').password); } catch { return ''; } };
  // Poste de développement : mot de passe de développement connu. Poste CLIENT : mot de passe aléatoire, créé une fois et gardé dans .env.
  const existingDevPassword = passwordOf('DATABASE_ADMIN_URL');
  const devPassword = existingDevPassword || (clientMode ? randomBytes(18).toString('hex') : DEV_ADMIN.password);

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
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DEV_ADMIN.user}') THEN CREATE ROLE ${DEV_ADMIN.user} SUPERUSER LOGIN PASSWORD '${devPassword}'; END IF; END $$`);
    if (clientMode && !existingDevPassword) await admin.query(`ALTER ROLE ${DEV_ADMIN.user} PASSWORD '${devPassword}'`); // poste client : jamais le mot de passe de développement connu
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE ${dbName} OWNER ${DEV_ADMIN.user}`);
    say(`✔ Base de données « ${dbName} » prête.`);
  } finally {
    await admin.end();
  }

  // 3. Migrations (création des tables, des rôles applicatifs, des forfaits…)
  const adminUrl = `postgres://${DEV_ADMIN.user}:${devPassword}@${HOST}:${PORT}/${dbName}`;
  const dev = new pg.Client({ connectionString: adminUrl });
  try { await dev.connect(); } catch (e) { explainConnectionError(e, DEV_ADMIN.user); }
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
      'APP_ENV=development',
      'HOST=127.0.0.1',
      `PORT=${API_PORT}`,
      `ALLOWED_ORIGINS=http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
      `CSRF_SECRET=${randomBytes(36).toString('base64')}`,
      'LOG_LEVEL=warn',
      ...(clientMode
        ? [
            '# Poste CLIENT : clé de chiffrement des pièces d\'identité PROPRE à cette installation (à conserver avec les sauvegardes : « pnpm local:backup » en garde une copie)',
            `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
            'LAN_MODE=true',
            'API_DOCS=false',
          ]
        : [
            '# Confort de test : on ne se fait pas bloquer après quelques erreurs de mot de passe',
            'AUTH_RATE_LIMIT_MAX=100',
            'PLATFORM_AUTH_RATE_LIMIT_MAX=100',
          ]),
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

  say(`\n=== Terminé. Prochaine commande :  pnpm local:start${clientMode ? ' --lan' : ''} ===`);
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
  // Nouvelle version récupérée avec « git pull » : les nouvelles tables sont créées automatiquement avant le démarrage
  if (env.DATABASE_ADMIN_URL) {
    const client = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
    try {
      await client.connect();
      const { applied } = await migrate(client);
      if (applied.length) say(`✔ Base mise à jour : ${applied.length} nouvelle(s) migration(s) appliquée(s).`);
    } catch (e) {
      fail(`Mise à jour de la base impossible : ${(e as Error).message}. PostgreSQL est-il démarré ?`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  const lan = hasFlag('--lan');
  const apiUrl = `http://127.0.0.1:${API_PORT}`;
  const webUrl = `http://127.0.0.1:${WEB_PORT}`;
  process.on('SIGINT', () => { say('\nArrêt en cours…'); stopAll(0); });
  process.on('SIGTERM', () => stopAll(0));

  if (lan) ensureWebBuild(env);
  say('Démarrage de l\'API et de l\'interface (30 à 60 secondes la première fois)…\n');
  // Mode réseau : l'API reste privée (127.0.0.1) ; seule l'interface écoute le réseau et relaie /api vers elle
  run('api', API_DIR, ['tsx', 'src/index.ts'], lan ? { ...env, LAN_MODE: 'true', HOST: '127.0.0.1' } : env);
  if (!(await waitFor(`${apiUrl}/health/ready`, 90))) { console.error('\nL\'API n\'a pas démarré (base inaccessible ? port occupé ?). Voir les messages [api] ci-dessus.'); stopAll(1); }
  say('✔ API prête.');
  run('web', WEB_DIR, lan ? ['vite', 'preview', '--host', '0.0.0.0', '--port', String(WEB_PORT), '--strictPort'] : ['vite', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { ...env, API_URL: apiUrl });
  if (!(await waitFor(webUrl, 90))) { console.error('\nL\'interface n\'a pas démarré (port occupé ?). Voir les messages [web] ci-dessus.'); stopAll(1); }

  say(`\n✔ Hotel Manager Pro est prêt sur CET ordinateur :  ${webUrl}`);
  if (lan) {
    const addresses = lanAddresses();
    say('\n   Pour les AUTRES ordinateurs et téléphones (même Wi-Fi ou même point d\'accès), tapez dans le navigateur :');
    if (addresses.length) for (const a of addresses) say(`      http://${a}:${WEB_PORT}`);
    if (addresses.length) say(`      ou, plus stable si l'adresse change :  http://${hostname()}:${WEB_PORT}`);
    else say('      (aucun réseau détecté : branchez-vous à un Wi-Fi ou activez le point d\'accès mobile de Windows, puis relancez)');
    say('\n   Windows peut demander « Autoriser l\'accès » (pare-feu) : cliquez sur Autoriser (réseaux privés).');
  } else {
    say('   • Créer un hôtel de test :  /inscription        • Console super-administrateur :  /platform/connexion');
  }
  say('   • Console super-administrateur :  /platform/connexion');
  say('   • Pour tout arrêter : Ctrl+C dans cette fenêtre (ne la fermez pas tant que l\'hôtel travaille).\n');
  openBrowser(webUrl);
}

/** Adresses IPv4 de cet ordinateur sur les réseaux locaux (box Wi-Fi, point d'accès mobile de Windows…). */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

/** Plus récente date de modification d'un dossier (récursif, hors node_modules/dist). */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    newest = Math.max(newest, st.isDirectory() ? newestMtime(full) : st.mtimeMs);
  }
  return newest;
}

/** Mode réseau : l'interface est COMPILÉE une fois (rapide pour les téléphones), et recompilée si le code a changé. */
function ensureWebBuild(env: NodeJS.ProcessEnv) {
  const index = join(WEB_DIR, 'dist', 'index.html');
  const sources = Math.max(newestMtime(join(WEB_DIR, 'src')), newestMtime(join(ROOT, 'packages', 'shared')), statSync(join(WEB_DIR, 'index.html')).mtimeMs);
  if (existsSync(index) && statSync(index).mtimeMs >= sources) return;
  say('Préparation de l\'interface (1 à 2 minutes la première fois et après chaque mise à jour)…');
  const r = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: WEB_DIR, env, shell: true, stdio: 'inherit' });
  if (r.status !== 0) fail('La préparation de l\'interface a échoué. Voir les messages ci-dessus.');
}

/* ------------------------------------------------------------------------------------------------ sauvegarde / restauration */
function findPgTool(name: 'pg_dump' | 'pg_restore'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates: string[] = [];
  if (process.env.HMP_PG_BIN) candidates.push(join(process.env.HMP_PG_BIN, exe));
  candidates.push(exe); // déjà dans le PATH
  if (process.platform === 'win32') for (let v = 20; v >= 13; v--) candidates.push(join('C:\\Program Files\\PostgreSQL', String(v), 'bin', exe));
  for (const c of candidates) if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  return fail(`Outil « ${name} » introuvable. Il est installé avec PostgreSQL : indiquez son dossier avec  set "HMP_PG_BIN=C:\\Program Files\\PostgreSQL\\16\\bin"  puis relancez.`);
}

/** Variables PG* pour les outils PostgreSQL (le mot de passe ne passe jamais dans la ligne de commande). */
function pgEnv(url: string, database?: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  return { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: database ?? u.pathname.slice(1) };
}

function stamp(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const dumpsIn = (dir: string, prefix: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.dump')).sort() : []);

/** Copie de sécurité vérifiée (lisible par pg_restore) + copie des clés. Renvoie le chemin du fichier. */
function doBackup(prefix = 'hmp'): string {
  const env = readEnvFile();
  if (!env.DATABASE_ADMIN_URL) fail('Fichier .env introuvable ou incomplet : lancez d\'abord « pnpm local:setup ».');
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${prefix}-${stamp()}.dump`);
  const dump = spawnSync(findPgTool('pg_dump'), ['--format=custom', '--no-password', '--file', file], { env: pgEnv(env.DATABASE_ADMIN_URL), stdio: ['ignore', 'inherit', 'inherit'] });
  if (dump.status !== 0 || !existsSync(file)) { try { unlinkSync(file); } catch { /* absent */ } fail('La sauvegarde a échoué. PostgreSQL est-il démarré ? (voir le message ci-dessus)'); }
  const check = spawnSync(findPgTool('pg_restore'), ['--list', file], { stdio: 'ignore' });
  if (check.status !== 0 || statSync(file).size < 1000) fail(`La sauvegarde « ${file} » n'est pas lisible : ne vous y fiez pas. Relancez la commande.`);
  // Les clés (chiffrement des pièces d'identité) sont indispensables pour relire les données : un fichier de clés PAR sauvegarde, à côté d'elle
  const keys = file.replace(/\.dump$/, '.env.txt');
  copyFileSync(ENV_FILE, keys);
  try { chmodSync(keys, 0o600); } catch { /* Windows : sans effet */ }
  const extraRaw = flagValue('--vers');
  const extra = extraRaw ? fromUserDir(extraRaw) : undefined;
  if (extra) {
    try { mkdirSync(extra, { recursive: true }); for (const f of [file, keys]) copyFileSync(f, join(extra, f.slice(BACKUP_DIR.length + 1))); say(`✔ Copie supplémentaire déposée dans « ${extra} ».`); }
    catch (e) { say(`⚠ Copie vers « ${extra} » impossible (${(e as Error).message}). La sauvegarde principale est bonne.`); }
  }
  // Rotation : on garde les 30 plus récentes (les copies « avant-restauration » ne sont jamais supprimées)
  for (const old of dumpsIn(BACKUP_DIR, 'hmp-').slice(0, -30)) {
    for (const f of [old, old.replace(/\.dump$/, '.env.txt')]) { try { unlinkSync(join(BACKUP_DIR, f)); } catch { /* absent ou en cours d'utilisation */ } }
  }
  say(`✔ Sauvegarde vérifiée : ${file}  (${(statSync(file).size / 1048576).toFixed(1)} Mo)`);
  return file;
}

async function backup() {
  say('=== Sauvegarde de Hotel Manager Pro ===\n');
  doBackup();
  say(`\nPensez à copier le dossier « ${BACKUP_DIR} » sur une clé USB ou un disque externe (une sauvegarde qui reste sur le même ordinateur ne protège pas d'une panne du disque).`);
}

async function restore() {
  say('=== Restauration de Hotel Manager Pro ===\n');
  const env = readEnvFile();
  if (!env.DATABASE_ADMIN_URL) fail('Fichier .env introuvable : lancez d\'abord « pnpm local:setup --client » (sur un nouvel ordinateur), puis relancez la restauration.');
  const given = FLAGS.find((a) => !a.startsWith('--'));
  const file = given ? fromUserDir(given.replace(/^["']|["']$/g, '')) : (() => { const last = dumpsIn(BACKUP_DIR, 'hmp-').at(-1); return last ? join(BACKUP_DIR, last) : ''; })();
  if (!file || !existsSync(file)) fail(`Aucune sauvegarde trouvée. Indiquez le fichier :  pnpm local:restore "C:\\chemin\\hmp-AAAAMMJJ-HHMMSS.dump"`);
  const pgRestore = findPgTool('pg_restore');
  if (spawnSync(pgRestore, ['--list', file], { stdio: 'ignore' }).status !== 0) fail(`Le fichier « ${file} » n'est pas une sauvegarde lisible.`);
  say(`Sauvegarde choisie : ${file}`);
  say('⚠ TOUTES les données actuelles de cet ordinateur vont être REMPLACÉES par celles de cette sauvegarde.');
  say('  (Une copie de sécurité des données actuelles est faite juste avant.)');
  if (!hasFlag('--oui')) {
    const answer = (await ask('Tapez OUI en majuscules pour continuer : ')).trim();
    if (answer !== 'OUI') { say('Annulé : rien n\'a été modifié.'); return; }
  }
  const adminUrl = new URL(env.DATABASE_ADMIN_URL);
  const dbName = ident(adminUrl.pathname.slice(1));
  const maintenance = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
  try { await maintenance.connect(); } catch (e) { explainConnectionError(e, decodeURIComponent(adminUrl.username)); }
  const exists = (await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount;
  if (exists) { say('\nCopie de sécurité des données actuelles…'); doBackup('avant-restauration'); }
  try {
    await maintenance.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await maintenance.query(`CREATE DATABASE ${dbName} OWNER ${decodeURIComponent(adminUrl.username)}`);
  } finally { await maintenance.end(); }
  say('Restauration en cours…');
  const r = spawnSync(pgRestore, ['--no-password', '--dbname', dbName, file], { env: pgEnv(env.DATABASE_ADMIN_URL), stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) fail('La restauration a signalé des erreurs (voir ci-dessus). Les données d\'avant sont dans « sauvegardes » (fichier avant-restauration-…). Envoyez-moi le message.');
  // Mise à niveau éventuelle (sauvegarde d'une version plus ancienne) et mots de passe des comptes applicatifs conformes à .env
  const db = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
  await db.connect();
  try {
    const { applied } = await migrate(db);
    if (applied.length) say(`✔ Base mise à niveau : ${applied.length} migration(s) appliquée(s).`);
    const pwd = (key: string) => { try { return decodeURIComponent(new URL(env[key] ?? '').password); } catch { return ''; } };
    for (const [role, key] of [['hmp_app', 'DATABASE_URL_APP'], ['hmp_platform', 'DATABASE_URL_PLATFORM']] as const) {
      if (pwd(key)) await db.query(`ALTER ROLE ${role} LOGIN PASSWORD '${pwd(key).replace(/'/g, "''")}'`);
    }
    const n = (await db.query<{ n: string }>("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0]!.n;
    say(`✔ Données restaurées (${n} tables).`);
  } finally { await db.end(); }
  // Clé de chiffrement des pièces d'identité : celle de la sauvegarde (copiée à côté d'elle par « local:backup ») doit être reprise
  const keysFile = file.replace(/\.dump$/, '.env.txt');
  if (existsSync(keysFile)) {
    const savedKey = /^ENCRYPTION_KEY=(.+)$/m.exec(readFileSync(keysFile, 'utf8'))?.[1]?.trim();
    if (savedKey && savedKey !== env.ENCRYPTION_KEY) {
      const text = readFileSync(ENV_FILE, 'utf8');
      writeFileSync(ENV_FILE, /^ENCRYPTION_KEY=.*$/m.test(text) ? text.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${savedKey}`) : `${text.trimEnd()}\nENCRYPTION_KEY=${savedKey}\n`, { mode: 0o600 });
      say('✔ Clé de chiffrement d\'origine reprise (les numéros de pièces d\'identité restent lisibles).');
    }
  } else {
    say('⚠ Le fichier de clés (même nom que la sauvegarde, en .env.txt) n\'est pas à côté d\'elle : si elle vient d\'un AUTRE ordinateur, recopiez sa ligne ENCRYPTION_KEY dans le fichier .env, sinon les numéros de pièces d\'identité seront illisibles.');
  }
  say('\n=== Terminé. Relancez le logiciel :  pnpm local:start --lan ===');
}

const command = process.argv[2];
if (command === 'setup') await setup();
else if (command === 'start') await start();
else if (command === 'backup') await backup();
else if (command === 'restore') await restore();
else fail('Usage : pnpm local:setup   puis   pnpm local:start   (client : local:setup --client, local:start --lan, local:backup, local:restore)');
