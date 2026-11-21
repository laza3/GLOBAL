import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditPlatform } from '../lib/audit';
import { serialRows } from '../lib/query';
import { runLifecycle } from '../services/lifecycle';
import {
  addInterval, confirmPayment, createDraftInvoice, createRenewalInvoice, generateLicenseKey, invoiceBalance, issueInvoice, settleInvoice, type Interval,
} from '../services/saas-billing';
import type { Tx } from '../db';

const id = z.object({ id: z.uuid() });
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const currency = z.enum(['MGA', 'EUR', 'USD']);
const interval = z.enum(['month', 'year']);
const features = z.record(z.string().regex(/^[a-z_]{2,40}$/), z.boolean());
const lineSchema = z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(10_000).default(1), unitAmount: z.number().int() });

/** Colonnes modifiables d'un forfait (liste blanche). */
const PLAN_COLUMNS: Record<string, string> = {
  name: 'name', description: 'description', tier: 'tier', isPublic: 'is_public', isActive: 'is_active', isCustomPriced: 'is_custom_priced',
  trialDays: 'trial_days', maxRooms: 'max_rooms', maxUsers: 'max_users', maxProperties: 'max_properties', features: 'features', sortOrder: 'sort_order',
};

/** Réglages modifiables depuis la console, chacun avec son validateur : aucune clé arbitraire n'est acceptée. */
const SETTINGS: Record<string, z.ZodType> = {
  'trial.enabled': z.boolean(),
  'trial.default_days': z.number().int().min(0).max(365),
  'trial.default_plan_code': z.string().regex(/^[a-z0-9_-]{2,40}$/),
  'billing.grace_days': z.number().int().min(0).max(60),
  'billing.invoice_due_days': z.number().int().min(0).max(90),
  'billing.tax_rate_bps': z.number().int().min(0).max(10_000),
  'billing.default_currency': currency,
  'billing.renewal_invoice_days': z.number().int().min(0).max(60),
  'billing.auto_approve_plan_changes': z.boolean(),
  'auth.max_failed_attempts': z.number().int().min(3).max(20),
  'auth.lock_minutes': z.number().int().min(1).max(1440),
  'company.profile': z.record(z.string(), z.string().max(300)),
};

const nowIso = (d: Date) => d.toISOString();

export default async function platformRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { settings } = app.deps;
  const auth = app.platformAuth();
  const tags = ['Plateforme'];
  const route = { preValidation: auth };

  /* =========================================================================================
   * Tableau de bord commercial
   * ======================================================================================= */
  r.get('/platform/stats', { ...route, schema: { tags, summary: 'Statistiques commerciales : établissements, abonnements, revenus récurrents, impayés, support' } }, async (req) => {
    return req.platformAdmin!.run(async (tx) => {
      const one = serialRows(tx);
      const [hotels, subs, mrr, trialsEnding, conv, churn, unpaid, awaiting, tickets, newHotels, collected] = await Promise.all([
        one<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM platform_hotel_directory GROUP BY status'),
        one<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM subscriptions GROUP BY status'),
        one<{ currency: string; subscriptions: number; mrr: number; arr: number }>('SELECT currency, subscriptions::int, mrr, arr FROM platform_mrr ORDER BY currency'),
        one<{ n: number }>("SELECT count(*)::int AS n FROM subscriptions WHERE status = 'trialing' AND trial_ends_at BETWEEN now() AND now() + interval '7 days'"),
        one<{ started: number; converted: number }>(
          `SELECT (SELECT count(*)::int FROM subscription_events WHERE event_type = 'trial_started' AND created_at > now() - interval '30 days') AS started,
                  (SELECT count(*)::int FROM subscription_events WHERE event_type = 'activated' AND created_at > now() - interval '30 days') AS converted`),
        one<{ cancelled: number; expired: number }>(
          `SELECT count(*) FILTER (WHERE status = 'cancelled' AND ended_at > now() - interval '30 days')::int AS cancelled,
                  count(*) FILTER (WHERE status = 'expired' AND ended_at > now() - interval '30 days')::int AS expired FROM subscriptions`),
        one<{ currency: string; invoices: number; due: number; overdue: number }>(
          `SELECT currency, count(*)::int AS invoices, COALESCE(sum(balance_due), 0)::bigint AS due, count(*) FILTER (WHERE is_overdue)::int AS overdue
           FROM saas_invoice_balances WHERE status = 'issued' AND balance_due > 0 GROUP BY currency ORDER BY currency`),
        one<{ currency: string; payments: number; amount: number }>(
          "SELECT currency, count(*)::int AS payments, sum(amount)::bigint AS amount FROM saas_payments WHERE status = 'awaiting_validation' GROUP BY currency ORDER BY currency"),
        one<{ priority: string; n: number }>("SELECT priority, count(*)::int AS n FROM support_tickets WHERE status IN ('open', 'in_progress', 'waiting_customer') GROUP BY priority"),
        one<{ n: number }>("SELECT count(*)::int AS n FROM platform_hotel_directory WHERE created_at > now() - interval '30 days'"),
        one<{ currency: string; amount: number }>(
          "SELECT currency, sum(amount)::bigint AS amount FROM saas_payments WHERE status = 'confirmed' AND validated_at >= date_trunc('month', now()) GROUP BY currency ORDER BY currency"),
      ]);
      const c = conv[0]!;
      return {
        hotels: Object.fromEntries(hotels.map((h) => [h.status, h.n])),
        subscriptions: Object.fromEntries(subs.map((s) => [s.status, s.n])),
        recurringRevenue: mrr,
        trials: { endingIn7Days: trialsEnding[0]!.n, startedLast30Days: c.started, convertedLast30Days: c.converted, conversionRate: c.started ? Math.round((c.converted / c.started) * 1000) / 10 : null },
        churnLast30Days: { cancelled: churn[0]!.cancelled, expired: churn[0]!.expired },
        unpaidInvoices: unpaid,
        paymentsAwaitingValidation: awaiting,
        openTickets: Object.fromEntries(tickets.map((t) => [t.priority, t.n])),
        newHotelsLast30Days: newHotels[0]!.n,
        collectedThisMonth: collected,
        note: 'Montants par devise, sans conversion. MRR : abonnements actifs et impayés non résiliés (annuel ÷ 12, remises déduites) ; essais exclus.',
      };
    });
  });

  /* =========================================================================================
   * Établissements
   * ======================================================================================= */
  r.get('/platform/hotels', {
    ...route,
    schema: {
      tags, summary: 'Tous les établissements inscrits (agrégats uniquement : aucune donnée client)',
      querystring: page.extend({ q: z.string().trim().max(100).optional(), status: z.enum(['onboarding', 'active', 'suspended', 'closed']).optional(), plan: z.string().optional() }),
    },
  }, async (req) => {
    const { page: p, pageSize, q, status, plan } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (q) { args.push(`%${q}%`); where.push(`(name ILIKE $${args.length} OR slug::text ILIKE $${args.length} OR owner_email::text ILIKE $${args.length})`); }
      if (status) { args.push(status); where.push(`status = $${args.length}`); }
      if (plan) { args.push(plan); where.push(`plan_code = $${args.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_hotel_directory ${w}`, args);
      const { rows } = await tx.query(
        `SELECT hotel_id AS id, slug, name, country, city, status, suspended_at AS "suspendedAt", created_at AS "createdAt", owner_email AS "ownerEmail", owner_name AS "ownerName",
                rooms_count::int AS "roomsCount", users_count::int AS "usersCount", entitlement_source AS "entitlementSource", plan_code AS "planCode",
                valid_until AS "validUntil", is_current AS "isCurrent", subscription_status AS "subscriptionStatus"
         FROM platform_hotel_directory ${w} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  r.get('/platform/hotels/:id', { ...route, schema: { tags, summary: 'Fiche commerciale d\'un établissement', params: id } }, async (req) => {
    return req.platformAdmin!.run(async (tx) => {
      const { rows: dir } = await tx.query(
        `SELECT hotel_id AS id, slug, name, country, city, status, suspended_at AS "suspendedAt", suspension_reason AS "suspensionReason", created_at AS "createdAt",
                owner_email AS "ownerEmail", owner_name AS "ownerName", rooms_count::int AS "roomsCount", users_count::int AS "usersCount",
                entitlement_source AS "entitlementSource", plan_code AS "planCode", valid_until AS "validUntil", is_current AS "isCurrent", subscription_status AS "subscriptionStatus"
         FROM platform_hotel_directory WHERE hotel_id = $1`, [req.params.id]);
      if (!dir[0]) throw new AppError('not_found');
      const hid = req.params.id;
      const rowsOf = serialRows(tx);
      const q = (sql: string) => rowsOf(sql, [hid]);
      const [subscriptions, invoices, payments, licenses, requests, tickets, audit] = await Promise.all([
        q(`SELECT s.id, s.status, p.code AS "planCode", p.name AS "planName", s.billing_interval AS "billingInterval", s.currency, s.price_amount AS "priceAmount", s.discount_amount AS "discountAmount",
                  s.started_at AS "startedAt", s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd", s.cancel_at_period_end AS "cancelAtPeriodEnd", s.ended_at AS "endedAt"
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.hotel_id = $1 ORDER BY s.started_at DESC`),
        q(`SELECT invoice_id AS id, number, status, currency, total_amount AS "totalAmount", amount_paid AS "amountPaid", balance_due AS "balanceDue", payment_status AS "paymentStatus", due_at AS "dueAt", is_overdue AS "isOverdue"
           FROM saas_invoice_balances WHERE hotel_id = $1 ORDER BY number DESC NULLS FIRST LIMIT 50`),
        q(`SELECT id, method, amount, currency, status, external_reference AS reference, submitted_at AS "submittedAt", validated_at AS "validatedAt" FROM saas_payments WHERE hotel_id = $1 ORDER BY created_at DESC LIMIT 50`),
        q(`SELECT id, key_prefix AS "keyPrefix", edition_code AS "editionCode", status, issued_at AS "issuedAt", maintenance_until AS "maintenanceUntil", max_rooms AS "maxRooms", max_users AS "maxUsers" FROM licenses WHERE hotel_id = $1 ORDER BY issued_at DESC`),
        q(`SELECT r.id, r.status, p.code AS "toPlanCode", r.to_interval AS "toInterval", r.requested_at AS "requestedAt", r.message FROM plan_change_requests r JOIN plans p ON p.id = r.to_plan_id WHERE r.hotel_id = $1 ORDER BY r.requested_at DESC LIMIT 20`),
        q(`SELECT id, number, subject, status, priority, updated_at AS "updatedAt" FROM support_tickets WHERE hotel_id = $1 ORDER BY updated_at DESC LIMIT 20`),
        q(`SELECT action, details, created_at AS "createdAt" FROM platform_audit_logs WHERE hotel_id = $1 ORDER BY created_at DESC LIMIT 50`),
      ]);
      return { hotel: dir[0], subscriptions, invoices, payments, licenses, planChangeRequests: requests, tickets, auditLog: audit };
    });
  });

  const suspendBody = z.object({ reason: z.string().trim().min(3).max(500) });
  r.post('/platform/hotels/:id/suspend', { ...route, schema: { tags, summary: 'Suspendre un compte (coupe l\'accès immédiatement)', params: id, body: suspendBody } }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const res = await tx.query("UPDATE hotels SET status = 'suspended', suspended_at = now(), suspension_reason = $2 WHERE id = $1 AND status IN ('onboarding', 'active') RETURNING id", [req.params.id, req.body.reason]);
      if (!res.rowCount) throw new AppError('invalid_state');
      await auditPlatform(tx, a.adminId, 'hotel.suspended', { type: 'hotel', id: req.params.id, hotelId: req.params.id }, { reason: req.body.reason }, req.ip);
      return { status: 'suspended' };
    });
  });

  r.post('/platform/hotels/:id/reactivate', { ...route, schema: { tags, summary: 'Réactiver un compte suspendu', params: id } }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const res = await tx.query("UPDATE hotels SET status = 'active', suspended_at = NULL, suspension_reason = NULL WHERE id = $1 AND status = 'suspended' RETURNING id", [req.params.id]);
      if (!res.rowCount) throw new AppError('invalid_state');
      await auditPlatform(tx, a.adminId, 'hotel.reactivated', { type: 'hotel', id: req.params.id, hotelId: req.params.id }, {}, req.ip);
      return { status: 'active' };
    });
  });

  /* =========================================================================================
   * Forfaits et tarification
   * ======================================================================================= */
  r.get('/platform/plans', { ...route, schema: { tags, summary: 'Tous les forfaits (actifs ou non) avec tarifs en vigueur et historique' } }, async (req) => {
    const { rows } = await req.platformAdmin!.run((tx) =>
      tx.query(
        `SELECT p.id, p.code, p.name, p.description, p.tier, p.is_public AS "isPublic", p.is_active AS "isActive", p.is_custom_priced AS "isCustomPriced", p.trial_days AS "trialDays",
                p.max_rooms AS "maxRooms", p.max_users AS "maxUsers", p.max_properties AS "maxProperties", p.features, p.sort_order AS "sortOrder",
                COALESCE(json_agg(json_build_object('id', pp.id, 'interval', pp.billing_interval, 'currency', pp.currency, 'amount', pp.amount, 'isActive', pp.is_active, 'validFrom', pp.valid_from)
                         ORDER BY pp.is_active DESC, pp.valid_from DESC) FILTER (WHERE pp.id IS NOT NULL), '[]') AS prices,
                (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('trialing', 'active', 'past_due')) AS "liveSubscriptions"
         FROM plans p LEFT JOIN plan_prices pp ON pp.plan_id = p.id GROUP BY p.id ORDER BY p.tier, p.sort_order`,
      ),
    );
    return { plans: rows };
  });

  const planBody = z.object({
    name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).nullable(), tier: z.number().int().min(0).max(100),
    isPublic: z.boolean(), isActive: z.boolean(), isCustomPriced: z.boolean(), trialDays: z.number().int().min(0).max(365).nullable(),
    maxRooms: z.number().int().positive().nullable(), maxUsers: z.number().int().positive().nullable(), maxProperties: z.number().int().positive().nullable(),
    features, sortOrder: z.number().int(),
  });

  r.post('/platform/plans', {
    ...route,
    schema: { tags, summary: 'Créer un forfait', body: planBody.partial().extend({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/), name: z.string().trim().min(2).max(80) }) },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const created = await a.run(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO plans (code, name, description, tier, is_public, is_active, is_custom_priced, trial_days, max_rooms, max_users, max_properties, features, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [b.code, b.name, b.description ?? null, b.tier ?? 0, b.isPublic ?? true, b.isActive ?? true, b.isCustomPriced ?? false, b.trialDays ?? null,
         b.maxRooms ?? null, b.maxUsers ?? null, b.maxProperties ?? null, JSON.stringify(b.features ?? {}), b.sortOrder ?? 0],
      );
      await auditPlatform(tx, a.adminId, 'plan.created', { type: 'plan', id: rows[0]!.id }, { code: b.code }, req.ip);
      return rows[0]!;
    });
    return reply.code(201).send(created);
  });

  r.patch('/platform/plans/:id', { ...route, schema: { tags, summary: 'Modifier un forfait', params: id, body: planBody.partial() } }, async (req) => {
    const a = req.platformAdmin!;
    const entries = Object.entries(req.body).filter(([k, v]) => k in PLAN_COLUMNS && v !== undefined);
    if (!entries.length) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    return a.run(async (tx) => {
      const sets = entries.map(([k], i) => `${PLAN_COLUMNS[k]} = $${i + 1}`);
      const values = entries.map(([k, v]) => (k === 'features' ? JSON.stringify(v) : v));
      const res = await tx.query(`UPDATE plans SET ${sets.join(', ')} WHERE id = $${entries.length + 1}`, [...values, req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditPlatform(tx, a.adminId, 'plan.updated', { type: 'plan', id: req.params.id }, { changed: entries.map(([k]) => k) }, req.ip);
      return { updated: entries.map(([k]) => k) };
    });
  });

  r.post('/platform/plans/:id/prices', {
    ...route,
    schema: {
      tags, summary: 'Définir un nouveau tarif (l\'ancien est conservé dans l\'historique ; les abonnements existants gardent leur prix)',
      params: id, body: z.object({ interval, currency, amount: z.number().int().min(0).max(1_000_000_000_000) }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const { interval: i, currency: c, amount } = req.body;
    const out = await a.run(async (tx) => {
      const { rows: plan } = await tx.query('SELECT 1 FROM plans WHERE id = $1', [req.params.id]);
      if (!plan[0]) throw new AppError('not_found');
      const prev = await tx.query<{ amount: number }>('UPDATE plan_prices SET is_active = false WHERE plan_id = $1 AND billing_interval = $2 AND currency = $3 AND is_active RETURNING amount', [req.params.id, i, c]);
      const { rows } = await tx.query<{ id: string }>('INSERT INTO plan_prices (plan_id, billing_interval, currency, amount) VALUES ($1, $2, $3, $4) RETURNING id', [req.params.id, i, c, amount]);
      await auditPlatform(tx, a.adminId, 'plan.price_changed', { type: 'plan', id: req.params.id }, { interval: i, currency: c, from: prev.rows[0]?.amount ?? null, to: amount }, req.ip);
      return { priceId: rows[0]!.id, previousAmount: prev.rows[0]?.amount ?? null };
    });
    return reply.code(201).send(out);
  });

  /* =========================================================================================
   * Abonnements : activation manuelle, essais, résiliation, renouvellement
   * ======================================================================================= */
  r.get('/platform/subscriptions', {
    ...route,
    schema: { tags, summary: 'Abonnements de tous les établissements', querystring: page.extend({ status: z.enum(['trialing', 'active', 'past_due', 'cancelled', 'expired']).optional() }) },
  }, async (req) => {
    const { page: p, pageSize, status } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const args: unknown[] = status ? [status] : [];
      const w = status ? 'WHERE s.status = $1' : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM subscriptions s ${w}`, args);
      const { rows } = await tx.query(
        `SELECT s.id, s.hotel_id AS "hotelId", d.name AS "hotelName", s.status, p.code AS "planCode", s.billing_interval AS "billingInterval", s.currency, s.price_amount AS "priceAmount",
                s.discount_amount AS "discountAmount", s.trial_ends_at AS "trialEndsAt", s.current_period_end AS "currentPeriodEnd", s.cancel_at_period_end AS "cancelAtPeriodEnd"
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN platform_hotel_directory d ON d.hotel_id = s.hotel_id ${w}
         ORDER BY s.current_period_end LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  /** Résilie l'éventuel abonnement vivant (remplacé), avec trace. */
  const replaceLive = async (tx: Tx, hotelId: string, adminId: string, reason: string) => {
    const { rows } = await tx.query<{ id: string; plan_id: string; status: string }>(
      "UPDATE subscriptions SET status = 'cancelled', ended_at = now(), cancelled_at = now(), cancel_reason = $2 WHERE hotel_id = $1 AND status IN ('trialing', 'active', 'past_due') RETURNING id, plan_id, status",
      [hotelId, reason],
    );
    for (const s of rows) {
      await tx.query(
        "INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'cancelled', $3, $4, 'cancelled', 'platform_admin', $5, $6)",
        [hotelId, s.id, s.plan_id, s.status, adminId, JSON.stringify({ reason })],
      );
    }
  };

  const planByCode = async (tx: Tx, code: string) => {
    const { rows } = await tx.query<{ id: string; name: string; is_custom_priced: boolean; trial_days: number | null }>('SELECT id, name, is_custom_priced, trial_days FROM plans WHERE code = $1 AND is_active', [code]);
    if (!rows[0]) throw new AppError('plan_not_available');
    return rows[0];
  };

  const priceFor = async (tx: Tx, planId: string, custom: boolean, i: Interval, c: string, override?: number) => {
    if (override !== undefined) return { amount: override, priceId: null as string | null };
    if (custom) throw new AppError('price_not_available');
    const { rows } = await tx.query<{ id: string; amount: number }>('SELECT id, amount FROM plan_prices WHERE plan_id = $1 AND billing_interval = $2 AND currency = $3 AND is_active', [planId, i, c]);
    if (!rows[0]) throw new AppError('price_not_available');
    return { amount: rows[0].amount, priceId: rows[0].id };
  };

  r.post('/platform/hotels/:id/subscription/activate', {
    ...route,
    schema: {
      tags,
      summary: 'Activer manuellement un abonnement (contrat, geste commercial, régularisation)',
      description: 'Remplace l\'abonnement en cours. Aucune facture n\'est émise : à réserver aux cas hors facturation standard ; un motif est obligatoire et la plateforme le journalise.',
      params: id,
      body: z.object({ planCode: z.string().regex(/^[a-z0-9_-]{2,40}$/), interval, currency: currency.default('MGA'), priceAmount: z.number().int().min(0).optional(), discountAmount: z.number().int().min(0).default(0), reason: z.string().trim().min(3).max(300) }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const { rows: h } = await tx.query('SELECT 1 FROM platform_hotel_directory WHERE hotel_id = $1', [req.params.id]);
      if (!h[0]) throw new AppError('not_found');
      const plan = await planByCode(tx, b.planCode);
      const price = await priceFor(tx, plan.id, plan.is_custom_priced, b.interval, b.currency, b.priceAmount);
      if (b.discountAmount > price.amount) throw new AppError('check_violation');
      await replaceLive(tx, req.params.id, a.adminId, `Remplacé : ${b.reason}`);
      const start = new Date();
      const end = await addInterval(tx, start, b.interval);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO subscriptions (hotel_id, plan_id, plan_price_id, status, billing_interval, currency, price_amount, discount_amount, started_at, current_period_start, current_period_end, notes)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $8, $9, $10) RETURNING id`,
        [req.params.id, plan.id, price.priceId, b.interval, b.currency, price.amount, b.discountAmount, start, end, `Activation manuelle : ${b.reason}`],
      );
      await tx.query(
        "INSERT INTO subscription_events (hotel_id, subscription_id, event_type, to_plan_id, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'activated', $3, 'active', 'platform_admin', $4, $5)",
        [req.params.id, rows[0]!.id, plan.id, a.adminId, JSON.stringify({ reason: b.reason, manual: true })],
      );
      await auditPlatform(tx, a.adminId, 'subscription.activated_manually', { type: 'subscription', id: rows[0]!.id, hotelId: req.params.id }, { plan: b.planCode, interval: b.interval, price: price.amount, reason: b.reason }, req.ip);
      return { subscriptionId: rows[0]!.id, periodEnd: end };
    });
    return reply.code(201).send(out);
  });

  r.post('/platform/hotels/:id/trial/grant', {
    ...route,
    schema: {
      tags, summary: 'Offrir un (nouvel) essai gratuit à un établissement sans abonnement en cours', params: id,
      body: z.object({ days: z.number().int().min(1).max(365), planCode: z.string().regex(/^[a-z0-9_-]{2,40}$/).default('business'), reason: z.string().trim().min(3).max(300) }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const { rows: h } = await tx.query('SELECT 1 FROM platform_hotel_directory WHERE hotel_id = $1', [req.params.id]);
      if (!h[0]) throw new AppError('not_found');
      const live = await tx.query("SELECT 1 FROM subscriptions WHERE hotel_id = $1 AND status IN ('trialing', 'active', 'past_due')", [req.params.id]);
      if (live.rowCount) throw new AppError('invalid_state');
      const plan = await planByCode(tx, b.planCode);
      const now = new Date();
      const end = new Date(now.getTime() + b.days * 86_400_000);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO subscriptions (hotel_id, plan_id, status, billing_interval, currency, price_amount, started_at, trial_ends_at, current_period_start, current_period_end, notes)
         VALUES ($1, $2, 'trialing', 'month', 'MGA', 0, $3, $4, $3, $4, $5) RETURNING id`,
        [req.params.id, plan.id, now, end, `Essai offert : ${b.reason}`],
      );
      await tx.query(
        "INSERT INTO subscription_events (hotel_id, subscription_id, event_type, to_plan_id, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'trial_started', $3, 'trialing', 'platform_admin', $4, $5)",
        [req.params.id, rows[0]!.id, plan.id, a.adminId, JSON.stringify({ trial_days: b.days, reason: b.reason, granted: true })],
      );
      await auditPlatform(tx, a.adminId, 'trial.granted', { type: 'subscription', id: rows[0]!.id, hotelId: req.params.id }, { days: b.days, reason: b.reason }, req.ip);
      return { subscriptionId: rows[0]!.id, trialEndsAt: end };
    });
    return reply.code(201).send(out);
  });

  r.post('/platform/subscriptions/:id/extend-trial', {
    ...route,
    schema: { tags, summary: 'Prolonger une période d\'essai en cours', params: id, body: z.object({ days: z.number().int().min(1).max(365), reason: z.string().trim().min(3).max(300) }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string; plan_id: string; trial_ends_at: Date }>("SELECT hotel_id, plan_id, trial_ends_at FROM subscriptions WHERE id = $1 AND status = 'trialing' FOR UPDATE", [req.params.id]);
      if (!rows[0]) throw new AppError('invalid_state');
      const base = rows[0].trial_ends_at > new Date() ? rows[0].trial_ends_at : new Date();
      const end = new Date(base.getTime() + req.body.days * 86_400_000);
      await tx.query('UPDATE subscriptions SET trial_ends_at = $2, current_period_end = $2 WHERE id = $1', [req.params.id, end]);
      await tx.query(
        "INSERT INTO subscription_events (hotel_id, subscription_id, event_type, to_plan_id, from_status, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'trial_extended', $3, 'trialing', 'trialing', 'platform_admin', $4, $5)",
        [rows[0].hotel_id, req.params.id, rows[0].plan_id, a.adminId, JSON.stringify({ days: req.body.days, reason: req.body.reason })],
      );
      await auditPlatform(tx, a.adminId, 'trial.extended', { type: 'subscription', id: req.params.id, hotelId: rows[0].hotel_id }, { days: req.body.days, reason: req.body.reason }, req.ip);
      return { trialEndsAt: end };
    });
  });

  r.post('/platform/subscriptions/:id/cancel', {
    ...route,
    schema: { tags, summary: 'Résilier un abonnement (à l\'échéance, ou immédiatement)', params: id, body: z.object({ reason: z.string().trim().min(3).max(300), atPeriodEnd: z.boolean().default(true) }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string; plan_id: string; status: string }>("SELECT hotel_id, plan_id, status FROM subscriptions WHERE id = $1 AND status IN ('trialing', 'active', 'past_due') FOR UPDATE", [req.params.id]);
      const s = rows[0];
      if (!s) throw new AppError('invalid_state');
      if (req.body.atPeriodEnd && s.status !== 'trialing') {
        await tx.query('UPDATE subscriptions SET cancel_at_period_end = true, cancel_reason = $2 WHERE id = $1', [req.params.id, req.body.reason]);
        await tx.query("INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'cancel_requested', $3, $4, $4, 'platform_admin', $5, $6)", [s.hotel_id, req.params.id, s.plan_id, s.status, a.adminId, JSON.stringify({ reason: req.body.reason })]);
      } else {
        await tx.query("UPDATE subscriptions SET status = 'cancelled', ended_at = now(), cancelled_at = now(), cancel_reason = $2 WHERE id = $1", [req.params.id, req.body.reason]);
        await tx.query("INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, actor_id, details) VALUES ($1, $2, 'cancelled', $3, $4, 'cancelled', 'platform_admin', $5, $6)", [s.hotel_id, req.params.id, s.plan_id, s.status, a.adminId, JSON.stringify({ reason: req.body.reason })]);
      }
      await auditPlatform(tx, a.adminId, 'subscription.cancelled', { type: 'subscription', id: req.params.id, hotelId: s.hotel_id }, { reason: req.body.reason, atPeriodEnd: req.body.atPeriodEnd }, req.ip);
      return { status: req.body.atPeriodEnd && s.status !== 'trialing' ? 'cancel_at_period_end' : 'cancelled' };
    });
  });

  r.post('/platform/subscriptions/:id/renew', { ...route, schema: { tags, summary: 'Émettre la facture de renouvellement de la prochaine période', params: id } }, async (req, reply) => {
    const a = req.platformAdmin!;
    const out = await a.run(async (tx) => {
      const invoiceId = await createRenewalInvoice(tx, app.deps, req.params.id, a.adminId);
      if (!invoiceId) throw new AppError('invalid_state');
      const { rows } = await tx.query<{ number: string; hotel_id: string }>('SELECT number, hotel_id FROM saas_invoices WHERE id = $1', [invoiceId]);
      await auditPlatform(tx, a.adminId, 'invoice.renewal_issued', { type: 'saas_invoice', id: invoiceId, hotelId: rows[0]!.hotel_id }, { number: rows[0]!.number }, req.ip);
      return { invoiceId, number: rows[0]!.number };
    });
    return reply.code(201).send(out);
  });

  /* =========================================================================================
   * Demandes de changement de formule
   * ======================================================================================= */
  r.get('/platform/plan-change-requests', {
    ...route,
    schema: { tags, summary: 'Demandes de changement de formule', querystring: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'applied', 'cancelled']).optional() }) },
  }, async (req) => {
    const { rows } = await req.platformAdmin!.run((tx) =>
      tx.query(
        `SELECT r.id, r.hotel_id AS "hotelId", d.name AS "hotelName", r.status, fp.code AS "fromPlanCode", tp.code AS "toPlanCode", tp.name AS "toPlanName", tp.is_custom_priced AS "isCustomPriced",
                r.to_interval AS "toInterval", r.message, r.requested_at AS "requestedAt", r.decided_at AS "decidedAt", r.decision_notes AS "decisionNotes"
         FROM plan_change_requests r JOIN plans tp ON tp.id = r.to_plan_id LEFT JOIN plans fp ON fp.id = r.from_plan_id JOIN platform_hotel_directory d ON d.hotel_id = r.hotel_id
         ${req.query.status ? 'WHERE r.status = $1' : ''} ORDER BY r.requested_at DESC LIMIT 200`,
        req.query.status ? [req.query.status] : [],
      ),
    );
    return { requests: rows };
  });

  r.post('/platform/plan-change-requests/:id/approve', {
    ...route,
    schema: {
      tags, summary: 'Approuver une demande (formule sur devis : fixer le prix) et émettre la facture', params: id,
      body: z.object({ priceAmount: z.number().int().min(0).optional(), discountAmount: z.number().int().min(0).default(0), currency: currency.default('MGA'), notes: z.string().trim().max(500).optional() }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string; to_plan_id: string; to_interval: Interval; status: string }>('SELECT hotel_id, to_plan_id, to_interval, status FROM plan_change_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
      const rq = rows[0];
      if (!rq) throw new AppError('not_found');
      if (rq.status !== 'pending') throw new AppError('invalid_state');
      const { rows: pl } = await tx.query<{ id: string; code: string; name: string; is_custom_priced: boolean }>('SELECT id, code, name, is_custom_priced FROM plans WHERE id = $1', [rq.to_plan_id]);
      const plan = pl[0]!;
      const { rows: live } = await tx.query<{ currency: string }>("SELECT currency FROM subscriptions WHERE hotel_id = $1 AND status IN ('trialing', 'active', 'past_due') LIMIT 1", [rq.hotel_id]);
      const cur = live[0]?.currency ?? b.currency;
      const price = await priceFor(tx, plan.id, plan.is_custom_priced, rq.to_interval, cur, b.priceAmount);
      if (b.discountAmount > price.amount) throw new AppError('check_violation');
      const lines = [{ description: `Abonnement ${plan.name} — ${rq.to_interval === 'month' ? 'mensuel' : 'annuel'}`, unitAmount: price.amount }];
      if (b.discountAmount > 0) lines.push({ description: 'Remise commerciale', unitAmount: -b.discountAmount });
      const invoiceId = await createDraftInvoice(tx, app.deps, {
        hotelId: rq.hotel_id, kind: 'plan_change', currency: cur, lines, adminId: a.adminId,
        billingSnapshot: { planId: plan.id, planCode: plan.code, interval: rq.to_interval, priceAmount: price.amount, discountAmount: b.discountAmount, requestId: req.params.id },
      });
      const { number } = await issueInvoice(tx, app.deps, invoiceId);
      await tx.query("UPDATE plan_change_requests SET status = 'approved', decided_by_admin_id = $2, decided_at = now(), decision_notes = $3 WHERE id = $1", [req.params.id, a.adminId, b.notes ?? null]);
      await auditPlatform(tx, a.adminId, 'plan_change.approved', { type: 'plan_change_request', id: req.params.id, hotelId: rq.hotel_id }, { plan: plan.code, price: price.amount, discount: b.discountAmount, invoice: number }, req.ip);
      return { invoiceId, number };
    });
    return reply.code(201).send(out);
  });

  r.post('/platform/plan-change-requests/:id/reject', {
    ...route,
    schema: { tags, summary: 'Refuser une demande', params: id, body: z.object({ notes: z.string().trim().min(3).max(500) }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const res = await tx.query<{ hotel_id: string }>("UPDATE plan_change_requests SET status = 'rejected', decided_by_admin_id = $2, decided_at = now(), decision_notes = $3 WHERE id = $1 AND status = 'pending' RETURNING hotel_id", [req.params.id, a.adminId, req.body.notes]);
      if (!res.rowCount) throw new AppError('invalid_state');
      await auditPlatform(tx, a.adminId, 'plan_change.rejected', { type: 'plan_change_request', id: req.params.id, hotelId: res.rows[0]!.hotel_id }, { notes: req.body.notes }, req.ip);
      return { status: 'rejected' };
    });
  });

  /* =========================================================================================
   * Factures SaaS
   * ======================================================================================= */
  r.get('/platform/invoices', {
    ...route,
    schema: { tags, summary: 'Factures SaaS', querystring: page.extend({ hotelId: z.uuid().optional(), paymentStatus: z.enum(['draft', 'void', 'no_payment_due', 'paid', 'partially_paid', 'unpaid']).optional(), overdue: z.coerce.boolean().optional() }) },
  }, async (req) => {
    const { page: p, pageSize, hotelId, paymentStatus, overdue } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (hotelId) { args.push(hotelId); where.push(`b.hotel_id = $${args.length}`); }
      if (paymentStatus) { args.push(paymentStatus); where.push(`b.payment_status = $${args.length}`); }
      if (overdue) where.push('b.is_overdue');
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM saas_invoice_balances b ${w}`, args);
      const { rows } = await tx.query(
        `SELECT b.invoice_id AS id, b.hotel_id AS "hotelId", d.name AS "hotelName", b.number, i.kind, b.status, b.currency, b.total_amount AS "totalAmount", b.amount_paid AS "amountPaid",
                b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus", b.is_overdue AS "isOverdue", b.due_at AS "dueAt", i.issued_at AS "issuedAt"
         FROM saas_invoice_balances b JOIN saas_invoices i ON i.id = b.invoice_id JOIN platform_hotel_directory d ON d.hotel_id = b.hotel_id ${w}
         ORDER BY i.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  r.get('/platform/invoices/:id', { ...route, schema: { tags, summary: 'Détail d\'une facture SaaS', params: id } }, async (req) => {
    return req.platformAdmin!.run(async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.id, i.hotel_id AS "hotelId", d.name AS "hotelName", i.number, i.kind, i.status, i.currency, i.subtotal_amount AS "subtotalAmount", i.tax_amount AS "taxAmount", i.total_amount AS "totalAmount",
                i.issued_at AS "issuedAt", i.due_at AS "dueAt", i.period_start AS "periodStart", i.period_end AS "periodEnd", i.notes, i.billing_snapshot AS "billingSnapshot",
                b.amount_paid AS "amountPaid", b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus", b.is_overdue AS "isOverdue"
         FROM saas_invoices i JOIN saas_invoice_balances b ON b.invoice_id = i.id JOIN platform_hotel_directory d ON d.hotel_id = i.hotel_id WHERE i.id = $1`, [req.params.id]);
      if (!rows[0]) throw new AppError('invoice_not_found');
      const { rows: lines } = await tx.query('SELECT description, quantity, unit_amount AS "unitAmount", amount, tax_amount AS "taxAmount" FROM saas_invoice_lines WHERE saas_invoice_id = $1 ORDER BY position', [req.params.id]);
      const { rows: payments } = await tx.query(`SELECT id, method, amount, status, external_reference AS reference, payer_name AS "payerName", payer_phone AS "payerPhone", submitted_at AS "submittedAt", validated_at AS "validatedAt", rejection_reason AS "rejectionReason" FROM saas_payments WHERE saas_invoice_id = $1 ORDER BY created_at`, [req.params.id]);
      return { ...rows[0], lines, payments };
    });
  });

  r.post('/platform/invoices', {
    ...route,
    schema: {
      tags, summary: 'Créer une facture manuelle (hors abonnement : prestation, formation…)',
      body: z.object({ hotelId: z.uuid(), currency: currency.default('MGA'), lines: z.array(lineSchema).min(1).max(30), notes: z.string().trim().max(1000).optional(), issue: z.boolean().default(true) }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const invoiceId = await createDraftInvoice(tx, app.deps, { hotelId: b.hotelId, kind: 'other', currency: b.currency, lines: b.lines, notes: b.notes, adminId: a.adminId });
      const number = b.issue ? (await issueInvoice(tx, app.deps, invoiceId)).number : null;
      await auditPlatform(tx, a.adminId, b.issue ? 'invoice.issued' : 'invoice.drafted', { type: 'saas_invoice', id: invoiceId, hotelId: b.hotelId }, { number }, req.ip);
      return { invoiceId, number };
    });
    return reply.code(201).send(out);
  });

  r.post('/platform/invoices/:id/issue', { ...route, schema: { tags, summary: 'Émettre un brouillon (numéro séquentiel sans trou)', params: id } }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { number } = await issueInvoice(tx, app.deps, req.params.id);
      const { rows: h } = await tx.query<{ hotel_id: string }>('SELECT hotel_id FROM saas_invoices WHERE id = $1', [req.params.id]);
      await auditPlatform(tx, a.adminId, 'invoice.issued', { type: 'saas_invoice', id: req.params.id, hotelId: h[0]?.hotel_id }, { number }, req.ip);
      return { number };
    });
  });

  r.post('/platform/invoices/:id/void', {
    ...route,
    schema: { tags, summary: 'Annuler une facture émise (refusé si un paiement a été confirmé)', params: id, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const bal = await invoiceBalance(tx, req.params.id);
      if (bal.amount_paid > 0) throw new AppError('invoice_status_transition_invalid');
      await tx.query("UPDATE saas_invoices SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1", [req.params.id, req.body.reason]);
      await auditPlatform(tx, a.adminId, 'invoice.voided', { type: 'saas_invoice', id: req.params.id, hotelId: bal.hotel_id }, { reason: req.body.reason }, req.ip);
      return { status: 'void' };
    });
  });

  /* =========================================================================================
   * Paiements : validation MANUELLE (aucun prestataire automatisé n'est connecté)
   * ======================================================================================= */
  r.get('/platform/payments', {
    ...route,
    schema: { tags, summary: 'Paiements SaaS', querystring: page.extend({ status: z.enum(['pending', 'awaiting_validation', 'confirmed', 'rejected', 'failed', 'refunded']).optional(), hotelId: z.uuid().optional() }) },
  }, async (req) => {
    const { page: p, pageSize, status, hotelId } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (status) { args.push(status); where.push(`p.status = $${args.length}`); }
      if (hotelId) { args.push(hotelId); where.push(`p.hotel_id = $${args.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM saas_payments p ${w}`, args);
      const { rows } = await tx.query(
        `SELECT p.id, p.hotel_id AS "hotelId", d.name AS "hotelName", i.number AS "invoiceNumber", p.method, p.amount, p.currency, p.status, p.external_reference AS reference,
                p.payer_name AS "payerName", p.payer_phone AS "payerPhone", p.submitted_at AS "submittedAt", p.validated_at AS "validatedAt", p.rejection_reason AS "rejectionReason"
         FROM saas_payments p JOIN platform_hotel_directory d ON d.hotel_id = p.hotel_id LEFT JOIN saas_invoices i ON i.id = p.saas_invoice_id ${w}
         ORDER BY p.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  r.post('/platform/payments/:id/validate', {
    ...route,
    schema: { tags, summary: 'Valider un paiement déclaré après vérification (relevé bancaire, SMS Mobile Money…)', description: 'Confirme le paiement ; si la facture est soldée, ses effets sont appliqués (activation, renouvellement, changement de formule, licence).', params: id },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const out = await confirmPayment(tx, app.deps, req.params.id, a.adminId);
      await auditPlatform(tx, a.adminId, 'payment.validated', { type: 'saas_payment', id: req.params.id, hotelId: out.hotelId }, { invoiceId: out.invoiceId, effects: out.effects }, req.ip);
      return { invoiceId: out.invoiceId, effects: out.effects };
    });
  });

  r.post('/platform/payments/:id/reject', {
    ...route,
    schema: { tags, summary: 'Rejeter un paiement déclaré (référence introuvable, montant incorrect…)', params: id, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string }>("UPDATE saas_payments SET status = 'rejected', rejection_reason = $2 WHERE id = $1 AND status IN ('awaiting_validation', 'pending') RETURNING hotel_id", [req.params.id, req.body.reason]);
      if (!rows[0]) throw new AppError('payment_not_awaiting_validation');
      await auditPlatform(tx, a.adminId, 'payment.rejected', { type: 'saas_payment', id: req.params.id, hotelId: rows[0].hotel_id }, { reason: req.body.reason }, req.ip);
      return { status: 'rejected' };
    });
  });

  r.post('/platform/invoices/:id/payments', {
    ...route,
    schema: {
      tags, summary: 'Enregistrer un paiement reçu directement (déjà vérifié par l\'administrateur)', params: id,
      body: z.object({ method: z.enum(['bank_transfer', 'mvola', 'orange_money', 'airtel_money', 'cash', 'other']), amount: z.number().int().positive().optional(), reference: z.string().trim().min(3).max(120).optional(), payerName: z.string().trim().max(120).optional() }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const bal = await invoiceBalance(tx, req.params.id);
      if (bal.status !== 'issued') throw new AppError('invoice_not_payable');
      if (bal.balance_due <= 0) throw new AppError('invoice_already_paid');
      if (!['cash', 'other'].includes(b.method) && !b.reference) throw new AppError('reference_required');
      const amount = b.amount ?? bal.balance_due;
      if (amount > bal.balance_due) throw new AppError('payment_exceeds_due');
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, payer_name, submitted_at, validated_by_admin_id, validated_at)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, now(), $8, now()) RETURNING id`,
        [bal.hotel_id, req.params.id, b.method, amount, bal.currency, b.reference ?? null, b.payerName ?? null, a.adminId],
      );
      const effects = await settleInvoice(tx, app.deps, req.params.id, a.adminId);
      await auditPlatform(tx, a.adminId, 'payment.recorded', { type: 'saas_payment', id: rows[0]!.id, hotelId: bal.hotel_id }, { method: b.method, amount, effects }, req.ip);
      return { paymentId: rows[0]!.id, effects };
    });
    return reply.code(201).send(out);
  });

  /* =========================================================================================
   * Moyens de paiement SaaS (connecteurs)
   * ======================================================================================= */
  r.get('/platform/payment-connectors', { ...route, schema: { tags, summary: 'Moyens de paiement SaaS et état de connexion' } }, async (req) => {
    const { rows } = await req.platformAdmin!.run((tx) => tx.query('SELECT code, name, mode, status, is_enabled AS "isEnabled", instructions, provider, connected_at AS "connectedAt" FROM payment_connectors ORDER BY name'));
    return {
      connectors: rows,
      note: 'Aucun prestataire de paiement en ligne n\'est connecté : les connecteurs « automated » ne peuvent pas être activés. MVola, Orange Money, Airtel Money et virement fonctionnent en mode manuel (déclaration de la référence puis validation).',
    };
  });

  r.patch('/platform/payment-connectors/:code', {
    ...route,
    schema: {
      tags, summary: 'Configurer un moyen de paiement manuel (consignes) et l\'activer',
      params: z.object({ code: z.enum(['bank_transfer', 'mvola', 'orange_money', 'airtel_money', 'card', 'cash', 'other']) }),
      body: z.object({ instructions: z.string().trim().max(1000).nullable().optional(), isEnabled: z.boolean().optional() }),
    },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { rows } = await tx.query<{ mode: string; instructions: string | null; is_enabled: boolean }>('SELECT mode, instructions, is_enabled FROM payment_connectors WHERE code = $1 FOR UPDATE', [req.params.code]);
      const c = rows[0];
      if (!c) throw new AppError('not_found');
      const instructions = req.body.instructions === undefined ? c.instructions : req.body.instructions;
      const wantsOn = req.body.isEnabled === true;
      // Un connecteur automatisé exige une VRAIE intégration : aucune n'est implémentée, on refuse plutôt que de simuler
      if (c.mode === 'automated' && wantsOn) throw new AppError('provider_not_connected');
      if (c.mode === 'manual') {
        // « Configuré » = des consignes de paiement exploitables ; sans elles le moyen ne peut pas être (ou rester) actif
        const ready = !!instructions && instructions.trim().length >= 5;
        if (wantsOn && !ready) throw new AppError('connector_not_ready');
        const enabled = (req.body.isEnabled ?? c.is_enabled) && ready;
        await tx.query("UPDATE payment_connectors SET instructions = $2, status = $3, is_enabled = $4 WHERE code = $1", [req.params.code, instructions, ready ? 'configured' : 'not_configured', enabled]);
      } else {
        await tx.query('UPDATE payment_connectors SET instructions = $2, is_enabled = false WHERE code = $1', [req.params.code, instructions]);
      }
      await auditPlatform(tx, a.adminId, 'payment_connector.updated', { type: 'payment_connector' }, { code: req.params.code, enabled: req.body.isEnabled }, req.ip);
      const { rows: out } = await tx.query('SELECT code, mode, status, is_enabled AS "isEnabled", instructions FROM payment_connectors WHERE code = $1', [req.params.code]);
      return out[0];
    });
  });

  /* =========================================================================================
   * Licences définitives
   * ======================================================================================= */
  r.get('/platform/licenses', {
    ...route,
    schema: { tags, summary: 'Licences (la clé n\'est jamais ré-affichée)', querystring: z.object({ hotelId: z.uuid().optional() }) },
  }, async (req) => {
    const { rows } = await req.platformAdmin!.run((tx) =>
      tx.query(
        `SELECT l.id, l.hotel_id AS "hotelId", d.name AS "hotelName", l.key_prefix AS "keyPrefix", l.edition_code AS "editionCode", l.status, l.issued_at AS "issuedAt", l.activated_at AS "activatedAt",
                l.max_rooms AS "maxRooms", l.max_users AS "maxUsers", l.features, l.maintenance_until AS "maintenanceUntil", l.hosting_included AS "hostingIncluded", l.terms
         FROM licenses l JOIN platform_hotel_directory d ON d.hotel_id = l.hotel_id ${req.query.hotelId ? 'WHERE l.hotel_id = $1' : ''} ORDER BY l.issued_at DESC`,
        req.query.hotelId ? [req.query.hotelId] : [],
      ),
    );
    return { licenses: rows };
  });

  r.post('/platform/hotels/:id/licenses', {
    ...route,
    schema: {
      tags,
      summary: 'Émettre une licence définitive pour UN établissement',
      description: 'Droit d\'usage perpétuel d\'une édition, avec limites et fonctionnalités figées. Les mises à jour et le support sont couverts jusqu\'à `maintenanceUntil`. Si un prix est fourni avec `invoice: true`, la licence reste « en attente » jusqu\'au règlement de la facture. La clé n\'est affichée QU\'UNE FOIS.',
      params: id,
      body: z.object({
        editionCode: z.string().trim().min(2).max(60),
        basedOnPlanCode: z.string().regex(/^[a-z0-9_-]{2,40}$/).optional(),
        maxRooms: z.number().int().positive().nullable().optional(), maxUsers: z.number().int().positive().nullable().optional(),
        features: features.optional(), maintenanceUntil: z.coerce.date().nullable().default(null), hostingIncluded: z.boolean().default(true),
        terms: z.string().trim().max(4000).optional(), priceAmount: z.number().int().min(0).optional(), currency: currency.default('MGA'), invoice: z.boolean().default(false),
      }),
    },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    const b = req.body;
    const out = await a.run(async (tx) => {
      const { rows: h } = await tx.query('SELECT 1 FROM platform_hotel_directory WHERE hotel_id = $1', [req.params.id]);
      if (!h[0]) throw new AppError('not_found');
      let maxRooms = b.maxRooms, maxUsers = b.maxUsers, feats = b.features;
      if (b.basedOnPlanCode) {
        const { rows } = await tx.query<{ max_rooms: number | null; max_users: number | null; features: Record<string, boolean> }>('SELECT max_rooms, max_users, features FROM plans WHERE code = $1', [b.basedOnPlanCode]);
        if (!rows[0]) throw new AppError('plan_not_available');
        maxRooms = maxRooms === undefined ? rows[0].max_rooms : maxRooms;
        maxUsers = maxUsers === undefined ? rows[0].max_users : maxUsers;
        feats = feats ?? rows[0].features;
      }
      const key = generateLicenseKey();
      const needsPayment = b.invoice && (b.priceAmount ?? 0) > 0;
      const now = app.deps.now();
      const { rows: lic } = await tx.query<{ id: string }>(
        `INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, status, activated_at, max_rooms, max_users, features, maintenance_until, hosting_included, terms, price_amount, currency, created_by_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [req.params.id, key.hash, key.prefix, b.editionCode, needsPayment ? 'pending' : 'active', needsPayment ? null : now, maxRooms ?? null, maxUsers ?? null,
         JSON.stringify(feats ?? {}), b.maintenanceUntil, b.hostingIncluded, b.terms ?? null, b.priceAmount ?? null, b.priceAmount !== undefined ? b.currency : null, a.adminId],
      );
      await tx.query("INSERT INTO license_events (hotel_id, license_id, event_type, admin_id, details) VALUES ($1, $2, 'issued', $3, $4)", [req.params.id, lic[0]!.id, a.adminId, JSON.stringify({ edition: b.editionCode })]);
      let invoice: { id: string; number: string } | null = null;
      if (needsPayment) {
        const invoiceId = await createDraftInvoice(tx, app.deps, {
          hotelId: req.params.id, kind: 'license', currency: b.currency, adminId: a.adminId,
          lines: [{ description: `Licence définitive « ${b.editionCode} » — un établissement`, unitAmount: b.priceAmount! }], billingSnapshot: { licenseId: lic[0]!.id },
        });
        const { number } = await issueInvoice(tx, app.deps, invoiceId);
        await tx.query('UPDATE licenses SET saas_invoice_id = $2 WHERE id = $1', [lic[0]!.id, invoiceId]);
        invoice = { id: invoiceId, number };
      } else {
        await tx.query("INSERT INTO license_events (hotel_id, license_id, event_type, admin_id) VALUES ($1, $2, 'activated', $3)", [req.params.id, lic[0]!.id, a.adminId]);
      }
      await auditPlatform(tx, a.adminId, 'license.issued', { type: 'license', id: lic[0]!.id, hotelId: req.params.id }, { edition: b.editionCode, needsPayment }, req.ip);
      return { licenseId: lic[0]!.id, status: needsPayment ? 'pending' : 'active', invoice, licenseKey: key.key, warning: 'Conservez cette clé : elle ne sera plus jamais affichée (seule son empreinte est stockée).' };
    });
    return reply.code(201).send(out);
  });

  const licenseAction = (path: string, summary: string, fromStatuses: string[], toStatus: string, eventType: string, needsReason: boolean) =>
    r.post(`/platform/licenses/:id/${path}`, {
      ...route,
      schema: { tags, summary, params: id, body: needsReason ? z.object({ reason: z.string().trim().min(3).max(300) }) : z.object({}).optional() },
    }, async (req) => {
      const a = req.platformAdmin!;
      const reason = (req.body as { reason?: string } | undefined)?.reason ?? null;
      return a.run(async (tx) => {
        const { rows } = await tx.query<{ hotel_id: string }>(
          `UPDATE licenses SET status = $2, revoked_at = CASE WHEN $2 = 'revoked' THEN now() ELSE revoked_at END, revoked_reason = CASE WHEN $2 = 'revoked' THEN $3 ELSE revoked_reason END,
                  activated_at = COALESCE(activated_at, CASE WHEN $2 = 'active' THEN now() END)
           WHERE id = $1 AND status = ANY($4::text[]) RETURNING hotel_id`,
          [req.params.id, toStatus, reason, fromStatuses],
        );
        if (!rows[0]) throw new AppError('license_not_found');
        await tx.query('INSERT INTO license_events (hotel_id, license_id, event_type, admin_id, details) VALUES ($1, $2, $3, $4, $5)', [rows[0].hotel_id, req.params.id, eventType, a.adminId, JSON.stringify({ reason })]);
        await auditPlatform(tx, a.adminId, `license.${eventType}`, { type: 'license', id: req.params.id, hotelId: rows[0].hotel_id }, { reason }, req.ip);
        return { status: toStatus };
      });
    });
  licenseAction('revoke', 'Révoquer une licence (définitif)', ['active', 'suspended', 'pending'], 'revoked', 'revoked', true);
  licenseAction('suspend', 'Suspendre une licence', ['active'], 'suspended', 'suspended', true);
  licenseAction('reinstate', 'Rétablir une licence suspendue', ['suspended'], 'active', 'reinstated', false);

  r.post('/platform/licenses/:id/extend-maintenance', {
    ...route,
    schema: { tags, summary: 'Prolonger la couverture de maintenance (mises à jour et support)', params: id, body: z.object({ until: z.coerce.date() }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    return a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string }>('UPDATE licenses SET maintenance_until = $2 WHERE id = $1 RETURNING hotel_id', [req.params.id, req.body.until]);
      if (!rows[0]) throw new AppError('license_not_found');
      await tx.query("INSERT INTO license_events (hotel_id, license_id, event_type, admin_id, details) VALUES ($1, $2, 'maintenance_extended', $3, $4)", [rows[0].hotel_id, req.params.id, a.adminId, JSON.stringify({ until: nowIso(req.body.until) })]);
      await auditPlatform(tx, a.adminId, 'license.maintenance_extended', { type: 'license', id: req.params.id, hotelId: rows[0].hotel_id }, { until: nowIso(req.body.until) }, req.ip);
      return { maintenanceUntil: req.body.until };
    });
  });

  /* =========================================================================================
   * Réglages de la plateforme
   * ======================================================================================= */
  r.get('/platform/settings', { ...route, schema: { tags, summary: 'Réglages (durée d\'essai, tolérance, taxe, délais…)' } }, async (req) => {
    const { rows } = await req.platformAdmin!.run((tx) => tx.query('SELECT key, value, description FROM platform_settings ORDER BY key'));
    return { settings: rows, editableKeys: Object.keys(SETTINGS) };
  });

  r.patch('/platform/settings/:key', {
    ...route,
    schema: { tags, summary: 'Modifier un réglage', params: z.object({ key: z.string().max(60) }), body: z.object({ value: z.unknown() }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    const validator = SETTINGS[req.params.key];
    if (!validator) throw new AppError('setting_not_allowed');
    const parsed = validator.safeParse(req.body.value);
    if (!parsed.success) throw new AppError('validation_error', parsed.error.issues.map((i) => ({ path: 'value', message: i.message })));
    const res = await a.run(async (tx) => {
      const { rows: prev } = await tx.query('SELECT value FROM platform_settings WHERE key = $1', [req.params.key]);
      await tx.query(
        'INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
        [req.params.key, JSON.stringify(parsed.data), a.adminId],
      );
      await auditPlatform(tx, a.adminId, 'setting.updated', { type: 'platform_setting' }, { key: req.params.key, from: prev[0]?.value ?? null, to: parsed.data }, req.ip);
      return { key: req.params.key, value: parsed.data };
    });
    settings.invalidate();
    return res;
  });

  /* =========================================================================================
   * Assistance
   * ======================================================================================= */
  r.get('/platform/tickets', {
    ...route,
    schema: { tags, summary: 'Demandes d\'assistance de tous les établissements', querystring: page.extend({ status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(), hotelId: z.uuid().optional() }) },
  }, async (req) => {
    const { page: p, pageSize, status, hotelId } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (status) { args.push(status); where.push(`t.status = $${args.length}`); }
      if (hotelId) { args.push(hotelId); where.push(`t.hotel_id = $${args.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets t ${w}`, args);
      const { rows } = await tx.query(
        `SELECT t.id, t.number, t.hotel_id AS "hotelId", d.name AS "hotelName", t.subject, t.category, t.priority, t.status, t.assigned_admin_id AS "assignedAdminId",
                t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.first_response_at AS "firstResponseAt"
         FROM support_tickets t JOIN platform_hotel_directory d ON d.hotel_id = t.hotel_id ${w}
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  r.get('/platform/tickets/:id', { ...route, schema: { tags, summary: 'Une demande avec TOUS ses messages (notes internes comprises)', params: id } }, async (req) => {
    return req.platformAdmin!.run(async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, t.number, t.hotel_id AS "hotelId", d.name AS "hotelName", t.subject, t.category, t.priority, t.status, t.assigned_admin_id AS "assignedAdminId", t.created_at AS "createdAt"
         FROM support_tickets t JOIN platform_hotel_directory d ON d.hotel_id = t.hotel_id WHERE t.id = $1`, [req.params.id]);
      if (!rows[0]) throw new AppError('not_found');
      const { rows: messages } = await tx.query('SELECT id, author_kind AS "authorKind", body, is_internal AS "isInternal", created_at AS "createdAt" FROM support_messages WHERE ticket_id = $1 ORDER BY created_at', [req.params.id]);
      return { ticket: rows[0], messages };
    });
  });

  r.post('/platform/tickets/:id/messages', {
    ...route,
    schema: { tags, summary: 'Répondre (publiquement) ou écrire une note interne', params: id, body: z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }) },
  }, async (req, reply) => {
    const a = req.platformAdmin!;
    await a.run(async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string; status: string }>('SELECT hotel_id, status FROM support_tickets WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new AppError('not_found');
      await tx.query(
        "INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_admin_id, body, is_internal) VALUES ($1, $2, 'platform_admin', $3, $4, $5)",
        [req.params.id, rows[0].hotel_id, a.adminId, req.body.body, req.body.internal],
      );
    });
    return reply.code(201).send({ ok: true });
  });

  r.patch('/platform/tickets/:id', {
    ...route,
    schema: { tags, summary: 'Changer le statut ou la priorité, s\'assigner', params: id, body: z.object({ status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), assignToMe: z.boolean().optional() }) },
  }, async (req) => {
    const a = req.platformAdmin!;
    const b = req.body;
    return a.run(async (tx) => {
      const res = await tx.query(
        `UPDATE support_tickets SET status = COALESCE($2, status), priority = COALESCE($3, priority),
                assigned_admin_id = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_admin_id END,
                resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 IS NOT NULL THEN NULL ELSE resolved_at END,
                closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
         WHERE id = $1`,
        [req.params.id, b.status ?? null, b.priority ?? null, b.assignToMe ?? false, a.adminId],
      );
      if (!res.rowCount) throw new AppError('not_found');
      return { ok: true };
    });
  });

  /* =========================================================================================
   * Journal d'audit et tâche planifiée
   * ======================================================================================= */
  r.get('/platform/audit-logs', {
    ...route,
    schema: { tags, summary: 'Journal d\'audit de la plateforme', querystring: page.extend({ hotelId: z.uuid().optional(), action: z.string().max(80).optional() }) },
  }, async (req) => {
    const { page: p, pageSize, hotelId, action } = req.query;
    return req.platformAdmin!.run(async (tx) => {
      const where: string[] = [];
      const args: unknown[] = [];
      if (hotelId) { args.push(hotelId); where.push(`l.hotel_id = $${args.length}`); }
      if (action) { args.push(action); where.push(`l.action = $${args.length}`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_audit_logs l ${w}`, args);
      const { rows } = await tx.query(
        `SELECT l.id, l.action, l.target_type AS "targetType", l.target_id AS "targetId", l.hotel_id AS "hotelId", l.details, l.created_at AS "createdAt", a.email AS "adminEmail"
         FROM platform_audit_logs l LEFT JOIN platform_admins a ON a.id = l.admin_id ${w} ORDER BY l.created_at DESC, l.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, pageSize, (p - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: p, pageSize };
    });
  });

  r.post('/platform/jobs/lifecycle', {
    ...route,
    schema: { tags, summary: 'Exécuter maintenant la tâche de cycle de vie des abonnements (essais échus, impayés, factures de renouvellement)' },
  }, async (req) => {
    const a = req.platformAdmin!;
    const summary = await runLifecycle(app.deps);
    await a.run((tx) => auditPlatform(tx, a.adminId, 'job.lifecycle_run', { type: 'job' }, { ...summary }, req.ip));
    return summary;
  });
}
