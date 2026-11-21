import { Building2, CreditCard, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Receipt, Repeat, ScrollText, Settings, ShieldCheck, Layers, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { usePlatformLogout, useStats } from '../api/platform';
import { PageBackdrop } from '../auth/screens';
import { usePlatformAdmin } from '../auth/platform-session';
import { initials } from '../lib/format';
import { useDocumentTitle } from '../lib/use-title';
import { CommandPalette, useCommandShortcut, type CommandEntry, type MenuItem } from '../ui/overlay';
import { Sidebar, TabBar, Topbar, useOnline, type NavItem } from '../ui/shell';
import { useTheme } from '../ui/theme';

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Pilotage',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
      { id: 'hotels', label: 'Établissements', icon: Building2 },
      { id: 'subscriptions', label: 'Abonnements', icon: Repeat },
    ],
  },
  {
    label: 'Argent',
    items: [
      { id: 'payments', label: 'Paiements', icon: CreditCard },
      { id: 'invoices', label: 'Factures', icon: Receipt },
      { id: 'plans', label: 'Forfaits et tarifs', icon: Layers },
      { id: 'licenses', label: 'Licences', icon: KeyRound },
    ],
  },
  {
    label: 'Exploitation',
    items: [
      { id: 'support', label: 'Assistance', icon: LifeBuoy },
      { id: 'settings', label: 'Réglages', icon: Settings },
      { id: 'audit', label: "Journal d'audit", icon: ScrollText },
    ],
  },
];
const ITEMS = GROUPS.flatMap((g) => g.items);
const TAB_IDS = ['dashboard', 'hotels', 'payments'];
const COLLAPSE_KEY = 'hmp-platform-sidebar-collapsed';

export function PlatformLayout() {
  const admin = usePlatformAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const logout = usePlatformLogout();
  const stats = useStats();
  const { setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandShortcut(useCallback(() => setPaletteOpen((o) => !o), []));

  const activeId = location.pathname.split('/')[2] || 'dashboard';
  const go = useCallback((id: string) => navigate(`/platform/${id}`), [navigate]);
  const title = ITEMS.find((n) => n.id === activeId)?.label ?? 'Console';
  useDocumentTitle(`${title} — Console`);

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => navigate('/platform/connexion', { replace: true }),
      onError: () => toast.error('La déconnexion n\'a pas pu être confirmée par le serveur ; votre session locale est fermée.'),
    });

  // Notifications = file de travail réelle : paiements à valider, assistance ouverte
  const notifications: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [];
    const awaiting = stats.data?.paymentsAwaitingValidation.reduce((n, p) => n + p.payments, 0) ?? 0;
    if (awaiting > 0) items.push({ label: `${awaiting} paiement${awaiting > 1 ? 's' : ''} à valider`, icon: <CreditCard />, onSelect: () => go('payments') });
    const tickets = Object.values(stats.data?.openTickets ?? {}).reduce((n, v) => n + v, 0);
    if (tickets > 0) items.push({ label: `${tickets} demande${tickets > 1 ? 's' : ''} d'assistance ouverte${tickets > 1 ? 's' : ''}`, icon: <LifeBuoy />, onSelect: () => go('support') });
    if (items.length === 0) items.push({ label: 'Rien en attente', icon: <ShieldCheck />, disabled: true });
    return items;
  }, [stats.data, go]);

  const entries: CommandEntry[] = [
    ...ITEMS.map((n) => ({ id: `nav-${n.id}`, label: n.label, group: 'Aller à', icon: <n.icon />, keywords: [n.id], onSelect: () => go(n.id) })),
    { id: 't-light', label: 'Thème clair', group: 'Affichage', onSelect: () => setPreference('light') },
    { id: 't-dark', label: 'Thème sombre', group: 'Affichage', onSelect: () => setPreference('dark') },
    { id: 'logout', label: 'Se déconnecter', group: 'Compte', icon: <LogOut />, onSelect: signOut },
  ];

  return (
    <PageBackdrop>
      <a href="#main" className="sr-only-focusable fixed top-3 left-3 z-50 rounded-control bg-[var(--glass-data)] px-4 py-2 text-[14px] font-medium text-ink shadow-[var(--shadow-2)]">
        Aller au contenu
      </a>
      <div className="mx-auto flex w-full max-w-[1680px] gap-4 p-3 lg:p-4">
        <div className="sticky top-4 hidden h-[calc(100dvh-2rem)] shrink-0 lg:block">
          <Sidebar
            groups={GROUPS}
            brandLabel="Console"
            active={activeId}
            onNavigate={go}
            collapsed={collapsed}
            onToggle={() =>
              setCollapsed((c) => {
                try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* stockage indisponible */ }
                return !c;
              })
            }
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="sticky top-3 z-20 lg:top-4">
            <Topbar
              title={title}
              online={online}
              onOpenPalette={() => setPaletteOpen(true)}
              notifications={notifications}
              account={[{ label: admin.email, disabled: true }, { label: 'Se déconnecter', icon: <LogOut />, onSelect: signOut, separated: true }]}
              initials={initials(admin.fullName)}
            />
          </div>
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-col gap-4 pb-28 outline-none lg:pb-6">
            <Outlet />
          </main>
        </div>
      </div>
      <TabBar active={activeId} onNavigate={go} items={ITEMS} tabIds={TAB_IDS} className="lg:hidden" />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} entries={entries} />
    </PageBackdrop>
  );
}

export type { LucideIcon };
