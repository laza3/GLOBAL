/**
 * Dates « calendaires » (jour, sans heure) : toujours des chaînes ISO « AAAA-MM-JJ », jamais des objets Date qui glissent
 * d'un fuseau à l'autre. Un séjour est exprimé en nuits : l'arrivée est incluse, le départ est EXCLU (départ le 21 et
 * arrivée le 21 ne se chevauchent pas).
 */
export type DateString = string;

const DAY = 86_400_000;
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(value: string): boolean {
  const m = RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

const toUtc = (s: DateString): number => {
  if (!isDateString(s)) throw new RangeError(`Date invalide : ${s}`);
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): DateString => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s: DateString, n: number): DateString => fromUtc(toUtc(s) + n * DAY);

/** Nombre de nuits entre l'arrivée (incluse) et le départ (exclu). Négatif si le départ précède l'arrivée. */
export const nightsBetween = (checkIn: DateString, checkOut: DateString): number => Math.round((toUtc(checkOut) - toUtc(checkIn)) / DAY);

/** Les nuits d'un séjour : [arrivée, départ[. */
export function eachNight(checkIn: DateString, checkOut: DateString): DateString[] {
  const n = nightsBetween(checkIn, checkOut);
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(checkIn, i));
}

/** 0 = dimanche … 6 = samedi (jour de la date elle-même, indépendant de tout fuseau). */
export const weekday = (s: DateString): number => new Date(toUtc(s)).getUTCDay();

/** Nuit de week-end : les nuits du vendredi et du samedi. */
export const isWeekendNight = (s: DateString): boolean => weekday(s) === 5 || weekday(s) === 6;

/** Date du jour dans un fuseau donné (ex. Indian/Antananarivo) : c'est ELLE qui fait foi pour « aujourd'hui ». */
export function todayIn(timeZone: string, now = new Date()): DateString {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Intersection de deux périodes [a1, a2[ et [b1, b2[ ? */
export const overlaps = (a1: DateString, a2: DateString, b1: DateString, b2: DateString): boolean => a1 < b2 && b1 < a2;
