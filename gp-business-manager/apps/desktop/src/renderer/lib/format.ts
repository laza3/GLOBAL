import { formatMoney, formatQty, fromMinor, toMinor, toMilli } from '@gp/shared';

let currency = 'MGA';
let locale = 'fr-FR';
export const configureFormat = (c: string, l: string) => { currency = c; locale = l === 'en' ? 'en-US' : 'fr-FR'; };
export const money = (v: number | null | undefined) => (v == null ? '—' : formatMoney(v, currency, locale));
export const qty = (milli: number | null | undefined) => (milli == null ? '—' : formatQty(milli, locale));
export const currencyCode = () => currency;
/** « 1 500,5 » saisi → unité mineure. */
export const parseMoney = (s: string): number => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? toMinor(n, currency) : 0;
};
export const moneyToInput = (minor: number | null | undefined): string => (minor == null ? '' : String(fromMinor(minor, currency)));
export const parseQty = (s: string): number => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? toMilli(n) : 0;
};
export const qtyToInput = (milli: number | null | undefined): string => (milli == null ? '' : String(milli / 1000));
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const dateOnly = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(locale) : '—');
export const pct = (bp: number | null | undefined) => (bp == null ? '—' : `${(bp / 100).toFixed(1)} %`);
export const todayStr = (tz?: string) => new Date().toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined);
export const monthStartStr = () => todayStr().slice(0, 8) + '01';
