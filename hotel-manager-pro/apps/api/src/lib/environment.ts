import { assertEnvironment } from '@hmp/db';
import type { Config } from '../config';
import type { Db } from '../db';

/**
 * Garde-fou « pas de mélange » : au démarrage, l'environnement configuré (APP_ENV) est comparé au marqueur de la base.
 * Première utilisation d'une base neuve : le marqueur est posé. Base d'un autre environnement : EnvironmentMismatchError,
 * l'appelant arrête le processus (aucune requête n'est servie).
 */
export async function assertDatabaseEnvironment(db: Db, config: Pick<Config, 'appEnv'>): Promise<void> {
  const client = await db.platform.connect();
  try {
    await assertEnvironment(client, config.appEnv);
  } finally {
    client.release();
  }
}
