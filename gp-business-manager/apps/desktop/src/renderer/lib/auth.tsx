import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Locale } from '@gp/shared';
import { call, callRaw, onAuthLost } from './api';
import { configureFormat } from './format';

export interface Me { id: string; username: string; displayName: string; roleCode: string; roleName: string; branchId: string | null; mustChangePassword: boolean; permissions: string[] }
interface CompanyLite { name: string; currency: string; locale: Locale; timezone?: string; pricesIncludeTax?: boolean }
interface AuthState {
  loading: boolean; configured: boolean; me: Me | null; company: CompanyLite | null;
  can: (p: string | string[]) => boolean;
  refreshMe: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>; setup: (input: any) => Promise<void>; logout: () => Promise<void>; refreshCompany: () => Promise<void>;
  locale: Locale; setLocale: (l: Locale) => void;
}
const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children, onLocale }: { children: ReactNode; onLocale: (l: Locale) => void }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [company, setCompany] = useState<CompanyLite | null>(null);
  const [locale, setLocaleState] = useState<Locale>('fr');
  const applyLocale = useCallback((l: Locale) => { setLocaleState(l); onLocale(l); }, [onLocale]);

  const applyCompany = useCallback((c: CompanyLite) => { setCompany(c); configureFormat(c.currency, c.locale); }, []);
  const loadCompany = useCallback(async () => {
    const c = await call('company.get');
    const stored = (() => { try { return localStorage.getItem('gp.locale') as Locale | null; } catch { return null; } })();
    applyCompany({ name: c.name, currency: c.currency, locale: c.locale, timezone: c.timezone, pricesIncludeTax: c.pricesIncludeTax });
    applyLocale(stored ?? c.locale);
  }, [applyCompany, applyLocale]);

  useEffect(() => {
    (async () => {
      try {
        const st = await callRaw('app.status');
        setConfigured(st.configured);
        if (st.configured) {
          try { const m = await callRaw('auth.me'); setMe(m); await loadCompany(); } catch { /* non connecté */ }
        }
      } finally { setLoading(false); }
    })();
  }, [loadCompany]);

  useEffect(() => onAuthLost(() => { setMe(null); qc.clear(); }), [qc]);

  const afterLogin = useCallback(async () => { setMe(await callRaw('auth.me')); await loadCompany(); qc.clear(); }, [loadCompany, qc]);
  const v = useMemo<AuthState>(() => ({
    loading, configured, me, company,
    can: (p) => !!me && (Array.isArray(p) ? p.some((x) => me.permissions.includes(x)) : me.permissions.includes(p)),
    login: async (u, p) => { await callRaw('auth.login', { username: u, password: p }); await afterLogin(); },
    setup: async (input) => { await callRaw('app.setup', input); setConfigured(true); await afterLogin(); },
    logout: async () => { await callRaw('auth.logout'); setMe(null); qc.clear(); },
    refreshCompany: loadCompany,
    refreshMe: async () => { setMe(await callRaw('auth.me')); },
    locale,
    setLocale: (l) => { try { localStorage.setItem('gp.locale', l); } catch { /* ignore */ } applyLocale(l); },
  }), [loading, configured, me, company, locale, afterLogin, loadCompany, applyLocale, qc]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
