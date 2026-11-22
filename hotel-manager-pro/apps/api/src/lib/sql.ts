import type { ErrorCode } from '@hmp/shared';
import { AppError } from '../errors';

/**
 * Construit un UPDATE à partir des SEULES clés autorisées (liste blanche) : aucune colonne arbitraire n'est modifiable,
 * quoi que contienne le corps de la requête. `where.version` ajoute le contrôle de concurrence optimiste (colonne `version`).
 */
export function buildUpdate(
  table: string,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
  where: { column: string; value: string; version?: number },
) {
  const entries = Object.entries(patch).filter(([k, v]) => k in columns && v !== undefined);
  if (entries.length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
  const sets = entries.map(([k], i) => `${columns[k]} = $${i + 1}`);
  const args: unknown[] = [...entries.map(([, v]) => v), where.value];
  let sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where.column} = $${args.length}`;
  if (where.version !== undefined) {
    args.push(where.version);
    sql += ` AND version = $${args.length}`;
  }
  return { sql, args, keys: entries.map(([k]) => k) };
}

/** Rattache une violation d'unicité (par nom de contrainte) à une erreur métier précise ; relance l'erreur d'origine sinon. */
export async function withUnique<T>(map: Record<string, ErrorCode>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint && map[err.constraint]) throw new AppError(map[err.constraint]!);
    throw e;
  }
}
