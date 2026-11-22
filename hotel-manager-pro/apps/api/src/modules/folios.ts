import { isCurrency, isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { withIdempotency } from '../lib/idempotency';
import { serialRows } from '../lib/query';
import { buildUpdate } from '../lib/sql';
import { convertMinor, folioBalance, latestRate, lockFolio } from '../services/folio';
import { renderInvoicePdf } from '../services/invoice-pdf';
import { hotelClock } from '../services/reservations';

const money = z.number().int().min(0).max(1_000_000_000_000);
const signed = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const currencyCode = z.string().refine(isCurrency, 'Devise inconnue (MGA, EUR ou USD).');
const id = z.object({ id: z.uuid() });
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

const taxRuleBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(['percentage', 'fixed_per_person_night']),
    rateBps: z.number().int().min(0).max(100000).nullable(),
    fixedAmount: money.nullable(),
    isInclusive: z.boolean(),
    appliesTo: z.array(z.enum(['room', 'restaurant', 'service', 'other'])).min(1),
    isActive: z.boolean(),
    validFrom: date.nullable(),
    validTo: date.nullable(),
  })
  .refine((v) => v.kind !== 'percentage' || v.rateBps !== null, { message: 'Indiquez le taux.', path: ['rateBps'] })
  .refine((v) => v.kind !== 'fixed_per_person_night' || v.fixedAmount !== null, { message: 'Indiquez le montant.', path: ['fixedAmount'] })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, { message: 'La fin doit être après le début.', path: ['validTo'] });
const TAX_COLUMNS = { name: 'name', kind: 'kind', rateBps: 'rate_bps', fixedAmount: 'fixed_amount', isInclusive: 'is_inclusive', appliesTo: 'applies_to', isActive: 'is_active', validFrom: 'valid_from', validTo: 'valid_to' };

const SELECT_CHARGES = `SELECT c.id, c.kind, c.description, c.quantity, c.unit_amount AS "unitAmount", c.amount, c.tax_amount AS "taxAmount",
         to_char(c.service_date, 'YYYY-MM-DD') AS "serviceDate", c.source, c.invoice_id AS "invoiceId", i.number AS "invoiceNumber",
         c.voided_at AS "voidedAt", c.void_reason AS "voidReason", c.created_at AS "createdAt"
  FROM folio_charges c LEFT JOIN invoices i ON i.id = c.invoice_id AND i.hotel_id = c.hotel_id`;

async function loadFolio(tx: Tx, folioId: string) {
  const q = serialRows(tx);
  const [head] = await q<any>(
    `SELECT f.id, f.status, f.currency, f.reservation_id AS "reservationId", r.reference AS "reservationReference", r.status AS "reservationStatus",
            g.id AS "guestId", g.first_name || ' ' || g.last_name AS "guestName", g.email AS "guestEmail",
            b.charges_total AS "chargesTotal", b.payments_total AS "paymentsTotal", b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus",
            r.deposit_required_amount AS "depositRequired"
     FROM folios f
     JOIN folio_balances b ON b.folio_id = f.id AND b.hotel_id = f.hotel_id
     LEFT JOIN reservations r ON r.id = f.reservation_id AND r.hotel_id = f.hotel_id
     LEFT JOIN guests g ON g.id = f.guest_id AND g.hotel_id = f.hotel_id
     WHERE f.id = $1`,
    [folioId],
  );
  if (!head) throw new AppError('folio_not_found');
  const [charges, payments, invoices] = await Promise.all([
    q<any>(`${SELECT_CHARGES} WHERE c.folio_id = $1 ORDER BY c.created_at, c.id`, [folioId]),
    q<any>(
      `SELECT p.id, p.kind, p.method_code AS "methodCode", m.label AS "methodLabel", p.amount, p.currency, p.exchange_rate AS "exchangeRate", p.base_amount AS "baseAmount",
              p.reference, p.status, p.reason, p.refund_of_payment_id AS "refundOfId", p.received_at AS "receivedAt",
              COALESCE((SELECT sum(x.amount) FROM payments x WHERE x.hotel_id = p.hotel_id AND x.refund_of_payment_id = p.id AND x.status = 'confirmed'), 0) AS "refundedAmount"
       FROM payments p LEFT JOIN payment_methods m ON m.hotel_id = p.hotel_id AND m.code = p.method_code
       WHERE p.folio_id = $1 ORDER BY p.received_at, p.created_at, p.id`,
      [folioId],
    ),
    q<any>(
      `SELECT i.id, i.kind, i.number, i.status, i.total_amount AS total, i.issued_at AS "issuedAt", i.credit_for_invoice_id AS "creditForId"
       FROM invoices i WHERE i.folio_id = $1 ORDER BY i.issued_at NULLS LAST, i.created_at`,
      [folioId],
    ),
  ]);
  return { ...head, charges, payments, invoices };
}

export default async function folioRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const billingRead = app.hotelAuth({ permission: 'billing:read' });
  const billingManage = app.hotelAuth({ permission: 'billing:manage' });
  const billingVoid = app.hotelAuth({ permission: 'billing:void' });
  const paymentsRead = app.hotelAuth({ permission: 'payments:read' });
  const paymentsRecord = app.hotelAuth({ permission: 'payments:record' });
  const paymentsRefund = app.hotelAuth({ permission: 'payments:refund' });
  const settingsManage = app.hotelAuth({ permission: 'settings:manage' });
  const tags = ['Facturation client'];

  /* ------------------------------------------------------------------ Notes (folios) */
  r.get('/folios', {
    preValidation: billingRead,
    schema: {
      tags,
      summary: 'Notes des clients : charges, paiements et solde de chaque réservation',
      querystring: z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['open', 'closed']).optional(), payment: z.enum(['unpaid', 'partially_paid', 'paid', 'no_charges']).optional(), due: z.enum(['true']).optional(), ...page }),
    },
  }, async (req) => {
    const { q, status, payment, due, page: pg, pageSize } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const where = `($1::text IS NULL OR r.reference ILIKE '%' || $1 || '%' OR g.first_name ILIKE '%' || $1 || '%' OR g.last_name ILIKE '%' || $1 || '%' OR (g.first_name || ' ' || g.last_name) ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR f.status = $2) AND ($3::text IS NULL OR b.payment_status = $3) AND ($4::boolean IS NOT TRUE OR b.balance_due > 0)`;
      const args = [q || null, status ?? null, payment ?? null, due === 'true'];
      const from = `FROM folios f JOIN folio_balances b ON b.folio_id = f.id AND b.hotel_id = f.hotel_id LEFT JOIN reservations r ON r.id = f.reservation_id AND r.hotel_id = f.hotel_id LEFT JOIN guests g ON g.id = f.guest_id AND g.hotel_id = f.hotel_id`;
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n ${from} WHERE ${where}`, args);
      const { rows } = await tx.query(
        `SELECT f.id, f.status, f.currency, r.id AS "reservationId", r.reference, r.status AS "reservationStatus", g.id AS "guestId", g.first_name || ' ' || g.last_name AS "guestName",
                b.charges_total AS "chargesTotal", b.payments_total AS "paymentsTotal", b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus", f.created_at AS "createdAt"
         ${from} WHERE ${where} ORDER BY f.created_at DESC, f.id LIMIT $5 OFFSET $6`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: pg, pageSize };
    });
  });

  r.get('/folios/:id', { preValidation: billingRead, schema: { tags, summary: 'Note d\'un client : charges, paiements (avec remboursements), factures, solde', params: id } }, async (req) =>
    req.hotel!.tenant((tx) => loadFolio(tx, req.params.id)),
  );

  /* ------------------------------------------------------------------ Charges */
  r.post('/folios/:id/charges', {
    preValidation: billingManage,
    schema: {
      tags,
      summary: 'Ajouter une charge à la note (service, frais, remise, ajustement)',
      params: id,
      body: z.object({
        kind: z.enum(['service', 'fee', 'discount', 'adjustment']),
        description: z.string().trim().min(2).max(200),
        quantity: z.number().min(0.001).max(10000).default(1),
        unitAmount: signed,
        taxRuleId: z.uuid().nullish(),
        serviceDate: date.optional(),
      }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    if (b.kind !== 'adjustment' && b.unitAmount < 0) throw new AppError('validation_error', [{ path: 'unitAmount', message: 'Le montant doit être positif.' }]);
    const created = await me.tenant(async (tx) => {
      const folio = await lockFolio(tx, req.params.id);
      if (folio.status !== 'open') throw new AppError('folio_closed');
      let amount = Math.round(b.quantity * b.unitAmount);
      let tax = 0;
      if (b.kind === 'discount') amount = -Math.abs(amount);
      if (b.taxRuleId && b.kind !== 'discount') {
        const { rows } = await tx.query<{ kind: string; rate_bps: number | null; is_inclusive: boolean; is_active: boolean }>('SELECT kind, rate_bps, is_inclusive, is_active FROM tax_rules WHERE id = $1', [b.taxRuleId]);
        const rule = rows[0];
        if (!rule) throw new AppError('tax_rule_not_found');
        if (rule.kind !== 'percentage' || !rule.is_active) throw new AppError('validation_error', [{ path: 'taxRuleId', message: 'Seule une taxe en pourcentage active peut s\'appliquer à une charge.' }]);
        const bps = rule.rate_bps ?? 0;
        if (rule.is_inclusive) { const net = Math.round((amount * 10_000) / (10_000 + bps)); tax = amount - net; amount = net; }
        else tax = Math.round((amount * bps) / 10_000);
        if (tax < 0) tax = 0;
      }
      const clock = await hotelClock(tx, app.deps.now());
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, quantity, unit_amount, amount, tax_rule_id, tax_amount, service_date, source, created_by_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11) RETURNING id`,
        [me.hotelId, folio.id, b.kind, b.description, b.quantity, b.unitAmount, amount, b.taxRuleId ?? null, tax, b.serviceDate ?? clock.today, me.membershipId],
      );
      await auditHotel(tx, me, 'folio.charge_added', { type: 'folio', id: folio.id }, `Charge ajoutée : ${b.description} (${amount + tax})`, { after: { kind: b.kind, amount, tax }, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.post('/folios/:id/charges/:chargeId/void', {
    preValidation: billingManage,
    schema: { tags, summary: 'Annuler une charge non facturée (motif obligatoire)', params: z.object({ id: z.uuid(), chargeId: z.uuid() }), body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const folio = await lockFolio(tx, req.params.id);
      if (folio.status !== 'open') throw new AppError('folio_closed');
      const { rows } = await tx.query<{ source: string; invoice_id: string | null; voided_at: Date | null; description: string }>('SELECT source, invoice_id, voided_at, description FROM folio_charges WHERE id = $1 AND folio_id = $2 FOR UPDATE', [req.params.chargeId, folio.id]);
      const c = rows[0];
      if (!c || c.voided_at) throw new AppError('charge_not_found');
      if (c.source === 'reservation') throw new AppError('charge_not_voidable');
      if (c.invoice_id) throw new AppError('charge_already_invoiced');
      await tx.query('UPDATE folio_charges SET voided_at = now(), void_reason = $2 WHERE id = $1', [req.params.chargeId, req.body.reason]);
      await auditHotel(tx, me, 'folio.charge_voided', { type: 'folio', id: folio.id }, `Charge annulée : ${c.description} — ${req.body.reason}`, { ip: req.ip, requestId: req.id });
    });
    return { voided: true };
  });

  /* ------------------------------------------------------------------ Paiements */
  r.post('/folios/:id/payments', {
    preValidation: paymentsRecord,
    schema: {
      tags,
      summary: 'Enregistrer un encaissement (espèces, Mobile Money, carte, virement) — saisie manuelle par la réception',
      description: "Aucun prélèvement automatique : la réception saisit ce qu'elle a réellement reçu (et la référence de la transaction hors espèces). Paiement en devise étrangère : taux enregistré ou saisi, conservé avec le paiement. En-tête facultatif `Idempotency-Key`.",
      params: id,
      body: z.object({
        kind: z.enum(['deposit', 'payment']).default('payment'),
        methodCode: z.string().regex(/^[a-z0-9_]{2,30}$/),
        amount: z.number().int().min(1).max(1_000_000_000_000),
        currency: currencyCode,
        exchangeRate: z.number().positive().max(1_000_000).optional(),
        reference: z.string().trim().max(100).nullish(),
      }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const out = await me.tenant((tx) =>
      withIdempotency(tx, me.hotelId, req.headers['idempotency-key'], 'payment', { folio: req.params.id, ...b }, async () => {
        const folio = await lockFolio(tx, req.params.id);
        if (folio.status !== 'open') throw new AppError('folio_closed');
        const { rows: method } = await tx.query<{ kind: string; is_active: boolean }>('SELECT kind, is_active FROM payment_methods WHERE code = $1', [b.methodCode]);
        if (!method[0] || !method[0].is_active) throw new AppError('payment_method_unavailable');
        if (method[0].kind !== 'cash' && !b.reference?.trim()) throw new AppError('payment_reference_required');

        let rate = 1;
        if (b.currency !== folio.currency) {
          const r2 = b.exchangeRate ?? (await latestRate(tx, b.currency, folio.currency));
          if (!r2) throw new AppError('exchange_rate_required');
          rate = r2;
        }
        const base = convertMinor(b.amount, b.currency, folio.currency, rate);
        if (base < 1) throw new AppError('validation_error', [{ path: 'amount', message: 'Montant trop faible une fois converti.' }]);
        const bal = await folioBalance(tx, folio.id);
        if (base > bal.due) throw new AppError('folio_payment_exceeds_due', { due: bal.due });
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO payments (hotel_id, folio_id, kind, method_code, amount, currency, exchange_rate, base_amount, reference, status, received_by_membership_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10) RETURNING id`,
          [me.hotelId, folio.id, b.kind, b.methodCode, b.amount, b.currency, rate, base, b.reference?.trim() || null, me.membershipId],
        );
        await auditHotel(tx, me, 'payment.recorded', { type: 'payment', id: rows[0]!.id }, `Encaissement ${b.amount} ${b.currency} (${b.methodCode})`, { after: { folioId: folio.id, amount: b.amount, currency: b.currency, base }, ip: req.ip, requestId: req.id });
        return { status: 201, body: { id: rows[0]!.id, baseAmount: base, balanceDue: bal.due - base } };
      }),
    );
    return reply.code(out.status).send(out.body);
  });

  r.post('/payments/:id/refund', {
    preValidation: paymentsRefund,
    schema: {
      tags,
      summary: 'Rembourser tout ou partie d\'un paiement (jamais plus que le paiement) ; une erreur de saisie se corrige ainsi, un paiement ne se modifie ni ne se supprime',
      params: id,
      body: z.object({ amount: z.number().int().min(1).max(1_000_000_000_000), reason: z.string().trim().min(3).max(300), methodCode: z.string().regex(/^[a-z0-9_]{2,30}$/).optional(), reference: z.string().trim().max(100).nullish() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ folio_id: string; kind: string; status: string; method_code: string; amount: number; currency: string; exchange_rate: number; base_amount: number }>(
        'SELECT folio_id, kind, status, method_code, amount, currency, exchange_rate, base_amount FROM payments WHERE id = $1',
        [req.params.id],
      );
      const p = rows[0];
      if (!p) throw new AppError('payment_not_found');
      if (!p.folio_id) throw new AppError('refund_invalid_target');
      const folio = await lockFolio(tx, p.folio_id);
      // Part déjà remboursée (le contrôle définitif, sous verrou, est fait par la base)
      const { rows: done } = await tx.query<{ amount: number; base: number }>("SELECT COALESCE(sum(amount), 0) AS amount, COALESCE(sum(base_amount), 0) AS base FROM payments WHERE refund_of_payment_id = $1 AND status IN ('pending', 'confirmed')", [req.params.id]);
      const alreadyAmount = done[0]!.amount;
      const base = alreadyAmount + b.amount === p.amount ? p.base_amount - done[0]!.base : Math.round((p.base_amount * b.amount) / p.amount);
      const method = b.methodCode ?? p.method_code;
      const { rows: m } = await tx.query<{ kind: string }>('SELECT kind FROM payment_methods WHERE code = $1', [method]);
      if (!m[0]) throw new AppError('payment_method_unavailable');
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO payments (hotel_id, folio_id, kind, method_code, amount, currency, exchange_rate, base_amount, reference, status, refund_of_payment_id, reason, received_by_membership_id)
         VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11) RETURNING id`,
        [me.hotelId, folio.id, method, b.amount, p.currency, p.exchange_rate, Math.max(base, 1), b.reference?.trim() || null, req.params.id, b.reason, me.membershipId],
      );
      await auditHotel(tx, me, 'payment.refunded', { type: 'payment', id: req.params.id }, `Remboursement ${b.amount} ${p.currency} : ${b.reason}`, { after: { refundId: ins.rows[0]!.id, amount: b.amount }, ip: req.ip, requestId: req.id });
      return ins.rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.get('/payments', {
    preValidation: paymentsRead,
    schema: {
      tags,
      summary: 'Journal des encaissements et remboursements',
      querystring: z.object({ from: date.optional(), to: date.optional(), method: z.string().max(30).optional(), kind: z.enum(['deposit', 'payment', 'refund']).optional(), ...page }),
    },
  }, async (req) => {
    const { from, to, method, kind, page: pg, pageSize } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const where = `p.status = 'confirmed' AND ($1::date IS NULL OR (p.received_at AT TIME ZONE $5)::date >= $1) AND ($2::date IS NULL OR (p.received_at AT TIME ZONE $5)::date <= $2)
        AND ($3::text IS NULL OR p.method_code = $3) AND ($4::text IS NULL OR p.kind = $4)`;
      const args = [from ?? null, to ?? null, method ?? null, kind ?? null, clock.timezone];
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments p WHERE ${where}`, args);
      const { rows } = await tx.query(
        `SELECT p.id, p.kind, p.method_code AS "methodCode", m.label AS "methodLabel", p.amount, p.currency, p.base_amount AS "baseAmount", p.reference, p.reason, p.received_at AS "receivedAt",
                f.id AS "folioId", r.reference AS "reservationReference", g.first_name || ' ' || g.last_name AS "guestName", f.currency AS "folioCurrency"
         FROM payments p
         LEFT JOIN payment_methods m ON m.hotel_id = p.hotel_id AND m.code = p.method_code
         LEFT JOIN folios f ON f.id = p.folio_id AND f.hotel_id = p.hotel_id
         LEFT JOIN reservations r ON r.id = f.reservation_id AND r.hotel_id = p.hotel_id
         LEFT JOIN guests g ON g.id = f.guest_id AND g.hotel_id = p.hotel_id
         WHERE ${where} ORDER BY p.received_at DESC, p.id LIMIT $6 OFFSET $7`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      const { rows: sums } = await tx.query<{ kind: string; total: number }>(`SELECT p.kind, sum(p.base_amount)::bigint AS total FROM payments p WHERE ${where} GROUP BY p.kind`, args);
      const net = sums.reduce((s, x) => s + (x.kind === 'refund' ? -x.total : x.total), 0);
      return { items: rows, total: total[0]!.n, page: pg, pageSize, netCollected: net, currency: clock.currency };
    });
  });

  /* ------------------------------------------------------------------ Factures et avoirs */
  r.post('/folios/:id/invoices', {
    preValidation: billingManage,
    schema: {
      tags,
      summary: 'Émettre une facture à partir des charges non facturées de la note (numéro séquentiel sans trou, immuable)',
      params: id,
      body: z.object({ chargeIds: z.array(z.uuid()).min(1).max(200).optional(), dueDays: z.number().int().min(0).max(120).default(0), notes: z.string().trim().max(500).nullish() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const folio = await lockFolio(tx, req.params.id);
      const { rows: charges } = await tx.query<{ id: string; description: string; quantity: number; unit_amount: number; amount: number; tax_amount: number; tax_rule_id: string | null }>(
        `SELECT c.id, c.description, c.quantity, c.unit_amount, c.amount, c.tax_amount, c.tax_rule_id FROM folio_charges c
         WHERE c.folio_id = $1 AND c.voided_at IS NULL AND c.invoice_id IS NULL AND ($2::uuid[] IS NULL OR c.id = ANY ($2))
         ORDER BY c.service_date, c.created_at, c.id`,
        [folio.id, b.chargeIds ?? null],
      );
      if (b.chargeIds && charges.length !== new Set(b.chargeIds).size) throw new AppError('charge_not_found');
      const subtotal = charges.reduce((s, c) => s + c.amount, 0);
      const tax = charges.reduce((s, c) => s + c.tax_amount, 0);
      if (charges.length === 0 || subtotal + tax <= 0) throw new AppError('nothing_to_invoice');
      return issueInvoice(tx, me, app.deps.now(), { folioId: folio.id, kind: 'invoice', currency: folio.currency, lines: charges.map((c) => ({ chargeId: c.id, description: c.description, quantity: c.quantity, unitAmount: c.unit_amount, amount: c.amount, taxAmount: c.tax_amount })), subtotal, tax, dueDays: b.dueDays, notes: b.notes ?? null, req });
    });
    return reply.code(201).send(created);
  });

  r.get('/invoices', {
    preValidation: billingRead,
    schema: {
      tags,
      summary: 'Factures et avoirs émis',
      querystring: z.object({ q: z.string().trim().max(100).optional(), kind: z.enum(['invoice', 'credit_note']).optional(), status: z.enum(['issued', 'void']).optional(), ...page }),
    },
  }, async (req) => {
    const { q, kind, status, page: pg, pageSize } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const where = `($1::text IS NULL OR i.number ILIKE '%' || $1 || '%' OR i.billing_snapshot->'guest'->>'name' ILIKE '%' || $1 || '%' OR r.reference ILIKE '%' || $1 || '%') AND ($2::text IS NULL OR i.kind = $2) AND ($3::text IS NULL OR i.status = $3)`;
      const args = [q || null, kind ?? null, status ?? null];
      const from = 'FROM invoices i LEFT JOIN reservations r ON r.id = i.reservation_id AND r.hotel_id = i.hotel_id';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n ${from} WHERE i.status <> 'draft' AND ${where}`, args);
      const { rows } = await tx.query(
        `SELECT i.id, i.kind, i.number, i.status, i.currency, i.subtotal_amount AS subtotal, i.tax_amount AS tax, i.total_amount AS total, i.issued_at AS "issuedAt", i.due_at AS "dueAt",
                i.billing_snapshot->'guest'->>'name' AS "guestName", r.reference AS "reservationReference", i.folio_id AS "folioId", i.credit_for_invoice_id AS "creditForId",
                COALESCE((SELECT sum(c.total_amount) FROM invoices c WHERE c.hotel_id = i.hotel_id AND c.credit_for_invoice_id = i.id AND c.status = 'issued'), 0) AS credited
         ${from} WHERE i.status <> 'draft' AND ${where} ORDER BY i.issued_at DESC, i.id LIMIT $4 OFFSET $5`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: pg, pageSize };
    });
  });

  const loadInvoice = async (tx: Tx, invoiceId: string) => {
    const q = serialRows(tx);
    const [inv] = await q<any>(
      `SELECT i.id, i.kind, i.number, i.status, i.currency, i.subtotal_amount AS subtotal, i.tax_amount AS tax, i.total_amount AS total, i.issued_at AS "issuedAt", i.due_at AS "dueAt",
              i.voided_at AS "voidedAt", i.void_reason AS "voidReason", i.billing_snapshot AS snapshot, i.notes, i.folio_id AS "folioId", i.reservation_id AS "reservationId",
              i.credit_for_invoice_id AS "creditForId", ci.number AS "creditForNumber", r.reference AS "reservationReference"
       FROM invoices i LEFT JOIN invoices ci ON ci.id = i.credit_for_invoice_id AND ci.hotel_id = i.hotel_id LEFT JOIN reservations r ON r.id = i.reservation_id AND r.hotel_id = i.hotel_id
       WHERE i.id = $1 AND i.status <> 'draft'`,
      [invoiceId],
    );
    if (!inv) throw new AppError('invoice_not_found');
    const lines = await q<any>('SELECT description, quantity, unit_amount AS "unitAmount", amount, tax_amount AS "taxAmount" FROM invoice_lines WHERE invoice_id = $1 ORDER BY position, id', [invoiceId]);
    const credits = await q<any>("SELECT id, number, total_amount AS total, issued_at AS \"issuedAt\" FROM invoices WHERE credit_for_invoice_id = $1 AND status = 'issued' ORDER BY issued_at", [invoiceId]);
    return { ...inv, lines, credits };
  };

  r.get('/invoices/:id', { preValidation: billingRead, schema: { tags, summary: 'Détail d\'une facture ou d\'un avoir', params: id } }, async (req) => req.hotel!.tenant((tx) => loadInvoice(tx, req.params.id)));

  r.get('/invoices/:id/pdf', { preValidation: billingRead, schema: { tags, summary: 'Facture ou avoir en PDF (A4), généré à partir des données figées à l\'émission', params: id } }, async (req, reply) => {
    const me = req.hotel!;
    const data = await me.tenant(async (tx) => {
      const inv = await loadInvoice(tx, req.params.id);
      const clock = await hotelClock(tx, app.deps.now());
      const { rows: s } = await tx.query<{ invoice_header: string | null; invoice_footer: string | null }>('SELECT invoice_header, invoice_footer FROM hotel_settings LIMIT 1');
      let paid: number | null = null;
      if (inv.kind === 'invoice' && inv.folioId) paid = (await folioBalance(tx, inv.folioId)).paid;
      return { inv, clock, settings: s[0]!, paid };
    });
    const { inv, clock, settings, paid } = data;
    const snap = inv.snapshot ?? {};
    const pdf = await renderInvoicePdf({
      kind: inv.kind, number: inv.number, status: inv.status, currency: inv.currency, issuedAt: new Date(inv.issuedAt), dueAt: inv.dueAt ? new Date(inv.dueAt) : null, timezone: clock.timezone,
      hotel: snap.hotel ?? { name: me.hotelName }, guest: snap.guest ?? { name: '—' }, reference: inv.reservationReference ?? null, creditedInvoiceNumber: inv.creditForNumber ?? null,
      lines: inv.lines, subtotal: inv.subtotal, tax: inv.tax, total: inv.total, paid, header: settings.invoice_header, footer: settings.invoice_footer, voidReason: inv.voidReason,
    });
    await me.tenant((tx) => auditHotel(tx, me, 'invoice.downloaded', { type: 'invoice', id: req.params.id }, `PDF téléchargé : ${inv.number}`, { ip: req.ip, requestId: req.id }));
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${String(inv.number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`).header('cache-control', 'private, no-store').send(pdf);
  });

  r.post('/invoices/:id/void', {
    preValidation: billingVoid,
    schema: { tags, summary: 'Annuler une facture émise qui n\'a donné lieu à aucun avoir (ses charges redeviennent facturables) ; sinon, émettre un avoir', params: id, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ status: string; kind: string; number: string }>('SELECT status, kind, number FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
      const inv = rows[0];
      if (!inv || inv.status === 'draft') throw new AppError('invoice_not_found');
      if (inv.status !== 'issued' || inv.kind !== 'invoice') throw new AppError('invoice_not_voidable');
      const credits = await tx.query("SELECT 1 FROM invoices WHERE credit_for_invoice_id = $1 AND status = 'issued' LIMIT 1", [req.params.id]);
      if (credits.rowCount) throw new AppError('invoice_not_voidable');
      await tx.query("UPDATE invoices SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1", [req.params.id, req.body.reason]);
      await tx.query('UPDATE folio_charges SET invoice_id = NULL WHERE invoice_id = $1', [req.params.id]);
      await auditHotel(tx, me, 'invoice.voided', { type: 'invoice', id: req.params.id }, `Facture ${inv.number} annulée : ${req.body.reason}`, { ip: req.ip, requestId: req.id });
    });
    return { voided: true };
  });

  r.post('/invoices/:id/credit-notes', {
    preValidation: billingManage,
    schema: {
      tags,
      summary: 'Émettre un avoir (total, ou partiel avec `amount` TTC) sur une facture émise ; la note du client est créditée du même montant',
      params: id,
      body: z.object({ reason: z.string().trim().min(3).max(300), amount: z.number().int().min(1).max(1_000_000_000_000).optional() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string; kind: string; status: string; number: string; folio_id: string | null; currency: string; subtotal_amount: number; tax_amount: number; total_amount: number; billing_snapshot: unknown; reservation_id: string | null }>(
        'SELECT id, kind, status, number, folio_id, currency, subtotal_amount, tax_amount, total_amount, billing_snapshot, reservation_id FROM invoices WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const inv = rows[0];
      if (!inv || inv.status === 'draft') throw new AppError('invoice_not_found');
      if (inv.kind !== 'invoice' || inv.status !== 'issued' || !inv.folio_id) throw new AppError('credit_note_invalid_target');
      const { rows: prior } = await tx.query<{ n: number }>("SELECT COALESCE(sum(total_amount), 0) AS n FROM invoices WHERE credit_for_invoice_id = $1 AND status = 'issued'", [req.params.id]);
      const remaining = inv.total_amount - prior[0]!.n;
      const total = b.amount ?? remaining;
      if (total < 1 || total > remaining) throw new AppError('credit_exceeds_invoice', { remaining });
      let lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number }>;
      if (total === inv.total_amount) {
        const { rows: orig } = await tx.query<{ description: string; quantity: number; unit_amount: number; amount: number; tax_amount: number }>('SELECT description, quantity, unit_amount, amount, tax_amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY position, id', [inv.id]);
        lines = orig.map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: l.unit_amount, amount: l.amount, taxAmount: l.tax_amount }));
      } else {
        const net = Math.round((total * inv.subtotal_amount) / inv.total_amount);
        lines = [{ description: `Avoir partiel sur la facture ${inv.number} — ${b.reason}`, quantity: 1, unitAmount: net, amount: net, taxAmount: total - net }];
      }
      const subtotal = lines.reduce((s, l) => s + l.amount, 0);
      const tax = lines.reduce((s, l) => s + l.taxAmount, 0);
      const credit = await issueInvoice(tx, me, app.deps.now(), { folioId: inv.folio_id, kind: 'credit_note', creditFor: inv.id, currency: inv.currency, lines, subtotal, tax, dueDays: 0, notes: b.reason, req, snapshotFrom: inv.billing_snapshot, reservationId: inv.reservation_id });
      // La note du client est créditée du montant de l'avoir (charge d'ajustement négative, hors facturation)
      await tx.query(
        `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, quantity, unit_amount, amount, tax_amount, service_date, source, source_ref, invoice_id, created_by_membership_id)
         VALUES ($1, $2, 'adjustment', $3, 1, $4, $4, 0, current_date, 'manual', $5, $5, $6)`,
        [me.hotelId, inv.folio_id, `Avoir ${credit.number} sur ${inv.number}`, -total, credit.id, me.membershipId],
      );
      return credit;
    });
    return reply.code(201).send(created);
  });

  /* ------------------------------------------------------------------ Taxes, moyens de paiement, taux de change */
  r.get('/tax-rules', { preValidation: billingRead, schema: { tags, summary: 'Taxes de l\'établissement (TVA, taxe de séjour…)' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT id, name, kind, rate_bps AS "rateBps", fixed_amount AS "fixedAmount", applies_to AS "appliesTo", is_inclusive AS "isInclusive", is_active AS "isActive",
                to_char(valid_from, 'YYYY-MM-DD') AS "validFrom", to_char(valid_to, 'YYYY-MM-DD') AS "validTo"
         FROM tax_rules ORDER BY is_active DESC, name`,
      ),
    );
    return { taxRules: rows };
  });

  r.post('/tax-rules', { preValidation: settingsManage, schema: { tags, summary: 'Créer une taxe. Elle ne s\'applique qu\'aux NOUVELLES réservations : les réservations et factures existantes ne sont jamais recalculées.', body: taxRuleBody } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, fixed_amount, is_inclusive, applies_to, is_active, valid_from, valid_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [me.hotelId, b.name, b.kind, b.kind === 'percentage' ? b.rateBps : null, b.kind === 'fixed_per_person_night' ? b.fixedAmount : null, b.isInclusive, b.appliesTo, b.isActive, b.validFrom, b.validTo],
      );
      await auditHotel(tx, me, 'tax_rule.created', { type: 'tax_rule', id: rows[0]!.id }, `Taxe créée : ${b.name}`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.patch('/tax-rules/:id', {
    preValidation: settingsManage,
    schema: { tags, summary: 'Modifier une taxe (désactiver plutôt que supprimer)', params: id, body: z.object({ name: z.string().trim().min(2).max(80), rateBps: z.number().int().min(0).max(100000).nullable(), fixedAmount: money.nullable(), isInclusive: z.boolean(), appliesTo: z.array(z.enum(['room', 'restaurant', 'service', 'other'])).min(1), isActive: z.boolean(), validFrom: date.nullable(), validTo: date.nullable() }).partial() },
  }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('tax_rules', TAX_COLUMNS, req.body, { column: 'id', value: req.params.id });
    await me.tenant(async (tx) => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('tax_rule_not_found');
      await auditHotel(tx, me, 'tax_rule.updated', { type: 'tax_rule', id: req.params.id }, `Taxe modifiée : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.get('/payment-methods', { preValidation: billingRead, schema: { tags, summary: 'Moyens d\'encaissement de l\'établissement' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) => tx.query('SELECT code, label, kind, is_active AS "isActive", sort_order AS "sortOrder" FROM payment_methods ORDER BY sort_order, code'));
    return { methods: rows };
  });

  r.patch('/payment-methods/:code', {
    preValidation: settingsManage,
    schema: { tags, summary: 'Activer / désactiver un moyen d\'encaissement ou changer son libellé', params: z.object({ code: z.string().regex(/^[a-z0-9_]{2,30}$/) }), body: z.object({ isActive: z.boolean(), label: z.string().trim().min(2).max(60) }).partial() },
  }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('payment_methods', { isActive: 'is_active', label: 'label' }, req.body, { column: 'code', value: req.params.code });
    await me.tenant(async (tx) => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'payment_method.updated', { type: 'payment_method', id: null }, `Moyen d'encaissement ${req.params.code} modifié`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.get('/exchange-rates', { preValidation: billingRead, schema: { tags, summary: 'Taux de change saisis par l\'établissement (aucun service externe)' } }, async (req) => {
    const rates = await req.hotel!.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const res = await tx.query(
        `SELECT DISTINCT ON (base_currency) base_currency AS "baseCurrency", quote_currency AS "quoteCurrency", rate, effective_at AS "effectiveAt"
         FROM exchange_rates WHERE quote_currency = $1 AND effective_at <= now() ORDER BY base_currency, effective_at DESC`,
        [clock.currency],
      );
      return res.rows;
    });
    return { rates };
  });

  r.post('/exchange-rates', {
    preValidation: billingManage,
    schema: { tags, summary: 'Enregistrer le taux du jour : 1 unité de la devise étrangère = `rate` dans la devise de l\'établissement', body: z.object({ baseCurrency: currencyCode, rate: z.number().positive().max(1_000_000) }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    await me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      if (b.baseCurrency === clock.currency) throw new AppError('validation_error', [{ path: 'baseCurrency', message: "C'est déjà la devise de l'établissement." }]);
      await tx.query('INSERT INTO exchange_rates (hotel_id, base_currency, quote_currency, rate, created_by_membership_id) VALUES ($1, $2, $3, $4, $5)', [me.hotelId, b.baseCurrency, clock.currency, b.rate, me.membershipId]);
      await auditHotel(tx, me, 'exchange_rate.set', { type: 'exchange_rate' }, `Taux 1 ${b.baseCurrency} = ${b.rate} ${clock.currency}`, { after: b, ip: req.ip, requestId: req.id });
    });
    return reply.code(201).send({ saved: true });
  });
}

interface InvoiceInput {
  folioId: string; kind: 'invoice' | 'credit_note'; creditFor?: string; currency: string;
  lines: Array<{ chargeId?: string; description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number }>;
  subtotal: number; tax: number; dueDays: number; notes: string | null; req: { ip: string; id: string };
  snapshotFrom?: unknown; reservationId?: string | null;
}

/** Crée une facture (ou un avoir), lui attribue le prochain numéro sans trou et l'émet : elle est alors immuable. */
async function issueInvoice(tx: Tx, me: { hotelId: string; userId: string; membershipId: string }, now: Date, i: InvoiceInput): Promise<{ id: string; number: string; total: number }> {
  const clock = await hotelClock(tx, now);
  const year = clock.today.slice(0, 4);
  const { rows: s } = await tx.query<{ invoice_prefix: string }>('SELECT invoice_prefix FROM hotel_settings LIMIT 1');
  const key = i.kind === 'credit_note' ? `credit_note:${year}` : `invoice:${year}`;
  const { rows: ctr } = await tx.query<{ value: number }>('SELECT next_hotel_counter($1) AS value', [key]);
  const number = `${s[0]!.invoice_prefix}-${i.kind === 'credit_note' ? 'AV-' : ''}${year}-${String(ctr[0]!.value).padStart(4, '0')}`;

  let snapshot = i.snapshotFrom;
  let reservationId = i.reservationId ?? null;
  let guestId: string | null = null;
  if (!snapshot) {
    const { rows } = await tx.query<any>(
      `SELECT f.reservation_id, f.guest_id, h.name AS hotel_name, h.legal_name, h.tax_id, h.address AS hotel_address, h.city AS hotel_city, h.phone AS hotel_phone, h.email AS hotel_email,
              g.first_name, g.last_name, g.email AS g_email, g.phone AS g_phone, g.address AS g_address, g.city AS g_city, g.country AS g_country
       FROM folios f JOIN hotels h ON h.id = f.hotel_id LEFT JOIN guests g ON g.id = f.guest_id AND g.hotel_id = f.hotel_id WHERE f.id = $1`,
      [i.folioId],
    );
    const x = rows[0];
    reservationId = x.reservation_id;
    guestId = x.guest_id;
    snapshot = {
      hotel: { name: x.hotel_name, legalName: x.legal_name, taxId: x.tax_id, address: x.hotel_address, city: x.hotel_city, phone: x.hotel_phone, email: x.hotel_email },
      guest: { name: x.first_name ? `${x.first_name} ${x.last_name}` : '—', email: x.g_email, phone: x.g_phone, address: x.g_address, city: x.g_city, country: x.g_country },
    };
  } else {
    const { rows } = await tx.query<{ guest_id: string | null }>('SELECT guest_id FROM folios WHERE id = $1', [i.folioId]);
    guestId = rows[0]?.guest_id ?? null;
  }

  const { rows: inv } = await tx.query<{ id: string }>(
    `INSERT INTO invoices (hotel_id, folio_id, reservation_id, guest_id, kind, credit_for_invoice_id, currency, subtotal_amount, tax_amount, total_amount, billing_snapshot, notes, created_by_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13) RETURNING id`,
    [me.hotelId, i.folioId, reservationId, guestId, i.kind, i.creditFor ?? null, i.currency, i.subtotal, i.tax, i.subtotal + i.tax, JSON.stringify(snapshot), i.notes, me.membershipId],
  );
  const invoiceId = inv[0]!.id;
  for (const [pos, l] of i.lines.entries()) {
    await tx.query(
      'INSERT INTO invoice_lines (hotel_id, invoice_id, folio_charge_id, position, description, quantity, unit_amount, amount, tax_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [me.hotelId, invoiceId, l.chargeId ?? null, pos, l.description, l.quantity, l.unitAmount, l.amount, l.taxAmount],
    );
  }
  const issuedAt = now;
  const due = new Date(issuedAt.getTime() + i.dueDays * 86_400_000);
  await tx.query("UPDATE invoices SET status = 'issued', number = $2, issued_at = $3, due_at = $4 WHERE id = $1", [invoiceId, number, issuedAt, i.dueDays > 0 ? due : null]);
  const chargeIds = i.lines.map((l) => l.chargeId).filter(Boolean);
  if (chargeIds.length) await tx.query('UPDATE folio_charges SET invoice_id = $1 WHERE id = ANY ($2::uuid[])', [invoiceId, chargeIds]);
  await auditHotel(tx, me, i.kind === 'credit_note' ? 'invoice.credit_note_issued' : 'invoice.issued', { type: 'invoice', id: invoiceId }, `${i.kind === 'credit_note' ? 'Avoir' : 'Facture'} ${number} émis(e) : ${i.subtotal + i.tax}`, { after: { number, total: i.subtotal + i.tax }, ip: i.req.ip, requestId: i.req.id });
  return { id: invoiceId, number, total: i.subtotal + i.tax };
}
