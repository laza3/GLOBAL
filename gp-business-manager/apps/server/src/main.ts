import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Db } from '@gp/core/db';
import { resetPasswordOffline } from '@gp/core/auth';
import { createGpServer, dailyBackup } from './server';

declare const __GP_VERSION__: string;

const env = process.env;
const dataDir = resolve(env.GP_DATA_DIR || './gp-data');
const backupDir = join(dataDir, 'backups');
mkdirSync(dataDir, { recursive: true });
mkdirSync(backupDir, { recursive: true });
const logFile = join(dataDir, 'gp-server.log');
const log = (msg: string, err?: unknown) => {
  const line = `${new Date().toISOString()} ${msg}${err ? ' ' + (err instanceof Error ? err.stack : String(err)) : ''}`;
  console.log(line);
  try { appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
};

const db = new Db(join(dataDir, 'gp-business.db'));

// CLI de récupération : « node server.cjs --reset-password=NouveauMotDePasse [--user=identifiant] »
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
if (arg('reset-password') !== undefined) {
  try { const r = resetPasswordOffline(db, arg('reset-password')!, arg('user')); log(`Mot de passe réinitialisé pour « ${r.username} »`); } catch (e) { log(`Impossible : ${(e as Error).message}`); process.exitCode = 1; }
  db.close();
  process.exit();
}

const publicDir = env.GP_PUBLIC_DIR ? resolve(env.GP_PUBLIC_DIR) : resolve(import.meta.dirname ?? __dirname, 'public');
let setupCode = env.GP_SETUP_CODE;
const { server, core } = createGpServer({
  db, version: __GP_VERSION__, publicDir, backupDir,
  secureCookies: env.GP_SECURE_COOKIES === '1',
  trustProxy: env.GP_TRUST_PROXY === '1',
  get setupCode() { return setupCode; },
  log,
});

if (!core.status().configured) {
  if (!setupCode) { setupCode = randomBytes(4).toString('hex').toUpperCase(); }
  log(`PREMIÈRE INSTALLATION — code d'installation à saisir sur la page de configuration : ${setupCode}`);
}

const port = Number(env.PORT || 3000);
const host = env.HOST || '0.0.0.0';
server.listen(port, host, () => log(`GP Business Manager serveur v${__GP_VERSION__} — http://${host}:${port} — données : ${dataDir}`));

dailyBackup(db, backupDir, log);
const timer = setInterval(() => dailyBackup(db, backupDir, log), 6 * 3600_000);
timer.unref();

const stop = () => { log('Arrêt du serveur…'); clearInterval(timer); server.close(() => { try { db.close(); } catch { /* déjà fermée */ } process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
