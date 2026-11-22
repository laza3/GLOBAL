import { createHash } from 'node:crypto';
import type { Tx } from '../db';
import { AppError } from '../errors';

/**
 * Rend une création rejouable sans doublon : même clé `Idempotency-Key` + même contenu = même réponse, sans refaire l'action
 * (double-clic, réseau instable, relance automatique du navigateur). Le même identifiant avec un AUTRE contenu est refusé.
 *
 * Un verrou consultatif (par établissement + clé) sérialise deux requêtes identiques simultanées : la seconde attend la validation
 * de la première puis rejoue sa réponse. La trace est écrite dans la MÊME transaction que l'action : tout ou rien.
 */
export async function withIdempotency<T>(
  tx: Tx,
  hotelId: string,
  rawKey: unknown,
  scope: string,
  payload: unknown,
  run: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  const key = typeof rawKey === 'string' && rawKey.trim() ? `${scope}:${rawKey.trim().slice(0, 100)}` : null;
  if (!key) return { ...(await run()), replayed: false };

  const hash = createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${hotelId}:${key}`]);
  const { rows } = await tx.query<{ request_hash: string; response_status: number | null; response_body: T | null }>(
    'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE hotel_id = $1 AND key = $2',
    [hotelId, key],
  );
  const seen = rows[0];
  if (seen) {
    if (seen.request_hash !== hash) throw new AppError('idempotency_key_reused');
    if (seen.response_status !== null && seen.response_body !== null) return { status: seen.response_status, body: seen.response_body, replayed: true };
  }

  const result = await run();
  await tx.query(
    `INSERT INTO idempotency_keys (hotel_id, key, request_hash, response_status, response_body) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (hotel_id, key) DO NOTHING`,
    [hotelId, key, hash, result.status, JSON.stringify(result.body)],
  );
  // Ménage opportuniste : les clés de plus de deux jours ne servent plus à rien
  if (Math.random() < 0.05) await tx.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'");
  return { ...result, replayed: false };
}
