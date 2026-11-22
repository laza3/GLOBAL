/**
 * LANCEUR de l'installation LOCALE chez un client (installateur Windows « HotelManagerPro-Setup.exe »).
 * Tout ce qu'il faut est dans le dossier d'installation : Node.js, PostgreSQL, le serveur et l'interface. Aucune installation préalable.
 *
 *   launcher.mjs                 (sans argument) 1re fois : crée la base de données ; puis démarre PostgreSQL et le serveur, ouvre le navigateur
 *   launcher.mjs backup          copie de sécurité vérifiée        [--vers DOSSIER] [--auto]
 *   launcher.mjs restore [FICHIER]  remplace les données par une copie de sécurité   [--oui]
 *   launcher.mjs admin           crée un compte super-administrateur (console de l'éditeur)
 *   launcher.mjs stop            arrête le serveur et PostgreSQL (utilisé par l'installateur avant une mise à jour)
 *
 * Disposition : <RACINE>/app (ce programme, server.mjs, web/, migrations/), <RACINE>/runtime (node.exe, pg/),
 * <RACINE>/donnees (base de données, clés : JAMAIS supprimé par une mise à jour), <RACINE>/sauvegardes.
 * Variables de test : HMP_HOME, HMP_APP_DIR, HMP_PG_BIN, HMP_PORT, HMP_PG_PORT, HMP_BACKUP_DIR, HMP_ADMIN_EMAIL / HMP_ADMIN_NAME / ADMIN_PASSWORD.
 */
import { migrate } from '@hmp/db';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { AppError } from '../src/errors';
import { assertStrongPassword, hashPassword } from '../src/lib/security';
import { askHidden } from './prompt';

const WIN = process.platform === 'win32';
const APP = process.env.HMP_APP_DIR ?? dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HMP_HOME ?? resolve(APP, '..');
const DATA = join(ROOT, 'donnees');
const PGDATA = join(DATA, 'pg');
const CONFIG = join(DATA, 'config.json');
const BACKUPS = process.env.HMP_BACKUP_DIR ?? join(ROOT, 'sauvegardes');
const PGBIN = process.env.HMP_PG_BIN ?? join(ROOT, 'runtime', 'pg', 'bin');
const SOCKDIR = join(process.env.TMPDIR ?? '/tmp', `hmp-pg-${process.getuid?.() ?? 0}`); // Linux/macOS seulement (Windows : sans objet)
const WEB_PORT = Number(process.env.HMP_PORT ?? 5173);
const PG_PORT = Number(process.env.HMP_PG_PORT ?? 54329); // port inhabituel : ne gêne ni n'est gêné par un autre PostgreSQL du PC
const DB_NAME = 'hmp';
const ARGS = process.argv.slice(2);
const COMMAND = ARGS[0] && !ARGS[0].startsWith('--') ? ARGS[0] : 'run';
const FLAGS = ARGS.slice(COMMAND === ARGS[0] ? 1 : 0);
const hasFlag = (f: string) => FLAGS.includes(f);

const say = (m = '') => console.log(m);
/** Erreur annoncée à l'utilisateur : levée (et non « process.exit ») pour que les blocs « finally » arrêtent PostgreSQL proprement. */
class Fatal extends Error {}
function fail(message: string): never {
  throw new Fatal(message);
}
const pgExe = (name: string) => join(PGBIN, WIN ? `${name}.exe` : name);
const fromUserDir = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p.replace(/^["']|["']$/g, ''));

function flagValue(name: string): string | undefined {
  const i = FLAGS.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return (FLAGS[i]!.includes('=') ? FLAGS[i]!.slice(name.length + 1) : FLAGS[i + 1])?.replace(/^["']|["']$/g, '');
}

function ask(label: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(label, (a) => { rl.close(); done(a); });
  });
}

/* ------------------------------------------------------------------------------------------------ configuration (secrets propres à CE poste) */
interface LocalConfig { pgPassword: string; appPassword: string; platformPassword: string; csrfSecret: string; encryptionKey: string; taskCreated?: boolean }
const readConfig = (): LocalConfig | null => (existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, 'utf8')) as LocalConfig) : null);
const saveConfig = (c: LocalConfig) => writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 });
const newConfig = (): LocalConfig => ({
  pgPassword: randomBytes(24).toString('hex'), appPassword: randomBytes(24).toString('hex'), platformPassword: randomBytes(24).toString('hex'),
  csrfSecret: randomBytes(36).toString('base64'), encryptionKey: randomBytes(32).toString('base64'),
});
const dbUrl = (c: LocalConfig, user: 'postgres' | 'hmp_app' | 'hmp_platform', db = DB_NAME) =>
  `postgres://${user}:${user === 'postgres' ? c.pgPassword : user === 'hmp_app' ? c.appPassword : c.platformPassword}@127.0.0.1:${PG_PORT}/${db}`;

/** Le dossier de données n'est lisible que par l'utilisateur de ce PC (clés et base de données). */
function lockDown(dir: string) {
  if (!WIN) { try { chmodSync(dir, 0o700); } catch { /* sans effet */ } return; }
  const user = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`.replace(/^\\/, '');
  if (!user) return;
  const icacls = (...a: string[]) => spawnSync('icacls', [dir, ...a], { stdio: 'ignore' }).status === 0;
  if (!icacls('/grant:r', `${user}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F')) return;
  icacls('/inheritance:r');
  try { const probe = join(dir, '.acces'); writeFileSync(probe, 'ok'); unlinkSync(probe); } catch { icacls('/inheritance:e'); } // jamais s'enfermer dehors
}

/* ------------------------------------------------------------------------------------------------ PostgreSQL embarqué */
const pgctl = (args: string[], stdio: 'ignore' | 'pipe' = 'pipe') => spawnSync(pgExe('pg_ctl'), args, { encoding: 'utf8', stdio: stdio === 'ignore' ? 'ignore' : 'pipe', windowsHide: true });
const pgRunning = () => existsSync(join(PGDATA, 'PG_VERSION')) && pgctl(['status', '-D', PGDATA]).status === 0;

function tail(file: string, n = 15): string {
  try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n).join('\n'); } catch { return '(aucun message)'; }
}

function initCluster(cfg: LocalConfig) {
  if (!existsSync(pgExe('initdb'))) fail(`PostgreSQL est introuvable dans « ${PGBIN} » : réinstallez Hotel Manager Pro.`);
  say('Création de la base de données de l\'hôtel (une seule fois, environ 1 minute)…');
  const pwfile = join(DATA, '.pw');
  writeFileSync(pwfile, cfg.pgPassword, { mode: 0o600 });
  try {
    rmSync(PGDATA, { recursive: true, force: true }); // reste d'une tentative interrompue
    const r = spawnSync(pgExe('initdb'), ['-D', PGDATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C', '--auth=scram-sha-256', `--pwfile=${pwfile}`], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) { rmSync(PGDATA, { recursive: true, force: true }); fail(`La création de la base a échoué :\n${r.stderr || r.stdout}`); }
  } finally { try { unlinkSync(pwfile); } catch { /* absent */ } }
}

function startPg() {
  if (pgRunning()) return;
  const opts = [`-p ${PG_PORT}`, '-c listen_addresses=127.0.0.1', '-c max_connections=80', '-c shared_buffers=128MB', '-c timezone=UTC'];
  if (!WIN) { mkdirSync(SOCKDIR, { recursive: true }); opts.push(`-c unix_socket_directories=${SOCKDIR}`); }
  const log = join(DATA, 'postgresql.log');
  // Sortie ignorée : sous Windows, PostgreSQL hérite des tuyaux et ferait attendre le lanceur ; ses messages vont dans le fichier journal
  const r = pgctl(['start', '-D', PGDATA, '-l', log, '-w', '-t', '90', '-o', opts.join(' ')], 'ignore');
  if (r.status !== 0 && !pgRunning()) fail(`PostgreSQL n'a pas démarré. Derniers messages :\n${tail(log)}`);
}
const stopPg = () => { if (existsSync(join(PGDATA, 'PG_VERSION')) && pgRunning()) pgctl(['stop', '-D', PGDATA, '-m', 'fast', '-w', '-t', '60'], 'ignore'); };

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => undefined); }
}

/** Base « hmp » + tables (migrations) + comptes applicatifs à moindre privilège. Idempotent : sert aussi aux mises à jour. */
async function prepareDatabase(cfg: LocalConfig): Promise<number> {
  await withClient(dbUrl(cfg, 'postgres', 'postgres'), async (c) => {
    if (!(await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])).rowCount) await c.query(`CREATE DATABASE ${DB_NAME}`);
  });
  return withClient(dbUrl(cfg, 'postgres'), async (c) => {
    const { applied } = await migrate(c, join(APP, 'migrations'));
    if (applied.length) say(`✔ Base de données à jour (${applied.length} mise(s) à niveau).`);
    await c.query(`ALTER ROLE hmp_app LOGIN PASSWORD '${cfg.appPassword}'`);
    await c.query(`ALTER ROLE hmp_platform LOGIN PASSWORD '${cfg.platformPassword}'`);
    return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM platform_admins')).rows[0]!.n);
  });
}

/* ------------------------------------------------------------------------------------------------ super-administrateur (console de l'éditeur) */
async function createAdmin(cfg: LocalConfig, interactive: boolean): Promise<void> {
  let email = (process.env.HMP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  let name = (process.env.HMP_ADMIN_NAME ?? '').trim();
  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!email) {
    if (!interactive) return;
    say('\nCompte ÉDITEUR (console de gestion : licences, établissements). Réservé à la personne qui installe le logiciel.');
    say('Pour le créer plus tard, appuyez sur Entrée : le raccourci « Créer un compte éditeur » existe dans le menu Démarrer.\n');
    email = (await ask('E-mail de l\'éditeur (ou Entrée pour passer) : ')).trim().toLowerCase();
    if (!email) return;
    name = (await ask('Nom complet : ')).trim() || 'Éditeur';
    for (;;) {
      password = await askHidden('Mot de passe (10 caractères minimum, lettres et chiffres ; des * s\'affichent) : ');
      if (password === (await askHidden('Confirmez le mot de passe : '))) break;
      say('✘ Les deux saisies sont différentes. Recommencez.\n');
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Adresse e-mail invalide.');
  if (name.length < 2) name = 'Éditeur';
  try { assertStrongPassword(password, email); } catch (e) { fail(e instanceof AppError ? 'Mot de passe trop faible : 10 caractères minimum, avec au moins une lettre et un chiffre.' : String(e)); }
  const hash = await hashPassword(password);
  await withClient(dbUrl(cfg, 'postgres'), async (c) => {
    const { rowCount } = await c.query('INSERT INTO platform_admins (email, full_name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING', [email, name, hash]);
    say(rowCount ? `✔ Compte éditeur créé : ${email}` : `Un compte existe déjà pour ${email} : rien n'a été modifié.`);
  });
}

/* ------------------------------------------------------------------------------------------------ démarrage */
async function alive(): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${WEB_PORT}/health/ready`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}
async function waitReady(seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) { if (await alive()) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
function openBrowser(url: string) {
  const tryRun = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'ignore', shell: false, windowsHide: true }).status === 0;
  if (WIN) { if (!tryRun('cmd', ['/c', 'start', '', 'chrome', url])) tryRun('cmd', ['/c', 'start', '', url]); }
  else if (process.platform === 'darwin') { if (!tryRun('open', ['-a', 'Google Chrome', url])) tryRun('open', [url]); }
  else if (!tryRun('xdg-open', [url])) say(`Ouvrez ${url} dans votre navigateur.`);
}
const killTree = (c: ChildProcess) => {
  if (c.pid === undefined || c.exitCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill('SIGTERM');
};

/** Tâche planifiée Windows : sauvegarde chaque jour à 13 h 30 (une seule fois, sans droits d'administrateur). */
function scheduleDailyBackup(cfg: LocalConfig) {
  if (!WIN || cfg.taskCreated || hasFlag('--no-task')) return;
  const r = spawnSync('schtasks', ['/create', '/tn', 'Hotel Manager Pro - Sauvegarde', '/tr', `"${join(ROOT, 'Sauvegarder.cmd')}" auto`, '/sc', 'daily', '/st', '13:30', '/f'], { stdio: 'ignore', windowsHide: true });
  if (r.status === 0) { cfg.taskCreated = true; saveConfig(cfg); say('✔ Sauvegarde automatique programmée chaque jour à 13 h 30 (ordinateur allumé).'); }
}

async function run() {
  if (await alive()) { say('Hotel Manager Pro est déjà lancé sur cet ordinateur.'); if (!hasFlag('--no-browser')) openBrowser(`http://127.0.0.1:${WEB_PORT}`); return; }
  const version = existsSync(join(APP, 'version.txt')) ? readFileSync(join(APP, 'version.txt'), 'utf8').trim() : '';
  say(`=== Hotel Manager Pro ${version} ===\n`);
  mkdirSync(DATA, { recursive: true });
  let cfg = readConfig();
  const firstRun = !cfg || !existsSync(join(PGDATA, 'PG_VERSION'));
  if (!cfg) { cfg = newConfig(); lockDown(DATA); saveConfig(cfg); }
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) initCluster(cfg);

  say('Démarrage de la base de données…');
  startPg();
  const adminCount = await prepareDatabase(cfg);
  if (adminCount === 0) await createAdmin(cfg, firstRun && !hasFlag('--auto') && Boolean(process.stdin.isTTY));
  if (firstRun) scheduleDailyBackup(cfg);

  say('Démarrage du logiciel…');
  const serverFile = join(APP, 'server.mjs');
  if (!existsSync(serverFile)) fail(`Fichier « ${serverFile} » introuvable : réinstallez Hotel Manager Pro.`);
  const logFd = openSync(join(DATA, 'serveur.log'), 'a');
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'development', APP_ENV: 'development', HOST: '0.0.0.0', PORT: String(WEB_PORT),
    DATABASE_URL_APP: dbUrl(cfg, 'hmp_app'), DATABASE_URL_PLATFORM: dbUrl(cfg, 'hmp_platform'),
    CSRF_SECRET: cfg.csrfSecret, ENCRYPTION_KEY: cfg.encryptionKey, LAN_MODE: 'true', API_DOCS: 'false', LOG_LEVEL: 'warn',
    WEB_DIST: join(APP, 'web'), ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`, TRUST_PROXY: 'false',
  };
  const server = spawn(process.execPath, [serverFile], { env, stdio: ['ignore', logFd, logFd], windowsHide: true });
  closeSync(logFd);
  writeFileSync(join(DATA, 'serveur.pid'), String(server.pid));

  let stopping = false;
  const shutdown = (code: number) => {
    if (stopping) return;
    stopping = true;
    say('\nArrêt en cours (ne fermez pas cette fenêtre pendant quelques secondes)…');
    killTree(server);
    stopPg();
    try { unlinkSync(join(DATA, 'serveur.pid')); } catch { /* absent */ }
    process.exit(code);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => shutdown(0));
  server.on('exit', (code) => { if (!stopping) { console.error(`\nLe logiciel s'est arrêté (code ${code}). Derniers messages :\n${tail(join(DATA, 'serveur.log'))}`); shutdown(1); } });

  if (!(await waitReady(90))) { console.error(`\nLe logiciel n'a pas démarré. Derniers messages :\n${tail(join(DATA, 'serveur.log'))}`); shutdown(1); }
  const local = `http://127.0.0.1:${WEB_PORT}`;
  say(`\n✔ Hotel Manager Pro est prêt sur CET ordinateur :  ${local}`);
  const addresses = lanAddresses();
  say('\n   Pour les AUTRES ordinateurs et téléphones (même Wi-Fi ou même câble), tapez dans le navigateur :');
  if (addresses.length) { for (const a of addresses) say(`      http://${a}:${WEB_PORT}`); say(`      ou, plus stable si l'adresse change :  http://${hostname()}:${WEB_PORT}`); }
  else say('      (aucun réseau détecté : branchez l\'ordinateur au Wi-Fi ou au routeur de l\'hôtel)');
  say('\n   • Console de l\'éditeur :  /platform/connexion    • Première utilisation : /inscription pour créer l\'hôtel');
  say('   • Pour arrêter : fermez cette fenêtre (ou Ctrl+C). Tant qu\'elle est ouverte, l\'hôtel peut travailler.\n');
  if (!hasFlag('--no-browser')) openBrowser(local);
  setInterval(() => undefined, 1 << 30); // garde le lanceur en vie
}

/* ------------------------------------------------------------------------------------------------ sauvegarde / restauration */
const stamp = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const dumpsIn = (dir: string, prefix: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.dump')).sort() : []);
const pgEnv = (cfg: LocalConfig): NodeJS.ProcessEnv => ({ ...process.env, PGHOST: '127.0.0.1', PGPORT: String(PG_PORT), PGUSER: 'postgres', PGPASSWORD: cfg.pgPassword });

/** Exécute `fn` avec PostgreSQL démarré ; l'arrête ensuite SI c'est cette commande qui l'a démarré (le logiciel peut être en cours d'utilisation). */
async function withPg<T>(fn: (cfg: LocalConfig) => Promise<T> | T): Promise<T> {
  const cfg = readConfig();
  if (!cfg || !existsSync(join(PGDATA, 'PG_VERSION'))) fail('Aucune donnée trouvée sur cet ordinateur : lancez d\'abord Hotel Manager Pro une fois.');
  const wasRunning = pgRunning();
  if (!wasRunning) startPg();
  try { return await fn(cfg); } finally { if (!wasRunning) stopPg(); }
}

function dumpTo(cfg: LocalConfig, prefix: string): string {
  mkdirSync(BACKUPS, { recursive: true });
  const file = join(BACKUPS, `${prefix}-${stamp()}.dump`);
  const r = spawnSync(pgExe('pg_dump'), ['--format=custom', '--no-password', '--file', file, DB_NAME], { env: pgEnv(cfg), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(file)) { try { unlinkSync(file); } catch { /* absent */ } fail(`La sauvegarde a échoué :\n${r.stderr}`); }
  if (spawnSync(pgExe('pg_restore'), ['--list', file], { stdio: 'ignore', windowsHide: true }).status !== 0 || statSync(file).size < 1000) fail(`La sauvegarde « ${file} » n'est pas lisible : ne vous y fiez pas.`);
  const keys = file.replace(/\.dump$/, '.cle.json'); // la clé de chiffrement des pièces d'identité est indispensable pour relire les données
  copyFileSync(CONFIG, keys);
  try { chmodSync(keys, 0o600); } catch { /* Windows */ }
  const extraRaw = flagValue('--vers') ?? (existsSync(join(ROOT, 'copie-supplementaire.txt')) ? readFileSync(join(ROOT, 'copie-supplementaire.txt'), 'utf8').split(/\r?\n/)[0]?.trim() : undefined);
  if (extraRaw) {
    const extra = fromUserDir(extraRaw);
    try { mkdirSync(extra, { recursive: true }); for (const f of [file, keys]) copyFileSync(f, join(extra, f.slice(BACKUPS.length + 1))); say(`✔ Copie supplémentaire déposée dans « ${extra} ».`); }
    catch (e) { say(`⚠ Copie vers « ${extra} » impossible (${(e as Error).message}). La sauvegarde principale est bonne.`); }
  }
  for (const old of dumpsIn(BACKUPS, 'hmp-').slice(0, -30)) for (const f of [old, old.replace(/\.dump$/, '.cle.json')]) { try { unlinkSync(join(BACKUPS, f)); } catch { /* absent */ } }
  say(`✔ Sauvegarde vérifiée : ${file}  (${(statSync(file).size / 1048576).toFixed(1)} Mo)`);
  return file;
}

async function backup() {
  say('=== Sauvegarde de Hotel Manager Pro ===\n');
  await withPg((cfg) => dumpTo(cfg, 'hmp'));
  if (!hasFlag('--auto')) say(`\nCopiez le dossier « ${BACKUPS} » sur une clé USB ou un disque externe : une sauvegarde qui reste sur le même ordinateur ne protège pas d'une panne du disque.`);
}

async function restore() {
  say('=== Restauration de Hotel Manager Pro ===\n');
  if (await alive()) fail('Hotel Manager Pro est en cours d\'utilisation : fermez sa fenêtre noire, puis relancez la restauration.');
  const given = FLAGS.find((a) => !a.startsWith('--'));
  const file = given ? fromUserDir(given) : (() => { const l = dumpsIn(BACKUPS, 'hmp-').at(-1); return l ? join(BACKUPS, l) : ''; })();
  if (!file || !existsSync(file)) fail('Aucune sauvegarde trouvée. Indiquez le fichier :  restauration "C:\\chemin\\hmp-AAAAMMJJ-HHMMSS.dump"');
  if (spawnSync(pgExe('pg_restore'), ['--list', file], { stdio: 'ignore', windowsHide: true }).status !== 0) fail(`Le fichier « ${file} » n'est pas une sauvegarde lisible.`);
  say(`Sauvegarde choisie : ${file}`);
  say('⚠ TOUTES les données actuelles de cet ordinateur vont être REMPLACÉES par celles de cette sauvegarde.');
  say('  (Une copie de sécurité des données actuelles est faite juste avant.)');
  if (!hasFlag('--oui') && (await ask('Tapez OUI en majuscules pour continuer : ')).trim() !== 'OUI') { say('Annulé : rien n\'a été modifié.'); return; }
  await withPg(async (cfg) => {
    const hasDb = await withClient(dbUrl(cfg, 'postgres', 'postgres'), async (c) => Boolean((await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])).rowCount));
    if (hasDb) { say('\nCopie de sécurité des données actuelles…'); dumpTo(cfg, 'avant-restauration'); }
    await withClient(dbUrl(cfg, 'postgres', 'postgres'), async (c) => { await c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`); await c.query(`CREATE DATABASE ${DB_NAME}`); });
    say('Restauration en cours…');
    const r = spawnSync(pgExe('pg_restore'), ['--no-password', '--dbname', DB_NAME, file], { env: pgEnv(cfg), encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) fail(`La restauration a signalé des erreurs :\n${(r.stderr || '').split(/\r?\n/).slice(-8).join('\n')}\nLes données d'avant sont dans « ${BACKUPS} » (fichier avant-restauration-…).`);
    // Clé de chiffrement d'origine (copiée à côté de la sauvegarde) : sans elle, les numéros de pièces d'identité seraient illisibles
    const keyFile = file.replace(/\.dump$/, '.cle.json');
    if (existsSync(keyFile)) {
      const saved = (JSON.parse(readFileSync(keyFile, 'utf8')) as Partial<LocalConfig>).encryptionKey;
      if (saved && saved !== cfg.encryptionKey) { cfg.encryptionKey = saved; saveConfig(cfg); say('✔ Clé de chiffrement d\'origine reprise (les numéros de pièces d\'identité restent lisibles).'); }
    } else say('⚠ Le fichier de clés (même nom que la sauvegarde, en .cle.json) n\'est pas à côté d\'elle : si elle vient d\'un AUTRE ordinateur, les numéros de pièces d\'identité seront illisibles.');
    await prepareDatabase(cfg); // mise à niveau éventuelle + mots de passe des comptes applicatifs de CE poste
    const n = await withClient(dbUrl(cfg, 'postgres'), async (c) => (await c.query<{ n: string }>("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0]!.n);
    say(`✔ Données restaurées (${n} tables).`);
  });
  say('\n=== Terminé. Relancez Hotel Manager Pro. ===');
}

async function stop() {
  const pidFile = join(DATA, 'serveur.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (pid) { if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(pid, 'SIGTERM'); } catch { /* déjà arrêté */ } } }
  }
  await new Promise((r) => setTimeout(r, 1500));
  stopPg();
  say('Hotel Manager Pro est arrêté.');
}

async function admin() {
  await withPg(async (cfg) => { await prepareDatabase(cfg); await createAdmin(cfg, true); });
}

const commands: Record<string, () => Promise<void>> = { run, backup, restore, stop, admin };
try {
  const handler = commands[COMMAND];
  if (!handler) fail(`Commande inconnue : ${COMMAND}. Commandes : backup, restore, admin, stop.`);
  await handler();
} catch (e) {
  console.error(e instanceof Fatal ? `\nERREUR : ${e.message}\n` : `\nERREUR INATTENDUE : ${(e as Error).stack ?? e}\n`);
  if (COMMAND === 'run') stopPg(); // le logiciel n'a pas démarré : on ne laisse pas la base tourner pour rien
  process.exit(1);
}
