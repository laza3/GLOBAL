import { currencyDigits, type DateString } from '@hmp/shared';
import type { Tx } from '../db';
import { AppError } from '../errors';

/**
 * Note du client (folio) : la charge « hébergement » suit le total de la réservation ; les autres charges (restaurant, services…)
 * s'y ajoutent ; les paiements s'y inscrivent. Tout montant est un entier de la plus petite unité de la devise de la note.
 */

/** Aligne la charge d'hébergement de la note sur les montants de la réservation. Une réservation déjà facturée ne change plus de montant. */
export async function syncRoomCharge(tx: Tx, reservationId: string): Promise<void> {
  const { rows: res } = await tx.query<{ status: string; reference: string; subtotal_amount: number; discount_amount: number; tax_amount: number; total_amount: number }>(
    'SELECT status, reference, subtotal_amount, discount_amount, tax_amount, total_amount FROM reservations WHERE id = $1',
    [reservationId],
  );
  const r = res[0];
  if (!r) throw new AppError('reservation_not_found');
  const { rows: folio } = await tx.query<{ id: string }>('SELECT id FROM folios WHERE reservation_id = $1', [reservationId]);
  if (!folio[0]) return;
  const { rows: existing } = await tx.query<{ id: string; amount: number; tax_amount: number; invoiced: boolean }>(
    `SELECT c.id, c.amount, c.tax_amount, EXISTS (SELECT 1 FROM invoices i WHERE i.hotel_id = c.hotel_id AND i.id = c.invoice_id AND i.status = 'issued') AS invoiced
     FROM folio_charges c WHERE c.source = 'reservation' AND c.source_ref = $1 AND c.voided_at IS NULL`,
    [reservationId],
  );
  const charge = existing[0];

  if (r.status === 'cancelled' || r.status === 'no_show') {
    // Annulation : la charge non facturée disparaît de la note ; une charge déjà facturée se corrige par un avoir
    if (charge && !charge.invoiced) {
      await tx.query("UPDATE folio_charges SET voided_at = now(), void_reason = $2 WHERE id = $1", [charge.id, r.status === 'cancelled' ? 'Réservation annulée' : 'Client non présenté']);
    }
    return;
  }

  const net = r.subtotal_amount - r.discount_amount;
  if (!charge) {
    if (r.total_amount === 0) return;
    const { rows: first } = await tx.query<{ d: DateString }>("SELECT to_char(min(check_in), 'YYYY-MM-DD') AS d FROM reservation_rooms WHERE reservation_id = $1", [reservationId]);
    await tx.query(
      `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, quantity, unit_amount, amount, tax_amount, service_date, source, source_ref)
       SELECT hotel_id, $1, 'room', $2, 1, $3, $3, $4, COALESCE($5::date, current_date), 'reservation', $6 FROM folios WHERE id = $1`,
      [folio[0].id, `Hébergement ${r.reference}`, net, r.tax_amount, first[0]?.d ?? null, reservationId],
    );
    return;
  }
  if (charge.amount === net && charge.tax_amount === r.tax_amount) return;
  if (charge.invoiced) throw new AppError('reservation_invoiced');
  await tx.query('UPDATE folio_charges SET unit_amount = $2, amount = $2, tax_amount = $3 WHERE id = $1', [charge.id, net, r.tax_amount]);
}

/** Contre-valeur dans la devise de la note : 1 unité de `from` = `rate` unités de `to` (montants en plus petite unité). */
export function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  if (from === to) return amountMinor;
  return Math.round((amountMinor / 10 ** currencyDigits(from)) * rate * 10 ** currencyDigits(to));
}

/** Dernier taux enregistré pour convertir `from` vers `to`, ou null. */
export async function latestRate(tx: Tx, from: string, to: string): Promise<number | null> {
  const { rows } = await tx.query<{ rate: number }>(
    'SELECT rate FROM exchange_rates WHERE base_currency = $1 AND quote_currency = $2 AND effective_at <= now() ORDER BY effective_at DESC LIMIT 1',
    [from, to],
  );
  return rows[0]?.rate ?? null;
}

export interface FolioHead { id: string; status: string; currency: string; reservation_id: string | null; guest_id: string | null }

/** Verrouille la note pour la durée de la transaction (deux encaissements simultanés ne se marchent pas dessus). */
export async function lockFolio(tx: Tx, id: string): Promise<FolioHead> {
  const { rows } = await tx.query<FolioHead>('SELECT id, status, currency, reservation_id, guest_id FROM folios WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new AppError('folio_not_found');
  return rows[0];
}

export async function folioBalance(tx: Tx, folioId: string): Promise<{ charges: number; paid: number; due: number }> {
  const { rows } = await tx.query<{ charges_total: number; payments_total: number; balance_due: number }>('SELECT charges_total, payments_total, balance_due FROM folio_balances WHERE folio_id = $1', [folioId]);
  const b = rows[0];
  return { charges: b?.charges_total ?? 0, paid: b?.payments_total ?? 0, due: b?.balance_due ?? 0 };
}
