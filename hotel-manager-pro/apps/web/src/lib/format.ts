export const DEFAULT_TIMEZONE = 'Indian/Antananarivo';

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string, withTime: boolean, long: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${withTime}|${long}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      day: 'numeric',
      month: long ? 'long' : 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
    cache.set(key, f);
  }
  return f;
}

/** « 21 nov. 2026 » ou « 21 novembre 2026 » dans le fuseau de l'établissement (Madagascar par défaut). */
export function formatDate(iso: string | null | undefined, opts: { timeZone?: string; time?: boolean; long?: boolean } = {}): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtf(opts.timeZone ?? DEFAULT_TIMEZONE, !!opts.time, !!opts.long).format(d);
}

const DAY = 86_400_000;

/** Nombre de jours entiers restants avant `iso` (négatif si dépassé). */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - now.getTime()) / DAY);
}

export const plural = (n: number, one: string, many: string) => (Math.abs(n) > 1 ? many : one);

/** « 3 jours », « 1 jour », « aujourd'hui » */
export function daysLabel(n: number): string {
  if (n <= 0) return "aujourd'hui";
  return `${n} ${plural(n, 'jour', 'jours')}`;
}

/** Initiales pour l'avatar : « Hanitra Rasoamanana » → « HR ». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : (parts[0]![1] ?? '');
  return (first + last).toUpperCase();
}

/** Date calendaire « AAAA-MM-JJ » (arrivée, départ, nuit) affichée telle quelle, sans décalage de fuseau. */
export const formatDay = (d: string | null | undefined, long = false): string => (d ? formatDate(`${d}T12:00:00Z`, { timeZone: 'UTC', long }) : '—');
