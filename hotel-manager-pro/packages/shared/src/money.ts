/**
 * Montants : toujours des ENTIERS dans la plus petite unité de la devise (jamais de flottant).
 * L'ariary (MGA) n'a pas de sous-unité en usage courant : 80 000 en base = 80 000 Ar. EUR et USD ont des centimes.
 * La table est explicite (et non déduite de l'ICU du navigateur, qui peut varier d'une version à l'autre).
 */
export const CURRENCIES = {
  MGA: { digits: 0, symbol: 'Ar', name: 'Ariary malgache' },
  EUR: { digits: 2, symbol: '€', name: 'Euro' },
  USD: { digits: 2, symbol: '$', name: 'Dollar américain' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const isCurrency = (value: string): value is CurrencyCode => value in CURRENCIES;

/** Nombre de décimales de la devise (0 si la devise est inconnue : on n'invente pas de sous-unité). */
export const currencyDigits = (currency: string): number => (isCurrency(currency) ? CURRENCIES[currency].digits : 0);

/** Convertit un montant saisi à l'écran (ex. 12,5 €) en entier de la plus petite unité (1250), sans erreur d'arrondi binaire. */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(Number((amount * 10 ** currencyDigits(currency)).toFixed(6)));
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / 10 ** currencyDigits(currency);
}

/** « 80 000 Ar », « 12,50 € » — espaces insécables français ; devise inconnue : le code est affiché tel quel. */
export function formatMoney(minor: number, currency: string, locale = 'fr-FR'): string {
  const digits = currencyDigits(currency);
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(fromMinorUnits(minor, currency));
  const symbol = isCurrency(currency) ? CURRENCIES[currency].symbol : currency;
  return `${number} ${symbol}`;
}
