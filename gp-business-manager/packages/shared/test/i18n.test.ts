import { describe, expect, it } from 'vitest';
import { DICTIONARIES, translate } from '../src';

const vars = (s: string) => (s.match(/\{[A-Za-z0-9]+\}/g) ?? []).sort().join(',');

describe('i18n', () => {
  it('le français est la langue source (identité) et une clé absente retombe sur le français', () => {
    expect(translate('fr', 'Enregistrer')).toBe('Enregistrer');
    expect(translate('en', 'Enregistrer')).toBe('Save');
    expect(translate('en', 'Texte inconnu')).toBe('Texte inconnu');
    expect(translate('mg', 'Texte inconnu')).toBe('Texte inconnu');
  });
  it('les variables {x} sont conservées dans chaque traduction', () => {
    for (const lang of ['en', 'mg'] as const)
      for (const [k, v] of Object.entries(DICTIONARIES[lang])) {
        expect(v.trim().length, `${lang}: « ${k} » vide`).toBeGreaterThan(0);
        // les clés de format de numérotation ({YYYY}…) ne sont pas des variables
        if (!/\{YYYY\}/.test(k)) expect(vars(v), `${lang}: variables de « ${k} »`).toBe(vars(k));
      }
  });
  it('substitue les variables', () => {
    expect(translate('en', 'Retour enregistré : {n}', { n: 'RET-1' })).toBe('Return recorded: RET-1');
  });
});
