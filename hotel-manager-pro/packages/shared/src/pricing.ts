import { eachNight, isWeekendNight, nightsBetween, type DateString } from './dates';

/** Période tarifaire d'une catégorie de chambres. `endsOn` est INCLUSE (dernière nuit au tarif). */
export interface RatePeriod {
  id?: string;
  name?: string;
  startsOn: DateString;
  endsOn: DateString;
  nightlyRate: number;
  weekendRate: number | null;
  minStay: number;
  priority: number;
  isActive?: boolean;
}

export interface NightPrice {
  night: DateString;
  rate: number;
  /** D'où vient le prix : tarif propre à la chambre, période (saison), ou tarif de base de la catégorie. */
  source: 'room' | 'season' | 'base';
  periodName?: string;
}

export interface StayQuote {
  nights: NightPrice[];
  subtotal: number;
  /** Séjour minimal exigé par la période de la nuit d'arrivée (1 si aucune). */
  minStay: number;
  minStayRespected: boolean;
}

/** Période applicable à une nuit : priorité la plus haute, puis la plus courte (la plus précise), puis la plus récente. */
export function periodFor(night: DateString, periods: RatePeriod[]): RatePeriod | null {
  const covering = periods.filter((p) => p.isActive !== false && p.startsOn <= night && night <= p.endsOn);
  if (covering.length === 0) return null;
  return covering.sort(
    (a, b) =>
      b.priority - a.priority ||
      nightsBetween(a.startsOn, a.endsOn) - nightsBetween(b.startsOn, b.endsOn) ||
      (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0),
  )[0]!;
}

/**
 * Prix d'une nuit. Règle (documentée dans docs/api.md) :
 *   1. un tarif propre à la chambre remplace tous les autres (prix explicite et fixe) ;
 *   2. sinon la période de la catégorie qui couvre la nuit (tarif week-end le vendredi et le samedi, s'il est défini) ;
 *   3. sinon le tarif de base de la catégorie.
 */
export function priceNight(night: DateString, opts: { periods: RatePeriod[]; baseRate: number; roomRate?: number | null }): NightPrice {
  if (opts.roomRate != null) return { night, rate: opts.roomRate, source: 'room' };
  const p = periodFor(night, opts.periods);
  if (p) {
    const rate = isWeekendNight(night) && p.weekendRate != null ? p.weekendRate : p.nightlyRate;
    return { night, rate, source: 'season', periodName: p.name };
  }
  return { night, rate: opts.baseRate, source: 'base' };
}

export function quoteStay(checkIn: DateString, checkOut: DateString, opts: { periods: RatePeriod[]; baseRate: number; roomRate?: number | null }): StayQuote {
  const nights = eachNight(checkIn, checkOut).map((n) => priceNight(n, opts));
  const first = periodFor(checkIn, opts.periods);
  const minStay = first?.minStay ?? 1;
  return { nights, subtotal: nights.reduce((s, n) => s + n.rate, 0), minStay, minStayRespected: nights.length >= minStay };
}
