import { currencyDigits, fromMinorUnits, toMinorUnits } from '@hmp/shared';

/**
 * Saisie d'un montant → entier de la plus petite unité de la devise (ou null si illisible).
 * Accepte « 12,50 », « 12.5 », « 80 000 », « 80000 » ; refuse le négatif, les lettres et trop de décimales pour la devise.
 */
export function parseMoneyInput(input: string, currency: string): number | null {
  const cleaned = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const decimals = cleaned.split('.')[1]?.length ?? 0;
  if (decimals > currencyDigits(currency)) return null;
  return toMinorUnits(Number(cleaned), currency);
}

/** Valeur initiale d'un champ montant, depuis un entier de la plus petite unité. */
export const moneyInputValue = (minor: number, currency: string): string => {
  const v = fromMinorUnits(minor, currency);
  return currencyDigits(currency) === 0 ? String(v) : v.toFixed(currencyDigits(currency)).replace('.', ',');
};
