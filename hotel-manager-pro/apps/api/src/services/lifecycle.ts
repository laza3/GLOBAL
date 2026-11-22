import { platformTx } from '../db';
import type { AppDeps } from '../types';
import { createRenewalInvoice } from './saas-billing';

export interface LifecycleSummary {
  trialsExpired: number;
  cancelledAtPeriodEnd: number;
  pastDue: number;
  expired: number;
  renewalInvoices: number;
  /** Options de réservation expirées (chambres libérées), tous établissements. */
  tentativesExpired: number;
}

/**
 * Cycle de vie des abonnements — à exécuter régulièrement (toutes les heures) et à la demande depuis la console.
 *
 *  1. essai terminé                          trialing  → expired
 *  2. résiliation demandée, échéance passée  active/past_due → cancelled
 *  3. échéance dépassée sans renouvellement  active    → past_due
 *  4. tolérance dépassée                     past_due  → expired
 *  5. facture de renouvellement émise N jours avant l'échéance (une seule par période)
 *  6. options de réservation échues : annulées, chambres libérées (aucune donnée hôtelière n'est lue par la plateforme)
 *
 * Idempotent et sans effet de bord hors base. Les DROITS D'USAGE ne dépendent pas de cette tâche : ils sont calculés à
 * partir des dates à chaque requête ; elle met à jour l'état affiché, l'historique et les factures.
 */
export async function runLifecycle(deps: AppDeps): Promise<LifecycleSummary> {
  const now = deps.now();
  const graceDays = await deps.settings.number('billing.grace_days', 7);
  const renewalDays = await deps.settings.number('billing.renewal_invoice_days', 7);

  return platformTx(deps.db, async (tx) => {
    const transition = async (sql: string, args: unknown[]) => (await tx.query(sql, args)).rowCount ?? 0;

    const trialsExpired = await transition(
      `WITH changed AS (
         UPDATE subscriptions SET status = 'expired', ended_at = $1 WHERE status = 'trialing' AND trial_ends_at <= $1
         RETURNING id, hotel_id, plan_id, 'trialing'::text AS from_status)
       INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, details)
       SELECT hotel_id, id, 'expired', plan_id, from_status, 'expired', 'system', '{"reason":"trial_ended"}'::jsonb FROM changed`,
      [now],
    );

    const cancelledAtPeriodEnd = await transition(
      `WITH changed AS (
         UPDATE subscriptions SET status = 'cancelled', ended_at = $1, cancelled_at = COALESCE(cancelled_at, $1)
         WHERE status IN ('active', 'past_due') AND cancel_at_period_end AND current_period_end <= $1
         RETURNING id, hotel_id, plan_id)
       INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, details)
       SELECT hotel_id, id, 'cancelled', plan_id, 'active', 'cancelled', 'system', '{"reason":"cancel_at_period_end"}'::jsonb FROM changed`,
      [now],
    );

    const pastDue = await transition(
      `WITH changed AS (
         UPDATE subscriptions SET status = 'past_due' WHERE status = 'active' AND current_period_end <= $1
         RETURNING id, hotel_id, plan_id)
       INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, details)
       SELECT hotel_id, id, 'past_due', plan_id, 'active', 'past_due', 'system', '{"reason":"period_ended_unpaid"}'::jsonb FROM changed`,
      [now],
    );

    const expired = await transition(
      `WITH changed AS (
         UPDATE subscriptions SET status = 'expired', ended_at = $1
         WHERE status = 'past_due' AND current_period_end + make_interval(days => $2) <= $1
         RETURNING id, hotel_id, plan_id)
       INSERT INTO subscription_events (hotel_id, subscription_id, event_type, from_plan_id, from_status, to_status, actor_type, details)
       SELECT hotel_id, id, 'expired', plan_id, 'past_due', 'expired', 'system', '{"reason":"grace_ended"}'::jsonb FROM changed`,
      [now, graceDays],
    );

    // Factures de renouvellement : abonnements actifs ou impayés dont l'échéance approche, sans résiliation prévue
    const { rows: due } = await tx.query<{ id: string }>(
      `SELECT id FROM subscriptions
       WHERE status IN ('active', 'past_due') AND auto_invoice AND NOT cancel_at_period_end
         AND current_period_end - make_interval(days => $2) <= $1
       ORDER BY current_period_end`,
      [now, renewalDays],
    );
    let renewalInvoices = 0;
    for (const s of due) {
      if (await createRenewalInvoice(tx, deps, s.id)) renewalInvoices++;
    }

    const { rows: opt } = await tx.query<{ n: number }>('SELECT expire_all_tentatives() AS n');
    return { trialsExpired, cancelledAtPeriodEnd, pastDue, expired, renewalInvoices, tentativesExpired: opt[0]!.n };
  });
}
