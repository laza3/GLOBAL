import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformTx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { createDraftInvoice, issueInvoice, type Interval } from '../services/saas-billing';

const MANUAL_REFERENCE_FREE = new Set(['cash', 'other']);

export default async function billingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, settings } = app.deps;
  // La facturation SaaS reste accessible même abonnement échu : c'est précisément là qu'on règle pour reprendre
  const read = app.hotelAuth({ permission: 'subscription:read', lapsedOk: true });
  const manage = app.hotelAuth({ permission: 'subscription:manage', lapsedOk: true });
  const tags = ['Abonnement et facturation'];

  /* ------------------------------------------------------------------ Abonnement */
  r.get('/subscription', { preValidation: read, schema: { tags, summary: 'Abonnement en cours, droits d\'usage, prochaine échéance' } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const { rows: sub } = await tx.query(
        `SELECT s.id, s.status, s.billing_interval AS "billingInterval", s.currency, s.price_amount AS "priceAmount", s.discount_amount AS "discountAmount",
                s.started_at AS "startedAt", s.trial_ends_at AS "trialEndsAt", s.current_period_start AS "currentPeriodStart",
                s.current_period_end AS "currentPeriodEnd", s.cancel_at_period_end AS "cancelAtPeriodEnd",
                p.code AS "planCode", p.name AS "planName", p.max_rooms AS "maxRooms", p.max_users AS "maxUsers", p.features
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.status IN ('trialing', 'active', 'past_due') LIMIT 1`,
      );
      const { rows: pending } = await tx.query(
        `SELECT r.id, r.status, p.code AS "toPlanCode", p.name AS "toPlanName", r.to_interval AS "toInterval", r.requested_at AS "requestedAt"
         FROM plan_change_requests r JOIN plans p ON p.id = r.to_plan_id WHERE r.status IN ('pending', 'approved') ORDER BY r.requested_at DESC LIMIT 1`,
      );
      const { rows: due } = await tx.query(
        `SELECT invoice_id AS id, number, total_amount AS "totalAmount", balance_due AS "balanceDue", due_at AS "dueAt", is_overdue AS "isOverdue"
         FROM saas_invoice_balances WHERE status = 'issued' AND balance_due > 0 ORDER BY due_at LIMIT 1`,
      );
      const { rows: lic } = await tx.query(
        `SELECT key_prefix AS "keyPrefix", edition_code AS "editionCode", status, issued_at AS "issuedAt", maintenance_until AS "maintenanceUntil",
                hosting_included AS "hostingIncluded", max_rooms AS "maxRooms", max_users AS "maxUsers", terms
         FROM licenses WHERE status = 'active' LIMIT 1`,
      );
      return {
        subscription: sub[0] ?? null,
        license: lic[0] ?? null,
        pendingChangeRequest: pending[0] ?? null,
        nextInvoiceDue: due[0] ?? null,
        access: { state: me.access.state, reason: me.access.reason, graceEndsAt: me.access.graceEndsAt },
        entitlements: me.entitlements,
      };
    });
  });

  r.get('/subscription/history', { preValidation: read, schema: { tags, summary: 'Historique des abonnements et de leurs événements' } }, async (req) => {
    return req.hotel!.tenant(async (tx) => {
      const { rows: subscriptions } = await tx.query(
        `SELECT s.id, s.status, p.name AS "planName", p.code AS "planCode", s.billing_interval AS "billingInterval", s.currency, s.price_amount AS "priceAmount",
                s.started_at AS "startedAt", s.current_period_end AS "currentPeriodEnd", s.ended_at AS "endedAt"
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id ORDER BY s.started_at DESC`,
      );
      const { rows: events } = await tx.query(
        `SELECT e.id, e.subscription_id AS "subscriptionId", e.event_type AS "eventType", e.from_status AS "fromStatus", e.to_status AS "toStatus",
                e.actor_type AS "actorType", e.created_at AS "createdAt"
         FROM subscription_events e ORDER BY e.created_at DESC, e.id DESC LIMIT 200`,
      );
      return { subscriptions, events };
    });
  });

  /* ------------------------------------------------------------------ Changer de formule */
  r.post('/subscription/change-requests', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Demander à changer de formule (ou souscrire à la fin de l\'essai)',
      description: 'Les formules à tarif catalogue sont approuvées automatiquement : une facture est émise, et la formule change À LA CONFIRMATION du paiement. Les formules sur devis (Enterprise) restent en attente d\'une réponse de la plateforme.',
      body: z.object({ planCode: z.string().regex(/^[a-z0-9_-]{2,40}$/), interval: z.enum(['month', 'year']), message: z.string().trim().max(1000).optional() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const { planCode, interval, message } = req.body;

    const prepared = await me.tenant(async (tx) => {
      const { rows: plans } = await tx.query<{ id: string; name: string; is_custom_priced: boolean }>(
        'SELECT id, name, is_custom_priced FROM plans WHERE code = $1 AND is_public AND is_active', [planCode],
      );
      const plan = plans[0];
      if (!plan) throw new AppError('plan_not_available');
      const { rows: live } = await tx.query<{ id: string; plan_id: string; billing_interval: string; currency: string; status: string }>(
        "SELECT id, plan_id, billing_interval, currency, status FROM subscriptions WHERE status IN ('trialing', 'active', 'past_due') LIMIT 1",
      );
      const cur = live[0];
      if (cur && cur.plan_id === plan.id && cur.billing_interval === interval && cur.status === 'active') throw new AppError('invalid_state');
      const { rows: pend } = await tx.query("SELECT 1 FROM plan_change_requests WHERE status IN ('pending', 'approved')");
      if (pend.length) throw new AppError('plan_change_pending');

      const { rows: cs } = await tx.query<{ default_currency: string }>('SELECT default_currency FROM hotel_settings WHERE hotel_id = $1', [me.hotelId]);
      const currency = cur?.currency ?? cs[0]!.default_currency;
      let price: number | null = null;
      if (!plan.is_custom_priced) {
        const { rows: prices } = await tx.query<{ id: string; amount: number }>(
          'SELECT id, amount FROM plan_prices WHERE plan_id = $1 AND billing_interval = $2 AND currency = $3 AND is_active', [plan.id, interval, currency],
        );
        if (!prices[0]) throw new AppError('price_not_available');
        price = prices[0].amount;
      }
      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO plan_change_requests (hotel_id, subscription_id, from_plan_id, to_plan_id, to_interval, requested_by_user_id, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [me.hotelId, cur?.id ?? null, cur?.plan_id ?? null, plan.id, interval, me.userId, message ?? null],
      );
      await auditHotel(tx, me, 'subscription.change_requested', { type: 'plan_change_request', id: created[0]!.id }, `Demande : formule ${plan.name} (${interval === 'month' ? 'mensuel' : 'annuel'})`, { ip: req.ip, requestId: req.id });
      return { requestId: created[0]!.id, plan, currency, price };
    });

    const autoApprove = await settings.get<boolean>('billing.auto_approve_plan_changes', true);
    if (prepared.plan.is_custom_priced || !autoApprove || prepared.price === null) {
      return reply.code(202).send({ requestId: prepared.requestId, status: 'pending', invoice: null });
    }

    // Approbation automatique : le serveur agit sous le rôle plateforme pour émettre la facture, l'identité est celle de la demande
    const invoice = await platformTx(db, async (tx) => {
      const id = await createDraftInvoice(tx, app.deps, {
        hotelId: me.hotelId, kind: 'plan_change', currency: prepared.currency,
        lines: [{ description: `Abonnement ${prepared.plan.name} — ${interval === 'month' ? 'mensuel' : 'annuel'}`, unitAmount: prepared.price! }],
        billingSnapshot: { planId: prepared.plan.id, planCode, interval, priceAmount: prepared.price, discountAmount: 0, requestId: prepared.requestId },
      });
      const { number } = await issueInvoice(tx, app.deps, id);
      await tx.query("UPDATE plan_change_requests SET status = 'approved', decided_at = $2, decision_notes = 'Approbation automatique (tarif catalogue)' WHERE id = $1", [prepared.requestId, app.deps.now()]);
      return { id, number };
    });
    return reply.code(201).send({ requestId: prepared.requestId, status: 'approved', invoice });
  });

  r.delete('/subscription/change-requests/:id', {
    preValidation: manage,
    schema: { tags, summary: 'Annuler une demande en attente', params: z.object({ id: z.uuid() }) },
  }, async (req, reply) => {
    const res = await req.hotel!.tenant((tx) => tx.query("UPDATE plan_change_requests SET status = 'cancelled' WHERE id = $1 AND status = 'pending'", [req.params.id]));
    if (!res.rowCount) throw new AppError('not_found');
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------ Factures SaaS */
  r.get('/billing/invoices', { preValidation: read, schema: { tags, summary: 'Factures d\'abonnement émises à l\'établissement' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT i.id, i.number, i.kind, i.status, i.currency, i.total_amount AS "totalAmount", i.issued_at AS "issuedAt", i.due_at AS "dueAt",
                i.period_start AS "periodStart", i.period_end AS "periodEnd",
                b.amount_paid AS "amountPaid", b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus", b.is_overdue AS "isOverdue"
         FROM saas_invoices i JOIN saas_invoice_balances b ON b.invoice_id = i.id ORDER BY i.issued_at DESC NULLS LAST`,
      ),
    );
    return { invoices: rows };
  });

  r.get('/billing/invoices/:id', { preValidation: read, schema: { tags, summary: 'Détail d\'une facture : lignes, paiements, solde', params: z.object({ id: z.uuid() }) } }, async (req) => {
    return req.hotel!.tenant(async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.id, i.number, i.kind, i.status, i.currency, i.subtotal_amount AS "subtotalAmount", i.tax_amount AS "taxAmount", i.total_amount AS "totalAmount",
                i.issued_at AS "issuedAt", i.due_at AS "dueAt", i.period_start AS "periodStart", i.period_end AS "periodEnd", i.notes,
                b.amount_paid AS "amountPaid", b.balance_due AS "balanceDue", b.payment_status AS "paymentStatus", b.is_overdue AS "isOverdue"
         FROM saas_invoices i JOIN saas_invoice_balances b ON b.invoice_id = i.id WHERE i.id = $1`,
        [req.params.id],
      );
      if (!rows[0]) throw new AppError('invoice_not_found');
      const { rows: lines } = await tx.query(
        'SELECT description, quantity, unit_amount AS "unitAmount", amount, tax_amount AS "taxAmount" FROM saas_invoice_lines WHERE saas_invoice_id = $1 ORDER BY position',
        [req.params.id],
      );
      const { rows: payments } = await tx.query(
        `SELECT id, method, amount, currency, status, external_reference AS reference, submitted_at AS "submittedAt", validated_at AS "validatedAt", rejection_reason AS "rejectionReason"
         FROM saas_payments WHERE saas_invoice_id = $1 ORDER BY created_at`,
        [req.params.id],
      );
      return { ...rows[0], lines, payments };
    });
  });

  /* ------------------------------------------------------------------ Paiement : DÉCLARATION manuelle (jamais une confirmation) */
  r.get('/billing/payment-methods', { preValidation: read, schema: { tags, summary: 'Moyens de paiement disponibles et consignes' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query("SELECT code, name, mode, instructions FROM payment_connectors WHERE is_enabled ORDER BY name"),
    );
    return {
      methods: rows,
      notice: 'Le paiement est vérifié manuellement par la plateforme après réception : indiquez la référence de la transaction. Aucun prélèvement automatique n\'est effectué.',
    };
  });

  r.post('/billing/invoices/:id/payments', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Déclarer un paiement effectué (virement, Mobile Money…) pour qu\'il soit vérifié',
      description: 'Crée un paiement « en attente de validation ». La facture n\'est considérée comme réglée qu\'après validation par la plateforme. En-tête facultatif `Idempotency-Key` : rejouer la même requête ne crée pas de doublon.',
      params: z.object({ id: z.uuid() }),
      body: z.object({
        method: z.enum(['bank_transfer', 'mvola', 'orange_money', 'airtel_money', 'card', 'cash', 'other']),
        amount: z.number().int().positive().optional(),
        reference: z.string().trim().min(3).max(120).optional(),
        payerName: z.string().trim().max(120).optional(),
        payerPhone: z.string().trim().max(30).optional(),
      }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const { method, amount, reference, payerName, payerPhone } = req.body;
    const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].slice(0, 100) : null;

    const out = await me.tenant(async (tx) => {
      if (key) {
        const dup = await tx.query('SELECT id, status, amount FROM saas_payments WHERE idempotency_key = $1', [key]);
        if (dup.rows[0]) return { payment: dup.rows[0], replay: true };
      }
      const { rows } = await tx.query<{ status: string; currency: string; balance_due: number }>(
        'SELECT status, currency, balance_due FROM saas_invoice_balances WHERE invoice_id = $1', [req.params.id],
      );
      const inv = rows[0];
      if (!inv) throw new AppError('invoice_not_found');
      if (inv.status !== 'issued') throw new AppError('invoice_not_payable');
      if (inv.balance_due <= 0) throw new AppError('invoice_already_paid');

      const { rows: conn } = await tx.query<{ mode: string }>('SELECT mode FROM payment_connectors WHERE code = $1 AND is_enabled', [method]);
      if (!conn[0]) throw new AppError('payment_method_unavailable');
      // Aucun prestataire automatisé n'est implémenté : on ne simule JAMAIS un paiement en ligne
      if (conn[0].mode === 'automated') throw new AppError('provider_not_connected');
      if (!MANUAL_REFERENCE_FREE.has(method) && !reference) throw new AppError('reference_required');

      const value = amount ?? inv.balance_due;
      if (value > inv.balance_due) throw new AppError('payment_exceeds_due');
      const { rows: p } = await tx.query<{ id: string; status: string; amount: number }>(
        `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, payer_name, payer_phone, submitted_by_user_id, submitted_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'awaiting_validation', $6, $7, $8, $9, now(), $10) RETURNING id, status, amount`,
        [me.hotelId, req.params.id, method, value, inv.currency, reference ?? null, payerName ?? null, payerPhone ?? null, me.userId, key],
      );
      await auditHotel(tx, me, 'subscription.payment_declared', { type: 'saas_payment', id: p[0]!.id }, `Paiement déclaré (${method}) : ${value} ${inv.currency}`, { ip: req.ip, requestId: req.id });
      return { payment: p[0]!, replay: false };
    });
    return reply.code(out.replay ? 200 : 201).send({
      payment: out.payment,
      message: 'Paiement enregistré. Il sera pris en compte dès sa vérification par la plateforme.',
    });
  });

  r.get('/billing/payments', { preValidation: read, schema: { tags, summary: 'Paiements déclarés par l\'établissement' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT p.id, i.number AS "invoiceNumber", p.method, p.amount, p.currency, p.status, p.external_reference AS reference,
                p.submitted_at AS "submittedAt", p.validated_at AS "validatedAt", p.rejection_reason AS "rejectionReason"
         FROM saas_payments p LEFT JOIN saas_invoices i ON i.id = p.saas_invoice_id ORDER BY p.created_at DESC`,
      ),
    );
    return { payments: rows };
  });
}

export type { Interval };
