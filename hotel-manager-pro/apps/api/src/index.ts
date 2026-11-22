import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db';
import { assertDatabaseEnvironment } from './lib/environment';

/** Démarrage du serveur : configuration validée au démarrage, arrêt propre sur SIGINT/SIGTERM. */
const config = loadConfig();
let logger: { error: (o: object, msg: string) => void } = { error: (o, msg) => console.error(JSON.stringify({ level: 'error', msg, ...o })) };
const db = createDb({
  appUrl: config.DATABASE_URL_APP,
  platformUrl: config.DATABASE_URL_PLATFORM,
  switchRole: config.DB_SWITCH_ROLE,
  onPoolError: (error, pool) => logger.error({ pool, err: error.message }, 'connexion inactive du pool coupée : elle sera rétablie à la prochaine requête'),
});
try {
  await assertDatabaseEnvironment(db, config);
} catch (err) {
  const missing = (err as { code?: string }).code === '42883'; // fonction absente : migration 0022 pas encore appliquée
  console.error(JSON.stringify({ level: 'fatal', msg: missing ? "La base n'est pas à jour : appliquez les migrations (pnpm db:migrate, ou pnpm local:setup en local)." : (err as Error).message }));
  await db.close().catch(() => undefined);
  process.exit(1);
}
const app = await buildApp({ db, config });
logger = app.log;

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'arrêt demandé : on termine les requêtes en cours');
  try {
    await app.close();
    await db.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "échec de l'arrêt propre");
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error({ err }, 'démarrage impossible');
  await db.close().catch(() => undefined);
  process.exit(1);
}
