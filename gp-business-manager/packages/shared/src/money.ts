/**
 * Argent et quantités — toutes les valeurs monétaires sont des ENTIERS en unité mineure
 * (ex. MGA : 1 Ar, EUR : 1 centime). Les quantités sont des ENTIERS en millièmes
 * (1,5 kg = 1500). Aucun flottant n'est utilisé dans les calculs financiers.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  /** nombre de décimales de l'unité mineure (MGA = 0, EUR/USD = 2) */
  decimals: number;
  name: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  MGA: { code: 'MGA', symbol: 'Ar', decimals: 0, name: 'Ariary malgache' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' },
  USD: { code: 'USD', symbol: '$', decimals: 2, name: 'Dollar US' },
  MUR: { code: 'MUR', symbol: 'Rs', decimals: 2, name: 'Roupie mauricienne' },
  KMF: { code: 'KMF', symbol: 'CF', decimals: 0, name: 'Franc comorien' },
  XOF: { code: 'XOF', symbol: 'CFA', decimals: 0, name: 'Franc CFA (BCEAO)' },
  ZAR: { code: 'ZAR', symbol: 'R', decimals: 2, name: 'Rand sud-africain' },
};

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES[code] ?? { code, symbol: code, decimals: 2, name: code };
}

/** Division entière arrondie « half away from zero », exacte (BigInt). */
export function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('Division par zéro');
  const n = BigInt(Math.trunc(numerator));
  const d = BigInt(Math.trunc(denominator));
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return Number(neg ? -q : q);
}

/** Montant décimal saisi (ex. 12.5) → unité mineure. */
export function toMinor(amount: number, currency: string): number {
  const f = 10 ** currencyInfo(currency).decimals;
  return Math.round(Number((amount * f).toFixed(6)));
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyInfo(currency).decimals;
}

export function formatMoney(minor: number, currency: string, locale = 'fr-FR'): string {
  const c = currencyInfo(currency);
  const v = minor / 10 ** c.decimals;
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  }).format(v);
  return `${n} ${c.symbol}`;
}

/** Quantité décimale (1.5) → millièmes (1500). */
export function toMilli(qty: number): number {
  return Math.round(Number((qty * 1000).toFixed(4)));
}
export function fromMilli(milli: number): number {
  return milli / 1000;
}
export function formatQty(milli: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(milli / 1000);
}

/** prix × quantité(millièmes), arrondi à l'unité mineure. */
export function mulQty(unit: number, qtyMilli: number): number {
  return roundDiv(unit * qtyMilli, 1000);
}

/** Pourcentage en points de base (basis points) : 20 % = 2000. */
export function percentOf(amount: number, bp: number): number {
  return roundDiv(amount * bp, 10000);
}

/**
 * Répartit `total` proportionnellement à `weights` (méthode du plus fort reste).
 * La somme du résultat est TOUJOURS égale à `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = weights.map((w) => Number((BigInt(abs) * BigInt(w)) / BigInt(sum)));
  const rem = weights.map((w, i) => ({
    i,
    r: Number((BigInt(abs) * BigInt(w)) % BigInt(sum)),
  }));
  let left = abs - base.reduce((a, b) => a + b, 0);
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rem) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      base[i] += 1;
      left -= 1;
    }
  }
  return base.map((v) => v * sign);
}
