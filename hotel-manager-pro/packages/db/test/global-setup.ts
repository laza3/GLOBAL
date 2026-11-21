import pg from 'pg';
import { migrate } from '../src/migrate.js';

const DEFAULT_ADMIN_URL = 'postgres://hmp_dev:hmp_dev@127.0.0.1:5432/postgres';

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Crée UNE base « modèle » migrée par exécution de la suite ; chaque fichier de test en obtient une copie
 * isolée (CREATE DATABASE ... TEMPLATE), donc des tests indépendants sur un vrai PostgreSQL.
 */
export async function setup(): Promise<() => Promise<void>> {
  const adminUrl = process.env.HMP_TEST_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const template = `hmp_tpl_${process.pid}_${Date.now()}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${template}`);

  const tpl = new pg.Client({ connectionString: withDatabase(adminUrl, template) });
  await tpl.connect();
  try {
    await migrate(tpl);
  } finally {
    await tpl.end();
  }

  process.env.HMP_TEST_ADMIN_URL = adminUrl;
  process.env.HMP_TEST_TEMPLATE_DB = template;

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
    await admin.end();
  };
}
