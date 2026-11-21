import { withoutTenant, withPlatform, withTenant, type TenantContext } from '@hmp/db';
import pg from 'pg';

/**
 * Accès aux bases : DEUX pools, deux rôles PostgreSQL (moindre privilège).
 *  - app      : requêtes d'un établissement (RLS) ; aucun accès aux tables plateforme
 *  - platform : console super-administrateur ; aucun accès aux données métier d'un hôtel
 * En production chaque pool utilise son propre mot de passe. Dans les tests la connexion est superuser et
 * `switchRole` bascule vers le rôle applicatif pour que la RLS s'applique réellement.
 */
// Les montants sont des entiers dans la plus petite unité de la devise (≤ 9×10¹⁵ : sûrs en nombre JavaScript).
// PostgreSQL renvoie bigint ET numeric (dont sum(bigint), utilisé par les soldes calculés) sous forme de texte :
// on les convertit pour que le JSON porte de vrais nombres.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export interface Db {
  app: pg.Pool;
  platform: pg.Pool;
  switchRole: boolean;
  close(): Promise<void>;
}

export function createDb(opts: {
  appUrl: string;
  platformUrl: string;
  switchRole?: boolean;
  /** Une connexion INACTIVE du pool a été coupée (redémarrage de la base, bascule…). Sans écouteur, Node arrêterait le processus. */
  onPoolError?: (error: Error, pool: 'app' | 'platform') => void;
}): Db {
  const app = new pg.Pool({ connectionString: opts.appUrl, max: 20, idleTimeoutMillis: 30_000 });
  const platform = new pg.Pool({ connectionString: opts.platformUrl, max: 8, idleTimeoutMillis: 30_000 });
  const report = opts.onPoolError ?? ((error, pool) => console.error(JSON.stringify({ level: 'error', msg: 'connexion inactive du pool coupée', pool, error: error.message })));
  app.on('error', (error) => report(error, 'app'));
  platform.on('error', (error) => report(error, 'platform'));
  return {
    app,
    platform,
    switchRole: opts.switchRole ?? false,
    async close() {
      await Promise.all([app.end(), platform.end()]);
    },
  };
}

export type Tx = pg.PoolClient;

export const tenantTx = <T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>) =>
  withTenant(db.app, ctx, fn, { switchRole: db.switchRole });

export const anonTx = <T>(db: Db, fn: (tx: Tx) => Promise<T>) => withoutTenant(db.app, fn, { switchRole: db.switchRole });

export const platformTx = <T>(db: Db, fn: (tx: Tx) => Promise<T>) => withPlatform(db.platform, fn, { switchRole: db.switchRole });
