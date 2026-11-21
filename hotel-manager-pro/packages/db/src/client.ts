import type pg from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} invalide : UUID attendu`);
}

export interface TenantContext {
  hotelId: string;
  /** Utilisateur authentifié : requis pour les écritures qui doivent prouver leur auteur (support, inscription). */
  userId?: string;
}

export interface ContextOptions {
  /**
   * Tests / développement : la connexion appartient à un superuser, on bascule donc vers le rôle applicatif
   * (SET LOCAL ROLE) pour que la RLS s'applique. En production la connexion utilise directement hmp_app /
   * hmp_platform (deux pools, deux mots de passe) et cette option reste désactivée.
   */
  switchRole?: boolean;
}

async function inTransaction<T>(
  pool: pg.Pool,
  prepare: (client: pg.PoolClient) => Promise<void>,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await prepare(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Exécute `fn` dans UNE transaction liée à un établissement. Le contexte est posé avec set_config(..., true)
 * (équivalent de SET LOCAL) : il disparaît au COMMIT/ROLLBACK et ne peut donc jamais fuiter vers la requête
 * suivante d'une connexion réutilisée.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (tx: pg.PoolClient) => Promise<T>,
  options: ContextOptions = {},
): Promise<T> {
  assertUuid(ctx.hotelId, 'hotelId');
  if (ctx.userId !== undefined) assertUuid(ctx.userId, 'userId');
  return inTransaction(
    pool,
    async (client) => {
      if (options.switchRole) await client.query('SET LOCAL ROLE hmp_app');
      await client.query("SELECT set_config('app.hotel_id', $1, true), set_config('app.user_id', $2, true)", [
        ctx.hotelId,
        ctx.userId ?? '',
      ]);
    },
    fn,
  );
}

/** Transaction sans établissement (connexion, résolution de session) : aucune ligne d'établissement n'est visible. */
export function withoutTenant<T>(pool: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>, options: ContextOptions = {}): Promise<T> {
  return inTransaction(
    pool,
    async (client) => {
      if (options.switchRole) await client.query('SET LOCAL ROLE hmp_app');
    },
    fn,
  );
}

/** Transaction de la console super-administrateur : rôle hmp_platform, aucun accès aux données métier d'un hôtel. */
export function withPlatform<T>(pool: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>, options: ContextOptions = {}): Promise<T> {
  return inTransaction(
    pool,
    async (client) => {
      if (options.switchRole) await client.query('SET LOCAL ROLE hmp_platform');
    },
    fn,
  );
}

/**
 * Traduit une erreur PostgreSQL en code métier stable (traduit côté interface), ou null si l'erreur est technique.
 */
export function dbErrorCode(error: unknown): string | null {
  const e = error as { code?: string; message?: string; constraint?: string } | null;
  if (!e || typeof e.code !== 'string') return null;
  switch (e.code) {
    case 'HM001':
      return e.message ?? null;
    case '23P01':
      return e.constraint === 'room_allocations_no_overlap' ? 'room_not_available' : 'exclusion_violation';
    case '23505':
      return 'unique_violation';
    case '23503':
      return 'foreign_key_violation';
    case '23514':
      return 'check_violation';
    case '42501':
      return 'forbidden';
    default:
      return null;
  }
}
