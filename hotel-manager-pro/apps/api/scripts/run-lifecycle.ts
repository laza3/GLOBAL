/**
 * Cycle de vie des abonnements (essais échus, impayés, factures de renouvellement) — à planifier toutes les heures :
 *
 *   0 * * * *  cd /opt/hotel-manager-pro && pnpm --filter @hmp/api lifecycle
 *
 * Idempotent : peut être relancé sans risque. Écrit un résumé JSON sur la sortie standard.
 */
import { loadConfig } from '../src/config';
import { createDb } from '../src/db';
import { SettingsCache } from '../src/lib/settings';
import { runLifecycle } from '../src/services/lifecycle';

const config = loadConfig({ LOG_LEVEL: 'silent', ...process.env });
const db = createDb({ appUrl: config.DATABASE_URL_APP, platformUrl: config.DATABASE_URL_PLATFORM, switchRole: config.DB_SWITCH_ROLE });
try {
  const summary = await runLifecycle({ db, config, settings: new SettingsCache(db, 0), now: () => new Date() });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
} catch (err) {
  console.error('Échec du cycle de vie des abonnements :', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
