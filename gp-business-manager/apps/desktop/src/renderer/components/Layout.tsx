import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Boxes, ChevronsLeft, ChevronsRight, CircleDollarSign, FileBarChart, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Settings, ShieldCheck, ShoppingCart, Sun, Truck, Users, Wallet, WifiOff, Receipt, Lock } from 'lucide-react';
import { Logo } from './Brand';
import { Button, Field, Input, Modal, useToast, cx } from './ui';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { useT } from '../lib/i18n';
import { call, useQ } from '../lib/api';
import { LOCALES, type Locale } from '@gp/shared';

const NAV: { to: string; label: string; icon: any; perm: string | string[]; group: string }[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, perm: 'dashboard.view', group: 'Pilotage' },
  { to: '/pos', label: 'Caisse (POS)', icon: ShoppingCart, perm: 'sale.create', group: 'Vente' },
  { to: '/sales', label: 'Historique des ventes', icon: Receipt, perm: 'sale.view', group: 'Vente' },
  { to: '/cash', label: 'Sessions de caisse', icon: Wallet, perm: 'cash.session', group: 'Vente' },
  { to: '/customers', label: 'Clients', icon: Users, perm: 'customer.view', group: 'Vente' },
  { to: '/products', label: 'Produits', icon: Boxes, perm: 'product.view', group: 'Catalogue & stock' },
  { to: '/stock', label: 'Stocks', icon: BarChart3, perm: 'stock.view', group: 'Catalogue & stock' },
  { to: '/purchasing', label: 'Achats & fournisseurs', icon: Truck, perm: ['supplier.view', 'purchase.view'], group: 'Catalogue & stock' },
  { to: '/finance', label: 'Finances', icon: CircleDollarSign, perm: 'finance.view', group: 'Gestion' },
  { to: '/reports', label: 'Rapports', icon: FileBarChart, perm: ['report.view', 'finance.view'], group: 'Gestion' },
  { to: '/admin', label: 'Administration', icon: ShieldCheck, perm: ['user.manage', 'audit.view', 'organization.manage', 'backup.manage', 'role.manage'], group: 'Système' },
  { to: '/settings', label: 'Paramètres', icon: Settings, perm: 'settings.manage', group: 'Système' },
];

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [err, setErr] = useState('');
  const save = async () => { try { await call('auth.changePassword', { oldPassword: o, newPassword: n }); push('success', t('Mot de passe modifié')); setO(''); setN(''); setErr(''); onClose(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Modal open={open} onClose={onClose} title="Changer mon mot de passe" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" onClick={save} disabled={!o || n.length < 8}>{t('Enregistrer')}</Button></>}>
      <div className="space-y-3">
        <Field label="Mot de passe actuel"><Input type="password" value={o} onChange={(e) => setO(e.target.value)} /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum" error={err}><Input type="password" value={n} onChange={(e) => setN(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function Layout() {
  const { me, company, can, logout, locale, setLocale } = useAuth();
  const { mode, toggle } = useTheme();
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1180);
  const [mobile, setMobile] = useState(false);
  const [pw, setPw] = useState(false);
  const sync = useQ('sync.status', undefined, { refetchInterval: 15000 });
  const session = useQ('cash.current', undefined, { enabled: can(['cash.session', 'sale.create']), refetchInterval: 20000 });
  useEffect(() => setMobile(false), [loc.pathname]);

  const items = NAV.filter((n) => can(n.perm));
  const groups = [...new Set(items.map((i) => i.group))];
  const pending = sync.data?.pending ?? 0;

  const sidebar = (
    <aside className={cx('flex h-full flex-col bg-ink-950 text-ink-200 transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-64')}>
      <div className={cx('flex h-16 items-center gap-3 px-4', collapsed && 'justify-center px-0')}>
        <Logo size={34} />
        {!collapsed && <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">GP Business</p><p className="truncate text-[11px] text-ink-400">{company?.name}</p></div>}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {groups.map((g) => (
          <div key={g}>
            {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{t(g)}</p>}
            <div className="space-y-0.5">
              {items.filter((i) => i.group === g).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} title={collapsed ? t(i.label) : undefined}
                  className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', collapsed && 'justify-center px-0', isActive ? 'bg-white/[0.08] text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white')}>
                  {({ isActive }) => (<>
                    {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-gold-400" />}
                    <i.icon className={cx('size-[18px] shrink-0', isActive && 'text-gold-300')} />
                    {!collapsed && <span className="truncate">{t(i.label)}</span>}
                  </>)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={() => setCollapsed((c) => !c)} className="m-3 hidden items-center justify-center gap-2 rounded-xl py-2 text-xs text-ink-400 hover:bg-white/5 hover:text-white lg:flex" aria-label={t('Réduire le menu')}>
        {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />{t('Réduire')}</>}
      </button>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="no-print hidden lg:block">{sidebar}</div>
      {mobile && <div className="no-print fixed inset-0 z-40 flex lg:hidden"><div className="absolute inset-0 bg-ink-950/60" onClick={() => setMobile(false)} /><div className="relative h-full">{sidebar}</div></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center gap-3 border-b border-ink-100 bg-white/80 px-4 backdrop-blur dark:border-white/[0.07] dark:bg-ink-950/60">
          <button className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden dark:hover:bg-white/10" onClick={() => setMobile(true)} aria-label="Menu"><Menu className="size-5" /></button>
          <div className="flex-1" />
          {session.data ? (
            <button onClick={() => nav('/cash')} className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:flex dark:bg-emerald-400/10 dark:text-emerald-300"><span className="size-2 animate-pulse rounded-full bg-emerald-500" />{session.data.registerName} · {t('ouverte')}</button>
          ) : can('cash.session') && (
            <button onClick={() => nav('/cash')} className="hidden items-center gap-2 rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-500 sm:flex dark:bg-white/5"><Lock className="size-3.5" />{t('Caisse fermée')}</button>
          )}
          <div title={t('Les données sont stockées localement. La synchronisation cloud n’est pas encore activée.')} className="flex items-center gap-2 rounded-full bg-gold-50 px-3 py-1.5 text-xs font-medium text-gold-700 dark:bg-gold-400/10 dark:text-gold-200">
            <WifiOff className="size-3.5" /><span className="hidden md:inline">{t('Mode local')}</span>{pending > 0 && <span className="rounded-full bg-gold-400 px-1.5 text-[10px] font-semibold text-ink-950">{pending}</span>}
          </div>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="h-9 rounded-lg border border-ink-200 bg-transparent px-2 text-xs dark:border-white/10 dark:[&>option]:bg-ink-900" aria-label="Langue">
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>)}
          </select>
          <button onClick={toggle} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-white/10" aria-label={t('Changer le thème')}>{mode === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</button>
          <div className="group relative">
            <button className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-ink-100 dark:hover:bg-white/10">
              <span className="grid size-8 place-items-center rounded-lg bg-ink-800 text-xs font-semibold text-gold-300">{me?.displayName.slice(0, 2).toUpperCase()}</span>
              <span className="hidden text-left leading-tight md:block"><span className="block text-sm font-medium">{me?.displayName}</span><span className="block text-[11px] text-ink-400">{me ? t(me.roleName) : ""}</span></span>
            </button>
            <div className="invisible absolute right-0 top-full z-30 w-52 pt-1 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <div className="rounded-xl border border-ink-100 bg-white p-1 shadow-pop dark:border-white/10 dark:bg-ink-800">
                <button onClick={() => setPw(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ink-50 dark:hover:bg-white/10"><KeyRound className="size-4" />{t('Mot de passe')}</button>
                <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-400/10"><LogOut className="size-4" />{t('Déconnexion')}</button>
              </div>
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[1600px] animate-fade-in p-5 lg:p-7"><Outlet /></div></main>
      </div>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
