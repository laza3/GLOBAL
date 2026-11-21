import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../errors';
import type { Tx } from '../db';
import type { AppDeps } from '../types';

/**
 * Facturation SaaS (plateforme → établissement). Tout s'exécute dans UNE transaction sous le rôle plateforme.
 *
 * Règles :
 *  - une facture n'est « payée » que par des paiements CONFIRMÉS (calculé par la base, vue saas_invoice_balances) ;
 *  - un paiement n'est confirmé que par une validation humaine (ou, plus tard, un événement signé d'un prestataire connecté) ;
 *  - les effets d'une facture réglée (activation, renouvellement, changement de formule, licence) sont appliqués une seule
 *    fois, de façon idempotente, au moment de la CONFIRMATION d'un paiement.
 */

export interface InvoiceLineInput {
  description: string;
  quantity?: number;
  /** Montant unitaire net dans la plus petite unité de la devise (négatif pour une remise). */
  unitAmount: number;
}

export type Interval = 'month' | 'year';

export interface CreateInvoiceInput {
  hotelId: string;
  kind: 'subscription' | 'plan_change' | 'license' | 'other';
  currency: string;
  lines: InvoiceLineInput[];
  subscriptionId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  billingSnapshot?: Record<string, unknown>;
  notes?: string | null;
  adminId?: string | null;
}

/** Crée un brouillon avec ses lignes ; la taxe est calculée au taux configuré sur le net (remises déduites). */
export async function createDraftInvoice(tx: Tx, deps: AppDeps, input: CreateInvoiceInput): Promise<string> {
  const taxBps = await deps.settings.number('billing.tax_rate_bps', 0);
  const amounts = input.lines.map((l) => Math.round((l.quantity ?? 1) * l.unitAmount));
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  if (subtotal < 0) throw new AppError('invoice_totals_mismatch');
  const tax = Math.round((subtotal * taxBps) / 10_000);

  // Le rôle plateforme ne lit que l'annuaire agrégé (aucune donnée client)
  const { rows: hotel } = await tx.query<{ name: string }>('SELECT name FROM platform_hotel_directory WHERE hotel_id = $1', [input.hotelId]);
  if (!hotel[0]) throw new AppError('not_found');

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO saas_invoices (hotel_id, subscription_id, kind, currency, subtotal_amount, tax_amount, total_amount, period_start, period_end, billing_snapshot, notes, created_by_admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      input.hotelId, input.subscriptionId ?? null, input.kind, input.currency, subtotal, tax, subtotal + tax,
      input.periodStart ?? null, input.periodEnd ?? null,
      JSON.stringify({ hotelName: hotel[0].name, taxRateBps: taxBps, ...input.billingSnapshot }), input.notes ?? null, input.adminId ?? null,
    ],
  );
  const id = rows[0]!.id;
  let taxPlaced = false;
  for (const [i, line] of input.lines.entries()) {
    const lineTax = !taxPlaced && amounts[i]! > 0 ? tax : 0; // la taxe est portée par la première ligne positive
    if (lineTax || amounts[i]! > 0) taxPlaced = true;
    await tx.query(
      'INSERT INTO saas_invoice_lines (saas_invoice_id, hotel_id, position, description, quantity, unit_amount, amount, tax_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, input.hotelId, i, line.description, line.quantity ?? 1, line.unitAmount, amounts[i], lineTax],
    );
  }
  return id;
}

/** Émission : numéro séquentiel sans trou (compteur transactionnel), date d'émission et d'échéance. */
export async function issueInvoice(tx: Tx, deps: AppDeps, invoiceId: string): Promise<{ number: string }> {
  const dueDays = await deps.settings.number('billing.invoice_due_days', 7);
  const year = deps.now().getUTCFullYear();
  const { rows: cur } = await tx.query<{ status: string }>('SELECT status FROM saas_invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
  if (!cur[0]) throw new AppError('invoice_not_found');
  if (cur[0].status !== 'draft') throw new AppError('invoice_status_transition_invalid');
  const { rows: seq } = await tx.query<{ n: number }>('SELECT next_platform_counter($1) AS n', [`saas_invoice:${year}`]);
  const number = `FS-${year}-${String(seq[0]!.n).padStart(6, '0')}`;
  await tx.query(
    "UPDATE saas_invoices SET status = 'issued', number = $2, issued_at = $3, due_at = $3::timestamptz + make_interval(days => $4) WHERE id = $1",
    [invoiceId, number, deps.now(), dueDays],
  );
  return { number };
}

export async function invoiceBalance(tx: Tx, invoiceId: string) {
  const { rows } = await tx.query<{ amount_paid: number; balance_due: number; payment_status: string; total_amount: number; currency: string; hotel_id: string; status: string }>(
    'SELECT amount_paid, balance_due, payment_status, total_amount, currency, hotel_id, status FROM saas_invoice_balances WHERE invoice_id = $1',
    [invoiceId],
  );
  if (!rows[0]) throw new AppError('invoice_not_found');
  return rows[0];
}

/** Ajoute une période civile en SQL (sémantique PostgreSQL des fins de mois). */
export async function addInterval(tx: Tx, from: Date, interval: Interval): Promise<Date> {
  const { rows } = await tx.query<{ d: Date }>(
    interval === 'month' ? "SELECT ($1::timestamptz + interval '1 month') AS d" : "SELECT ($1::timestamptz + interval '1 year') AS d",
    [from],
  );
  return rows[0]!.d;
}

const monthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const span = (a: Date, b: Date) => `du ${monthYear.format(a)} au ${monthYear.format(b)}`;

/** Facture de renouvellement de la période SUIVANTE d'un abonnement (idempotente : une seule par période). */
export async function createRenewalInvoice(tx: Tx, deps: AppDeps, subscriptionId: string, adminId: string | null = null): Promise<string | null> {
  const { rows } = await tx.query<{
    id: string; hotel_id: string; plan_name: string; billing_interval: Interval; currency: string; price_amount: number;
    discount_amount: number; current_period_end: Date; status: string;
  }>(
    `SELECT s.id, s.hotel_id, p.name AS plan_name, s.billing_interval, s.currency, s.price_amount, s.discount_amount, s.current_period_end, s.status
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1 FOR UPDATE OF s`,
    [subscriptionId],
  );
  const s = rows[0];
  if (!s) throw new AppError('not_found');
  if (!['active', 'past_due'].includes(s.status)) throw new AppError('invalid_state');

  const now = deps.now();
  // La nouvelle période démarre à l'échéance actuelle, ou maintenant si l'abonnement est déjà échu
  const start = s.current_period_end > now ? s.current_period_end : now;
  // Une seule facture de renouvellement ouverte à la fois : tant qu'une facture émise (ou en brouillon) couvre une période
  // qui n'a pas encore été appliquée à l'abonnement, on n'en crée pas une autre — même si la tâche tourne toutes les heures.
  const open = await tx.query(
    "SELECT 1 FROM saas_invoices WHERE subscription_id = $1 AND kind = 'subscription' AND status IN ('draft', 'issued') AND period_end > $2 LIMIT 1",
    [subscriptionId, s.current_period_end],
  );
  if (open.rowCount) return null;

  const end = await addInterval(tx, start, s.billing_interval);
  const lines: InvoiceLineInput[] = [{
    description: `Abonnement ${s.plan_name} — ${s.billing_interval === 'month' ? 'mensuel' : 'annuel'} (${span(start, end)})`,
    unitAmount: s.price_amount,
  }];
  if (s.discount_amount > 0) lines.push({ description: 'Remise commerciale', unitAmount: -s.discount_amount });

  const id = await createDraftInvoice(tx, deps, {
    hotelId: s.hotel_id, kind: 'subscription', currency: s.currency, lines, subscriptionId, periodStart: start, periodEnd: end, adminId,
  });
  await issueInvoice(tx, deps, id);
  return id;
}

/* ---------------------------------------------------------------------------------------------
 * Paiements : confirmation (validation humaine) et effets de la facture réglée
 * ------------------------------------------------------------------------------------------- */

/** Valide un paiement DÉCLARÉ après vérification manuelle (relevé bancaire, SMS Mobile Money…), puis règle la facture si elle est soldée. */
export async function confirmPayment(tx: Tx, deps: AppDeps, paymentId: string, adminId: string): Promise<{ invoiceId: string | null; hotelId: string; effects: string[] }> {
  const { rows } = await tx.query<{ status: string; saas_invoice_id: string | null; hotel_id: string }>(
    'SELECT status, saas_invoice_id, hotel_id FROM saas_payments WHERE id = $1 FOR UPDATE',
    [paymentId],
  );
  const p = rows[0];
  if (!p) throw new AppError('payment_not_found');
  if (!['awaiting_validation', 'pending'].includes(p.status)) throw new AppError('payment_not_awaiting_validation');
  await tx.query("UPDATE saas_payments SET status = 'confirmed', validated_by_admin_id = $2, validated_at = $3 WHERE id = $1", [paymentId, adminId, deps.now()]);
  const effects = p.saas_invoice_id ? await settleInvoice(tx, deps, p.saas_invoice_id, adminId) : [];
  return { invoiceId: p.saas_invoice_id, hotelId: p.hotel_id, effects };
}

type InvoiceRow = {
  id: string; hotel_id: string; kind: string; subscription_id: string | null; period_start: Date | null; period_end: Date | null;
  billing_snapshot: { planId?: string; interval?: Interval; priceAmount?: number; discountAmount?: number; requestId?: string; licenseId?: string };
  currency: string;
};

/**
 * Applique les effets d'une facture entièrement réglée. Idempotent : un événement d'historique portant l'identifiant
 * de la facture sert de marqueur ; rejouer ne change rien.
 */
export async function settleInvoice(tx: Tx, deps: AppDeps, invoiceId: string, adminId: string | null): Promise<string[]> {
  const bal = await invoiceBalance(tx, invoiceId);
  if (bal.payment_status !== 'paid') return [];
  const { rows } = await tx.query<InvoiceRow>('SELECT id, hotel_id, kind, subscription_id, period_start, period_end, billing_snapshot, currency FROM saas_invoices WHERE id = $1', [invoiceId]);
  const inv = rows[0]!;
  const now = deps.now();
  const effects: string[] = [];
  const actor = adminId ? ({ actor_type: 'platform_admin', actor_id: adminId } as const) : ({ actor_type: 'system', actor_id: null } as const);

  const already = await tx.query("SELECT 1 FROM subscription_events WHERE hotel_id = $1 AND details->>'invoice_id' = $2 LIMIT 1", [inv.hotel_id, invoiceId]);
  if (already.rowCount && inv.kind !== 'license') return [];

  const event = (subscriptionId: string, type: string, fromPlan: string | null, toPlan: string | null, fromStatus: string | null, toStatus: string, details: object = {}) =>
    tx.query(
      `INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, to_plan_id, from_status, to_status, actor_type, actor_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [inv.hotel_id, subscriptionId, type, fromPlan, toPlan, fromStatus, toStatus, actor.actor_type, actor.actor_id, JSON.stringify({ invoice_id: invoiceId, ...details })],
    );

  if (inv.kind === 'subscription' && inv.subscription_id) {
    const { rows: subs } = await tx.query<{ id: string; status: string; plan_id: string; billing_interval: Interval; current_period_end: Date }>(
      'SELECT id, status, plan_id, billing_interval, current_period_end FROM subscriptions WHERE id = $1 FOR UPDATE',
      [inv.subscription_id],
    );
    const sub = subs[0]!;
    // Période payée ; si elle est déjà écoulée (règlement tardif), le service court à partir de maintenant
    let start = inv.period_start ?? now;
    let end = inv.period_end ?? (await addInterval(tx, start, sub.billing_interval));
    // Abonnement échu ou résilié : l'accès a été coupé entre-temps, la nouvelle période démarre à la date du règlement
    const lapsed = !['active', 'past_due', 'trialing'].includes(sub.status);
    if (end <= now || lapsed) {
      start = now;
      end = await addInterval(tx, now, sub.billing_interval);
    }
    if (['active', 'past_due', 'trialing'].includes(sub.status)) {
      await tx.query(
        "UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_start = $2, current_period_end = $3, ended_at = NULL WHERE id = $1",
        [sub.id, start, end],
      );
      await event(sub.id, sub.status === 'trialing' ? 'activated' : 'renewed', sub.plan_id, sub.plan_id, sub.status, 'active', { period_end: end });
      effects.push(sub.status === 'trialing' ? 'subscription_activated' : 'subscription_renewed');
    } else {
      // Abonnement échu ou résilié : il est RÉACTIVÉ par un nouvel abonnement de mêmes conditions (l'ancien reste dans l'historique)
      const { rows: old } = await tx.query<{ plan_id: string; plan_price_id: string | null; billing_interval: Interval; currency: string; price_amount: number; discount_amount: number }>(
        'SELECT plan_id, plan_price_id, billing_interval, currency, price_amount, discount_amount FROM subscriptions WHERE id = $1',
        [sub.id],
      );
      const o = old[0]!;
      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO subscriptions (hotel_id, plan_id, plan_price_id, status, billing_interval, currency, price_amount, discount_amount, started_at, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [inv.hotel_id, o.plan_id, o.plan_price_id, o.billing_interval, o.currency, o.price_amount, o.discount_amount, now, start, end],
      );
      await event(created[0]!.id, 'reactivated', o.plan_id, o.plan_id, sub.status, 'active', { previous_subscription_id: sub.id, period_end: end });
      effects.push('subscription_reactivated');
    }
  }

  if (inv.kind === 'plan_change' && inv.billing_snapshot.planId && inv.billing_snapshot.interval) {
    const snap = inv.billing_snapshot;
    const start = now;
    const end = await addInterval(tx, start, snap.interval!);
    const { rows: live } = await tx.query<{ id: string; plan_id: string; status: string }>(
      "SELECT id, plan_id, status FROM subscriptions WHERE hotel_id = $1 AND status IN ('trialing', 'active', 'past_due') FOR UPDATE",
      [inv.hotel_id],
    );
    const price = snap.priceAmount ?? 0;
    const discount = snap.discountAmount ?? 0;
    if (live[0]) {
      await tx.query(
        `UPDATE subscriptions SET plan_id = $2, billing_interval = $3, currency = $4, price_amount = $5, discount_amount = $6, status = 'active', trial_ends_at = NULL,
                current_period_start = $7, current_period_end = $8, cancel_at_period_end = false WHERE id = $1`,
        [live[0].id, snap.planId, snap.interval, inv.currency, price, discount, start, end],
      );
      await event(live[0].id, 'plan_changed', live[0].plan_id, snap.planId!, live[0].status, 'active', { period_end: end });
      effects.push('plan_changed');
    } else {
      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO subscriptions (hotel_id, plan_id, status, billing_interval, currency, price_amount, discount_amount, started_at, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
        [inv.hotel_id, snap.planId, snap.interval, inv.currency, price, discount, start, end],
      );
      await event(created[0]!.id, 'activated', null, snap.planId!, null, 'active', { period_end: end });
      effects.push('subscription_activated');
    }
    if (snap.requestId) {
      await tx.query("UPDATE plan_change_requests SET status = 'applied', effective_at = $2 WHERE id = $1 AND status IN ('approved', 'pending')", [snap.requestId, now]);
    }
  }

  if (inv.kind === 'license' && inv.billing_snapshot.licenseId) {
    const act = await tx.query(
      "UPDATE licenses SET status = 'active', activated_at = $2 WHERE id = $1 AND status = 'pending' RETURNING id",
      [inv.billing_snapshot.licenseId, now],
    );
    if (act.rowCount) {
      await tx.query("INSERT INTO license_events (hotel_id, license_id, event_type, admin_id, details) VALUES ($1, $2, 'activated', $3, $4)", [
        inv.hotel_id, inv.billing_snapshot.licenseId, adminId, JSON.stringify({ invoice_id: invoiceId }),
      ]);
      effects.push('license_activated');
    }
  }
  return effects;
}

/* ---------------------------------------------------------------------------------------------
 * Licences : la clé n'est montrée qu'une fois ; seule son empreinte est conservée.
 * ------------------------------------------------------------------------------------------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I : lisible à voix haute

export function generateLicenseKey(): { key: string; hash: string; prefix: string } {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  const key = `HMP-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
  return { key, hash: createHash('sha256').update(key).digest('hex'), prefix: key.slice(0, 8) };
}
