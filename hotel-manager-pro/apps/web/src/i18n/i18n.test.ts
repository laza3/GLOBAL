import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { getLocale, setLocale, t } from './index';

describe('catalogues de messages', () => {
  it('chaque clé du français existe en anglais et en malgache (aucun trou de traduction)', () => {
    const fr = Object.keys(CATALOGS.fr);
    for (const locale of ['en', 'mg'] as const) {
      expect(fr.filter((k) => !(k in CATALOGS[locale])), locale).toEqual([]);
      expect(Object.keys(CATALOGS[locale]).filter((k) => !(k in CATALOGS.fr)), `${locale} : clés en trop`).toEqual([]);
    }
  });
  it('les variables {…} se retrouvent identiques dans toutes les langues', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [key, fr] of Object.entries(CATALOGS.fr)) for (const locale of ['en', 'mg'] as const) expect(vars(CATALOGS[locale][key]!), `${locale}/${key}`).toBe(vars(fr));
  });
  it('t() : langue courante, variables, repli français, clé inconnue visible', () => {
    setLocale('en', { persist: false });
    expect(getLocale()).toBe('en');
    expect(t('nav.rooms')).toBe('Rooms');
    expect(t('dash.hello', { name: 'Hanitra' })).toBe('Hello Hanitra');
    setLocale('mg', { persist: false });
    expect(t('nav.rooms')).toBe('Efitra');
    expect(t('cle.inconnue')).toBe('cle.inconnue');
    setLocale('fr', { persist: false });
    expect(t('nav.rooms')).toBe('Chambres');
    expect(t('dash.hello', { name: 'Hanitra' })).toBe('Bonjour Hanitra');
  });
});
