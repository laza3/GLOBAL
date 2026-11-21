import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+(\.admin)?\.sql$/;

/**
 * Applique les migrations SQL dans l'ordre, chacune dans sa propre transaction.
 *
 * - Les fichiers `*.admin.sql` s'exécutent avec le compte de connexion (création des rôles et extensions).
 * - Tous les autres s'exécutent sous le rôle non-superuser `hmp_owner` : les objets lui appartiennent et les fonctions
 *   SECURITY DEFINER n'ont donc jamais les droits d'un superuser.
 * - Une migration déjà appliquée dont le contenu a changé est refusée (checksum) : on n'édite jamais l'historique.
 */
export async function migrate(client: pg.Client | pg.PoolClient, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  await client.query('CREATE SCHEMA IF NOT EXISTS hmp_migrations');
  await client.query(`
    CREATE TABLE IF NOT EXISTS hmp_migrations.applied (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['hmp_migrate']);
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    const files = (await readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM hmp_migrations.applied');
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const known = done.get(file);
      if (known !== undefined) {
        if (known !== checksum) {
          throw new Error(`Migration ${file} modifiée après application (checksum différent). Créez une nouvelle migration.`);
        }
        result.skipped.push(file);
        continue;
      }
      try {
        await client.query('BEGIN');
        if (!file.endsWith('.admin.sql')) await client.query('SET LOCAL ROLE hmp_owner');
        await client.query(sql);
        await client.query('RESET ROLE');
        await client.query('INSERT INTO hmp_migrations.applied (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['hmp_migrate']).catch(() => undefined);
  }
  return result;
}
