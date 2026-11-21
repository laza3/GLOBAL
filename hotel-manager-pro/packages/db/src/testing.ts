/**
 * Infrastructure de test partagée (base PostgreSQL réelle) : une base « modèle » migrée une fois par exécution,
 * clonée pour chaque fichier de test (CREATE DATABASE ... TEMPLATE), donc des tests isolés et rapides.
 * Réservé aux tests : ne jamais l'importer depuis du code de production.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './migrate.js';

export const DEFAULT_TEST_ADMIN_URL = 'postgres://hmp_dev:hmp_dev@127.0.0.1:5432/postgres';

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Template {
  adminUrl: string;
  name: string;
  drop(): Promise<void>;
}

export async function createTemplate(adminUrl = process.env.HMP_TEST_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL): Promise<Template> {
  const name = `hmp_tpl_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const tpl = new pg.Client({ connectionString: withDatabase(adminUrl, name) });
  await tpl.connect();
  try {
    await migrate(tpl);
  } finally {
    await tpl.end();
  }
  return {
    adminUrl,
    name,
    async drop() {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export interface TestDatabase {
  name: string;
  url: string;
  /** Connexion superuser (contourne la RLS) : préparer / vérifier, jamais tester les droits. */
  admin: pg.Pool;
  drop(): Promise<void>;
}

export async function createDatabaseFromTemplate(
  adminUrl = process.env.HMP_TEST_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL,
  template = process.env.HMP_TEST_TEMPLATE_DB!,
): Promise<TestDatabase> {
  if (!template) throw new Error('HMP_TEST_TEMPLATE_DB absent : le globalSetup de test n\'a pas été exécuté');
  const name = `hmp_t_${randomBytes(6).toString('hex')}`;
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  try {
    // Les copies concurrentes depuis un même modèle se sérialisent : on réessaie brièvement
    for (let attempt = 0; ; attempt++) {
      try {
        await root.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await sleep(100 + attempt * 50);
      }
    }
  } finally {
    await root.end();
  }
  const url = withDatabase(adminUrl, name);
  const admin = new pg.Pool({ connectionString: url, max: 5 });
  // Au démontage, DROP DATABASE ... WITH (FORCE) peut couper une connexion encore en cours de fermeture : ce n'est pas une erreur de test
  admin.on('error', () => undefined);
  return {
    name,
    url,
    admin,
    async drop() {
      await admin.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
