import { randomUUID } from 'node:crypto';
import { formatDocNumber, DEFAULT_NUMBERING } from '@gp/shared';
import type { Db } from './db';

export class AppError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}
export const fail = (code: string, message: string, details?: unknown): never => {
  throw new AppError(code, message, details);
};

export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();

/** Jour calendaire (YYYY-MM-DD) dans le fuseau horaire de l'entreprise. */
export function businessDate(tz: string, d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Numéro de document séquentiel, atomique (à appeler dans la transaction de création). */
export function nextNumber(db: Db, type: keyof typeof DEFAULT_NUMBERING | string, numbering: Record<string, string>): string {
  const now = new Date();
  const year = now.getFullYear();
  db.run('INSERT INTO doc_sequences (type, year, next_value) VALUES (?,?,1) ON CONFLICT(type, year) DO NOTHING', type, year);
  const row = db.get<{ next_value: number }>('UPDATE doc_sequences SET next_value = next_value + 1 WHERE type = ? AND year = ? RETURNING next_value - 1 AS next_value', type, year)!;
  const pattern = numbering[type] ?? DEFAULT_NUMBERING[type] ?? `${type}-{YYYY}-{000000}`;
  return formatDocNumber(pattern, row.next_value, now);
}

export interface Company {
  id: string; name: string; legal_name: string | null; tax_id: string | null; stat_no: string | null; address: string | null;
  phone: string | null; email: string | null; logo: string | null; currency: string; locale: 'fr' | 'en'; timezone: string;
  prices_include_tax: number; allow_negative_stock: number; max_cashier_discount_bp: number;
  receipt_footer: string | null; invoice_notes: string | null; numbering_json: string;
}

/** Contexte d'exécution d'une opération : base, utilisateur authentifié, paramètres de l'entreprise. */
export interface Ctx {
  db: Db;
  user: { id: string; username: string; displayName: string; roleCode: string; branchId: string | null; permissions: Set<string> };
  company(): Company;
}

export function companyOf(db: Db): Company {
  const c = db.get<Company>('SELECT * FROM company LIMIT 1');
  if (!c) fail('NOT_CONFIGURED', "L'entreprise n'est pas encore configurée");
  return c!;
}
export const numberingOf = (c: Company): Record<string, string> => JSON.parse(c.numbering_json || '{}');

export function can(ctx: Ctx, perm: string) {
  return ctx.user.permissions.has(perm);
}
export function requirePerm(ctx: Ctx, perm: string) {
  if (!can(ctx, perm)) fail('FORBIDDEN', `Permission requise : ${perm}`);
}

export function audit(ctx: Ctx, action: string, entity?: string, entityId?: string, details?: unknown) {
  ctx.db.run(
    'INSERT INTO audit_log (id, at, user_id, username, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?,?)',
    uuid(), nowIso(), ctx.user.id, ctx.user.username, action, entity ?? null, entityId ?? null, details === undefined ? null : JSON.stringify(details),
  );
}

/** Trace de synchronisation (Outbox) : une ligne par mutation de donnée synchronisable. */
export function outbox(db: Db, entity: string, entityId: string, op: 'INSERT' | 'UPDATE' | 'DELETE', payload?: unknown) {
  db.run(
    'INSERT INTO outbox (op_id, entity, entity_id, op, payload, created_at) VALUES (?,?,?,?,?,?)',
    uuid(), entity, entityId, op, payload === undefined ? null : JSON.stringify(payload), nowIso(),
  );
}

export const like = (q: string) => `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
