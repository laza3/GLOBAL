import { isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { toCsv } from '../lib/csv';
import { serialRows } from '../lib/query';
import { buildUpdate, withUnique } from '../lib/sql';
import { hotelClock } from '../services/reservations';

const money = z.number().int().min(1).max(1_000_000_000_000);
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const id = z.object({ id: z.uuid() });
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

const EXPENSE_SELECT = `SELECT e.id, e.category_id AS "categoryId", c.name AS "categoryName", c.kind AS "categoryKind", e.description, e.supplier, e.amount, e.currency,
         to_char(e.incurred_on, 'YYYY-MM-DD') AS "incurredOn", to_char(e.paid_on, 'YYYY-MM-DD') AS "paidOn", e.method_code AS "methodCode", e.created_at AS "createdAt"
  FROM expenses e JOIN expense_categories c ON c.id = e.category_id AND c.hotel_id = e.hotel_id`;

export default async function financesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const feature = 'finances';
  const read = app.hotelAuth({ permission: 'finances:read', feature });
  const manage = app.hotelAuth({ permission: 'finances:manage', feature });
  const exportAuth = app.hotelAuth({ permission: 'finances:read', feature: 'exports' });
  const tags = ['Finances'];

  /* ------------------------------------------------------------------ Catégories */
  r.get('/finances/categories', { preValidation: read, schema: { tags, summary: 'Catégories de dépenses' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) => tx.query('SELECT c.id, c.name, c.kind, c.is_active AS "isActive", (SELECT count(*)::int FROM expenses e WHERE e.category_id = c.id) AS "expensesCount" FROM expense_categories c ORDER BY c.is_active DESC, c.name'));
    return { categories: rows };
  });
  r.post('/finances/categories', { preValidation: manage, schema: { tags, summary: 'Créer une catégorie de dépenses', body: z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['expense', 'overhead']).default('expense') }) } }, async (req, reply) => {
    const me = req.hotel!;
    const created = await me.tenant((tx) => withUnique({ expense_categories_hotel_id_name_key: 'expense_category_taken' }, async () => {
      const { rows } = await tx.query<{ id: string }>('INSERT INTO expense_categories (hotel_id, name, kind) VALUES ($1, $2, $3) RETURNING id', [me.hotelId, req.body.name, req.body.kind]);
      await auditHotel(tx, me, 'finance.category_created', { type: 'expense_category', id: rows[0]!.id }, `Catégorie de dépenses : ${req.body.name}`, { ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    }));
    return reply.code(201).send({ id: created });
  });
  r.patch('/finances/categories/:id', { preValidation: manage, schema: { tags, summary: 'Modifier une catégorie de dépenses', params: id, body: z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['expense', 'overhead']), isActive: z.boolean() }).partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('expense_categories', { name: 'name', kind: 'kind', isActive: 'is_active' }, req.body, { column: 'id', value: req.params.id });
    await me.tenant((tx) => withUnique({ expense_categories_hotel_id_name_key: 'expense_category_taken' }, async () => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'finance.category_updated', { type: 'expense_category', id: req.params.id }, `Catégorie modifiée : ${u.keys.join(', ')}`, { ip: req.ip, requestId: req.id });
    }));
    return { updated: u.keys };
  });

  /* ------------------------------------------------------------------ Dépenses */
  const filters = z.object({ from: date.optional(), to: date.optional(), categoryId: z.uuid().optional(), q: z.string().trim().max(80).optional(), unpaid: z.enum(['true']).optional() });
  const where = `($1::date IS NULL OR e.incurred_on >= $1) AND ($2::date IS NULL OR e.incurred_on <= $2) AND ($3::uuid IS NULL OR e.category_id = $3)
    AND ($4::text IS NULL OR e.description ILIKE '%' || $4 || '%' OR e.supplier ILIKE '%' || $4 || '%') AND ($5::boolean IS NOT TRUE OR e.paid_on IS NULL)`;
  const whereArgs = (f: z.infer<typeof filters>) => [f.from ?? null, f.to ?? null, f.categoryId ?? null, f.q || null, f.unpaid === 'true'];

  r.get('/finances/expenses', { preValidation: read, schema: { tags, summary: 'Dépenses (filtres, pagination) avec le total de la sélection', querystring: filters.extend(page) } }, async (req) => {
    const { page: pg, pageSize, ...f } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const args = whereArgs(f);
      const { rows: agg } = await tx.query<{ n: number; total: number; unpaid: number }>(`SELECT count(*)::int AS n, COALESCE(sum(e.amount), 0)::bigint AS total, COALESCE(sum(e.amount) FILTER (WHERE e.paid_on IS NULL), 0)::bigint AS unpaid FROM expenses e WHERE ${where}`, args);
      const { rows } = await tx.query(`${EXPENSE_SELECT} WHERE ${where} ORDER BY e.incurred_on DESC, e.created_at DESC, e.id LIMIT $6 OFFSET $7`, [...args, pageSize, (pg - 1) * pageSize]);
      return { items: rows, total: agg[0]!.n, page: pg, pageSize, sum: agg[0]!.total, unpaidSum: agg[0]!.unpaid };
    });
  });

  r.get('/finances/expenses.csv', { preValidation: exportAuth, schema: { tags, summary: 'Exporter les dépenses en CSV (Excel) — formule avec exports, journalisé', querystring: filters } }, async (req, reply) => {
    const me = req.hotel!;
    const rows = await me.tenant(async (tx) => {
      const { rows: list } = await tx.query(`${EXPENSE_SELECT} WHERE ${where} ORDER BY e.incurred_on, e.created_at, e.id`, whereArgs(req.query));
      await auditHotel(tx, me, 'finance.exported', { type: 'expense' }, `Export CSV de ${list.length} dépenses`, { ip: req.ip, requestId: req.id });
      return list;
    });
    const csv = toCsv(['Date', 'Catégorie', 'Description', 'Fournisseur', 'Montant', 'Devise', 'Payée le', 'Moyen'], rows.map((e: any) => [e.incurredOn, e.categoryName, e.description, e.supplier, e.amount, e.currency, e.paidOn, e.methodCode]));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="depenses-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
  });

  const expenseBody = z.object({ categoryId: z.uuid(), description: z.string().trim().min(2).max(200), supplier: z.string().trim().max(120).nullable(), amount: money, incurredOn: date, paidOn: date.nullable(), methodCode: z.string().regex(/^[a-z0-9_]{2,30}$/).nullable() })
    .refine((b) => !b.paidOn || b.paidOn >= b.incurredOn, { message: 'Le paiement ne peut pas précéder la dépense.', path: ['paidOn'] });
  const EXPENSE_COLUMNS = { categoryId: 'category_id', description: 'description', supplier: 'supplier', amount: 'amount', incurredOn: 'incurred_on', paidOn: 'paid_on', methodCode: 'method_code' };

  r.post('/finances/expenses', { preValidation: manage, schema: { tags, summary: 'Enregistrer une dépense (dans la devise de l\'établissement)', body: expenseBody } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const cat = await tx.query('SELECT 1 FROM expense_categories WHERE id = $1 AND is_active', [b.categoryId]);
      if (!cat.rowCount) throw new AppError('not_found');
      if (b.methodCode) {
        const m = await tx.query('SELECT 1 FROM payment_methods WHERE code = $1', [b.methodCode]);
        if (!m.rowCount) throw new AppError('payment_method_unavailable');
      }
      const { rows } = await tx.query<{ id: string }>(
        'INSERT INTO expenses (hotel_id, category_id, description, supplier, amount, currency, incurred_on, paid_on, method_code, created_by_membership_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [me.hotelId, b.categoryId, b.description, b.supplier, b.amount, clock.currency, b.incurredOn, b.paidOn, b.methodCode, me.membershipId],
      );
      await auditHotel(tx, me, 'finance.expense_created', { type: 'expense', id: rows[0]!.id }, `Dépense : ${b.description} (${b.amount})`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.patch('/finances/expenses/:id', { preValidation: manage, schema: { tags, summary: 'Modifier une dépense', params: id, body: z.object({ categoryId: z.uuid(), description: z.string().trim().min(2).max(200), supplier: z.string().trim().max(120).nullable(), amount: money, incurredOn: date, paidOn: date.nullable(), methodCode: z.string().regex(/^[a-z0-9_]{2,30}$/).nullable() }).partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('expenses', EXPENSE_COLUMNS, req.body, { column: 'id', value: req.params.id });
    await me.tenant(async (tx) => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('expense_not_found');
      await auditHotel(tx, me, 'finance.expense_updated', { type: 'expense', id: req.params.id }, `Dépense modifiée : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.delete('/finances/expenses/:id', { preValidation: manage, schema: { tags, summary: 'Supprimer une dépense saisie par erreur (tracé avec son contenu)', params: id } }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ description: string; amount: number }>('DELETE FROM expenses WHERE id = $1 RETURNING description, amount', [req.params.id]);
      if (!rows[0]) throw new AppError('expense_not_found');
      await auditHotel(tx, me, 'finance.expense_deleted', { type: 'expense', id: req.params.id }, `Dépense supprimée : ${rows[0].description} (${rows[0].amount})`, { before: rows[0], ip: req.ip, requestId: req.id });
    });
    return { deleted: true };
  });

  /* ------------------------------------------------------------------ Synthèse */
  r.get('/finances/summary', {
    preValidation: read,
    schema: { tags, summary: 'Synthèse de la période : encaissé (par moyen), dépenses (par catégorie), résultat de trésorerie, créances clients, dépenses à payer', querystring: z.object({ from: date.optional(), to: date.optional() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const to = req.query.to ?? clock.today;
      const from = req.query.from ?? `${to.slice(0, 7)}-01`;
      if (from > to) throw new AppError('validation_error', [{ path: 'to', message: 'La fin doit être après le début.' }]);
      const q = serialRows(tx);
      const [methods, cats, daily, recv, payable] = await Promise.all([
        q<{ code: string; label: string | null; collected: number; refunded: number }>(
          `SELECT p.method_code AS code, m.label, COALESCE(sum(p.base_amount) FILTER (WHERE p.kind <> 'refund'), 0)::bigint AS collected, COALESCE(sum(p.base_amount) FILTER (WHERE p.kind = 'refund'), 0)::bigint AS refunded
           FROM payments p LEFT JOIN payment_methods m ON m.hotel_id = p.hotel_id AND m.code = p.method_code
           WHERE p.status = 'confirmed' AND (p.received_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date GROUP BY p.method_code, m.label, m.sort_order ORDER BY m.sort_order NULLS LAST, p.method_code`,
          [from, to, clock.timezone],
        ),
        q<{ id: string; name: string; kind: string; total: number; paid: number }>(
          `SELECT c.id, c.name, c.kind, COALESCE(sum(e.amount), 0)::bigint AS total, COALESCE(sum(e.amount) FILTER (WHERE e.paid_on IS NOT NULL), 0)::bigint AS paid
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id AND c.hotel_id = e.hotel_id WHERE e.incurred_on BETWEEN $1::date AND $2::date GROUP BY c.id, c.name, c.kind ORDER BY sum(e.amount) DESC`,
          [from, to],
        ),
        q<{ day: string; collected: number; spent: number }>(
          `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day)
           SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                  COALESCE((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.base_amount ELSE p.base_amount END) FROM payments p WHERE p.status = 'confirmed' AND (p.received_at AT TIME ZONE $3)::date = d.day), 0)::bigint AS collected,
                  COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.incurred_on = d.day), 0)::bigint AS spent
           FROM days d ORDER BY d.day`,
          [from, to, clock.timezone],
        ),
        q<{ total: number; folios: number }>("SELECT COALESCE(sum(balance_due), 0)::bigint AS total, count(*)::int AS folios FROM folio_balances b JOIN folios f ON f.id = b.folio_id WHERE f.status = 'open' AND b.balance_due > 0 AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = f.reservation_id AND r.status = 'tentative')"),
        q<{ total: number; n: number }>('SELECT COALESCE(sum(amount), 0)::bigint AS total, count(*)::int AS n FROM expenses WHERE paid_on IS NULL'),
      ]);
      const collected = methods.reduce((s, m) => s + m.collected, 0);
      const refunded = methods.reduce((s, m) => s + m.refunded, 0);
      const spent = cats.reduce((s, c) => s + c.total, 0);
      const spentPaid = cats.reduce((s, c) => s + c.paid, 0);
      if (daily.length > 400) throw new AppError('validation_error', [{ path: 'from', message: 'Période trop longue (400 jours au plus).' }]);
      return {
        from, to, currency: clock.currency,
        collected: { gross: collected, refunded, net: collected - refunded, byMethod: methods },
        expenses: { total: spent, paid: spentPaid, unpaid: spent - spentPaid, byCategory: cats },
        cashResult: collected - refunded - spentPaid,
        receivables: { total: recv[0]!.total, folios: recv[0]!.folios },
        payables: { total: payable[0]!.total, count: payable[0]!.n },
        daily,
      };
    });
  });
}
