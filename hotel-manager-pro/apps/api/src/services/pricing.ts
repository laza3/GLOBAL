import { quoteStay, type DateString, type RatePeriod, type StayQuote } from '@hmp/shared';
import type { Tx } from '../db';
import { AppError } from '../errors';

export interface PricingContext {
  categoryId: string;
  categoryName: string;
  baseRate: number;
  roomRate: number | null;
  periods: RatePeriod[];
}

/** Charge ce qu'il faut pour chiffrer un séjour : tarif de base, périodes de la catégorie, tarif propre à la chambre. */
export async function loadPricingContext(tx: Tx, categoryId: string, roomId?: string | null): Promise<PricingContext> {
  const { rows: cat } = await tx.query<{ name: string; base_rate: number; is_active: boolean }>(
    'SELECT name, base_rate, is_active FROM room_categories WHERE id = $1',
    [categoryId],
  );
  if (!cat[0]) throw new AppError('not_found');
  if (!cat[0].is_active) throw new AppError('category_inactive');

  let roomRate: number | null = null;
  if (roomId) {
    const { rows: room } = await tx.query<{ nightly_rate: number | null; category_id: string }>('SELECT nightly_rate, category_id FROM rooms WHERE id = $1', [roomId]);
    if (!room[0]) throw new AppError('not_found');
    roomRate = room[0].nightly_rate;
  }
  const { rows } = await tx.query<{
    id: string; name: string; starts_on: string; ends_on: string; nightly_rate: number; weekend_rate: number | null; min_stay: number; priority: number;
  }>(
    `SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, nightly_rate, weekend_rate, min_stay, priority
     FROM rate_periods WHERE category_id = $1 AND is_active`,
    [categoryId],
  );
  return {
    categoryId,
    categoryName: cat[0].name,
    baseRate: cat[0].base_rate,
    roomRate,
    periods: rows.map((p) => ({ id: p.id, name: p.name, startsOn: p.starts_on, endsOn: p.ends_on, nightlyRate: p.nightly_rate, weekendRate: p.weekend_rate, minStay: p.min_stay, priority: p.priority })),
  };
}

export const quote = (ctx: PricingContext, checkIn: DateString, checkOut: DateString): StayQuote =>
  quoteStay(checkIn, checkOut, { periods: ctx.periods, baseRate: ctx.baseRate, roomRate: ctx.roomRate });
