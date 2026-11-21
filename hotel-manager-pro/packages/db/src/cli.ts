import pg from 'pg';
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

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { applied, skipped } = await migrate(client);
  for (const name of applied) console.log(`appliquée  ${name}`);
  console.log(`${applied.length} migration(s) appliquée(s), ${skipped.length} déjà à jour.`);
} finally {
  await client.end();
}
