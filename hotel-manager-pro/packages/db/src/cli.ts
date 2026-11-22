import pg from 'pg';
import { APP_ENVIRONMENTS, assertEnvironmentAsAdmin, isAppEnvironment, readEnvironmentAsAdmin } from './environment.js';
import { migrate } from './migrate.js';

const command = process.argv[2];

if (command !== 'migrate') {
  console.error('Usage : tsx src/cli.ts migrate   (variable requise : DATABASE_ADMIN_URL)');
  process.exit(2);
}

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('DATABASE_ADMIN_URL est requis (compte capable de créer des rôles lors de la 1re migration).');
  process.exit(2);
}

// APP_ENV (development | staging | production) : garde-fou contre une migration lancée sur la mauvaise base.
// Obligatoire quand NODE_ENV=production (CI, serveur) ; facultatif en développement local.
const appEnv = process.env.APP_ENV;
if (appEnv !== undefined && !isAppEnvironment(appEnv)) {
  console.error(`APP_ENV invalide : « ${appEnv} » (valeurs : ${APP_ENVIRONMENTS.join(', ')}).`);
  process.exit(2);
}
if (process.env.NODE_ENV === 'production' && appEnv === undefined) {
  console.error('APP_ENV est requis en production (staging ou production) : il protège contre une migration sur la mauvaise base.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (appEnv) {
    const actual = await readEnvironmentAsAdmin(client);
    if (actual && actual !== appEnv) {
      console.error(`REFUSÉ : cette base est marquée « ${actual} » mais APP_ENV vaut « ${appEnv} ». Aucune migration n'a été appliquée. Vérifiez DATABASE_ADMIN_URL.`);
      process.exit(3);
    }
  }
  const { applied, skipped } = await migrate(client);
  if (appEnv) await assertEnvironmentAsAdmin(client, appEnv);
  for (const name of applied) console.log(`appliquée  ${name}`);
  console.log(`${applied.length} migration(s) appliquée(s), ${skipped.length} déjà à jour.`);
} finally {
  await client.end();
}
