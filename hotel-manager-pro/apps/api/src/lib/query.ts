import type { Tx } from '../db';

/**
 * Exécute les requêtes UNE PAR UNE sur la même connexion, même lancées ensemble avec `Promise.all`.
 * Une transaction n'a qu'une connexion : pg déconseille (et interdira dans sa version 9) d'y envoyer plusieurs requêtes
 * en parallèle ; cela n'aurait d'ailleurs aucun gain de vitesse.
 */
export function serialRows(tx: Tx) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T = unknown>(sql: string, args: unknown[] = []): Promise<T[]> => {
    const run = chain.then(async () => (await tx.query(sql, args)).rows as T[]);
    chain = run.catch(() => undefined);
    return run;
  };
}
