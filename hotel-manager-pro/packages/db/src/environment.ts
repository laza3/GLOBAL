import type pg from 'pg';

/** Les trois environnements : un seul code source, trois configurations, trois bases de données distinctes. */
export const APP_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export const isAppEnvironment = (v: unknown): v is AppEnvironment => (APP_ENVIRONMENTS as readonly unknown[]).includes(v);

type Queryable = pg.Client | pg.PoolClient;

/** La base appartient à un autre environnement que celui de l'application : on refuse de continuer. */
export class EnvironmentMismatchError extends Error {
  constructor(readonly expected: AppEnvironment, readonly actual: AppEnvironment) {
    super(
      `Cette base de données appartient à l'environnement « ${actual} » alors que l'application est configurée pour « ${expected} ». ` +
        'Arrêt pour ne pas mélanger données de test et données réelles : vérifiez les adresses de base de données (DATABASE_URL_*) de cet environnement.',
    );
    this.name = 'EnvironmentMismatchError';
  }
}

/**
 * Pose le marqueur d'environnement s'il n'existe pas encore et renvoie celui de la base. Utilisable par l'API (rôles applicatifs,
 * fonction SECURITY DEFINER). La migration 0022 doit être appliquée.
 */
export async function claimEnvironment(client: Queryable, environment: AppEnvironment): Promise<AppEnvironment> {
  const { rows } = await client.query<{ e: AppEnvironment }>('SELECT environment_claim($1) AS e', [environment]);
  return rows[0]!.e;
}

/** Vérifie (et pose au besoin) le marqueur ; lève EnvironmentMismatchError si la base est d'un autre environnement. */
export async function assertEnvironment(client: Queryable, environment: AppEnvironment): Promise<void> {
  const actual = await claimEnvironment(client, environment);
  if (actual !== environment) throw new EnvironmentMismatchError(environment, actual);
}

async function asOwner<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE hmp_owner'); // propriétaire de la table : traverse la RLS même si le compte d'administration est restreint
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Marqueur actuel avec le compte d'administration (migrations, CI) ; null sur une base neuve ou avant la migration 0022. */
export async function readEnvironmentAsAdmin(client: Queryable): Promise<AppEnvironment | null> {
  const reg = await client.query<{ t: string | null }>("SELECT to_regclass('public.deployment_marker')::text AS t");
  if (!reg.rows[0]!.t) return null;
  return asOwner(client, async () => (await client.query<{ environment: AppEnvironment }>('SELECT environment FROM deployment_marker')).rows[0]?.environment ?? null);
}

/** Comme assertEnvironment, avec le compte d'administration (la CI pose le marqueur dès la première migration). */
export async function assertEnvironmentAsAdmin(client: Queryable, environment: AppEnvironment): Promise<void> {
  const actual = await asOwner(client, () => claimEnvironment(client, environment));
  if (actual !== environment) throw new EnvironmentMismatchError(environment, actual);
}
