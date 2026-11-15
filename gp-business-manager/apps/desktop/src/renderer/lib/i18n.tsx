import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Locale } from '@gp/shared';

const Ctx = createContext<{ locale: Locale; t: (s: string, vars?: Record<string, string | number>) => string }>({ locale: 'fr', t: (s) => s });

/** Le texte français sert de clé : `t("Enregistrer")`. Pour une langue, ajouter un dictionnaire dans @gp/shared. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const v = useMemo(() => ({ locale, t: (s: string, vars?: Record<string, string | number>) => translate(locale, s, vars) }), [locale]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
