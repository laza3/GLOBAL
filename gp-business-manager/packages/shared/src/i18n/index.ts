import { en } from './en';
import { mg } from './mg';

export type Locale = 'fr' | 'en' | 'mg';

/**
 * Le texte français sert de clé (`t("Enregistrer")`). Une langue = un dictionnaire { texte français → traduction }.
 * Le français est la langue source (identité). Le malgache est branché : il suffit de compléter `mg.ts`
 * (toute clé manquante retombe sur le français).
 */
export const DICTIONARIES: Record<Locale, Record<string, string>> = { fr: {}, en, mg };
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'mg', label: 'Malagasy' },
];

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let s = DICTIONARIES[locale]?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
