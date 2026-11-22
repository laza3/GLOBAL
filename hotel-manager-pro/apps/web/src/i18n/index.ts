import { useSyncExternalStore } from 'react';
import { CATALOGS, LOCALES, type Locale } from './catalogs';

export { LOCALES, type Locale };

const KEY = 'hmp_locale';
const isLocale = (v: unknown): v is Locale => v === 'fr' || v === 'en' || v === 'mg';

function stored(): Locale | null {
  try { const v = localStorage.getItem(KEY); return isLocale(v) ? v : null; } catch { return null; }
}

let current: Locale = stored() ?? 'fr';
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

/** Change la langue : mémorisée dans ce navigateur, `<html lang>` mis à jour, tout composant abonné se redessine. */
export function setLocale(next: Locale, opts: { persist?: boolean } = {}) {
  if (next === current) return;
  current = next;
  if (opts.persist !== false) { try { localStorage.setItem(KEY, next); } catch { /* stockage indisponible : la langue vaut pour cette session */ } }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

/** Langue de l'établissement, appliquée seulement si la personne n'a pas choisi la sienne dans ce navigateur. */
export function applyHotelLocale(hotelLocale: string | null | undefined) {
  if (stored() === null && isLocale(hotelLocale)) setLocale(hotelLocale, { persist: false });
}

/** Message traduit : langue courante, puis français, jamais la clé brute (sauf clé inconnue de tous). `{nom}` est remplacé. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = CATALOGS[current][key] ?? CATALOGS.fr[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** Hook : le composant se redessine quand la langue change. */
export function useT() {
  useSyncExternalStore(subscribe, getLocale, () => 'fr' as Locale);
  return t;
}

/** Code de langue pour `Intl` (dates, nombres). */
export const intlLocale = (): string => ({ fr: 'fr-FR', en: 'en-GB', mg: 'fr-MG' })[current];

if (typeof document !== 'undefined') document.documentElement.lang = current;
