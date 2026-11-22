import { Bell, CreditCard, LifeBuoy, LogOut, Monitor, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLogout, useSubscription, useTickets } from '../api/hotel';
import { SOON } from '../app-modules';
import { MeProvider, useCan, useMe } from '../auth/session';
import { PageBackdrop } from '../auth/screens';
import { daysUntil, formatDate, initials } from '../lib/format';
import { useDocumentTitle } from '../lib/use-title';
import { formatMoney } from '@hmp/shared';
import { CommandPalette, useCommandShortcut, type CommandEntry, type MenuItem } from '../ui/overlay';
import { ALL_NAV, NAV_GROUPS, Sidebar, TabBar, Topbar, useOnline } from '../ui/shell';
import { useTheme } from '../ui/theme';
import { AccessBanner } from './access-banner';
import { PasswordBanner } from './password-banner';
import { useEffect } from 'react';
import { useHotel } from '../api/hotel';
import { applyHotelLocale } from '../i18n';

/** Applique la langue de l'établissement tant que la personne n'a pas choisi la sienne dans ce navigateur. */
function LocaleSync() {
  const hotel = useHotel();
  useEffect(() => { applyHotelLocale(hotel.data?.locale); }, [hotel.data?.locale]);
  return null;
}
import { BlockedScreen } from './blocked-screen';

const COLLAPSE_KEY = 'hmp-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Notifications construites à partir de l'état réel (facture à régler, assistance qui attend une réponse) — jamais de contenu inventé. */
function useNotificationItems(navigate: (to: string) => void): MenuItem[] {
  const sub = useSubscription();
  const tickets = useTickets();
  return useMemo(() => {
    const items: MenuItem[] = [];
    const due = sub.data?.nextInvoiceDue;
    if (due) {
      const left = daysUntil(due.dueAt);
      items.push({
        label: `Facture ${due.number} : ${formatMoney(due.balanceDue, sub.data?.subscription?.currency ?? 'MGA')} ${due.isOverdue ? 'en retard' : `à régler avant le ${formatDate(due.dueAt)}${left !== null && left >= 0 ? '' : ''}`}`,
        icon: <CreditCard />,
        onSelect: () => navigate('/settings/invoices'),
      });
    }
    for (const t of tickets.data ?? []) {
      if (t.status === 'waiting_customer') {
        items.push({ label: `Le support attend votre réponse : ${t.subject}`, icon: <LifeBuoy />, onSelect: () => navigate(`/settings/support?ticket=${t.id}`) });
      }
    }
    if (items.length === 0) items.push({ label: 'Aucune notification', icon: <Bell />, disabled: true });
    return items;
  }, [sub.data, tickets.data, navigate]);
}

export function HotelLayout() {
  const me = useMe();
  if (me.access.state === 'blocked') return <BlockedScreen />;
  return <Shell />;
}

function Shell() {
  const me = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const logout = useLogout();
  const { setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandShortcut(useCallback(() => setPaletteOpen((o) => !o), []));

  const activeId = location.pathname.split('/')[1] || 'overview';
  const go = useCallback((to: string) => navigate(to), [navigate]);
  const title = ALL_NAV.find((n) => n.id === activeId)?.label ?? 'Hotel Manager Pro';
  useDocumentTitle(title);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* stockage indisponible : le repli reste valable pour cette session */
      }
      return !c;
    });

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => navigate('/connexion', { replace: true }),
      onError: () => toast.error('La déconnexion n\'a pas pu être confirmée par le serveur ; votre session locale est fermée.'),
    });

  const notifications = useNotificationItems(go);
  const accountItems: MenuItem[] = [
    { label: 'Mon compte', icon: <UserRound />, onSelect: () => go('/settings/account') },
    ...(can('subscription:read') ? [{ label: 'Abonnement et factures', icon: <CreditCard />, onSelect: () => go('/settings/subscription') }] : []),
    { label: 'Assistance', icon: <LifeBuoy />, onSelect: () => go('/settings/support') },
    { label: 'Se déconnecter', icon: <LogOut />, onSelect: signOut, separated: true },
  ];

  const entries: CommandEntry[] = [
    ...NAV_GROUPS.flatMap((g) =>
      g.items.map((n) => ({
        id: `nav-${n.id}`,
        label: n.label,
        group: 'Aller à',
        icon: <n.icon />,
        hint: SOON.has(n.id) ? 'Bientôt' : undefined,
        keywords: [n.id],
        onSelect: () => go(`/${n.id}`),
      })),
    ),
    { id: 'p-hotel', label: "Profil de l'établissement", group: 'Paramètres', icon: <Settings />, keywords: ['hôtel', 'devise', 'fuseau'], onSelect: () => go('/settings/hotel') },
    { id: 'p-sub', label: 'Abonnement', group: 'Paramètres', icon: <CreditCard />, keywords: ['formule', 'essai', 'plan'], onSelect: () => go('/settings/subscription') },
    { id: 'p-inv', label: 'Factures et paiements', group: 'Paramètres', icon: <CreditCard />, keywords: ['payer', 'mvola', 'virement'], onSelect: () => go('/settings/invoices') },
    { id: 'p-sup', label: 'Assistance', group: 'Paramètres', icon: <LifeBuoy />, keywords: ['aide', 'ticket', 'contact'], onSelect: () => go('/settings/support') },
    { id: 'p-acc', label: 'Mon compte', group: 'Paramètres', icon: <UserRound />, keywords: ['mot de passe', 'thème'], onSelect: () => go('/settings/account') },
    { id: 't-light', label: 'Thème clair', group: 'Affichage', icon: <Sun />, onSelect: () => setPreference('light') },
    { id: 't-dark', label: 'Thème sombre', group: 'Affichage', icon: <Moon />, onSelect: () => setPreference('dark') },
    { id: 't-system', label: 'Thème automatique', group: 'Affichage', icon: <Monitor />, onSelect: () => setPreference('system') },
    { id: 'logout', label: 'Se déconnecter', group: 'Compte', icon: <LogOut />, onSelect: signOut },
  ];

  return (
    <PageBackdrop>
      <a
        href="#main"
        className="sr-only-focusable fixed top-3 left-3 z-50 rounded-control bg-[var(--glass-data)] px-4 py-2 text-[14px] font-medium text-ink shadow-[var(--shadow-2)]"
      >
        Aller au contenu
      </a>
      <div className="mx-auto flex w-full max-w-[1680px] gap-4 p-3 lg:p-4">
        <div className="sticky top-4 hidden h-[calc(100dvh-2rem)] shrink-0 lg:block">
          <Sidebar active={activeId} onNavigate={(id) => go(`/${id}`)} collapsed={collapsed} onToggle={toggleCollapsed} soon={SOON} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="sticky top-3 z-20 lg:top-4">
            <Topbar
              title={title}
              online={online}
              onOpenPalette={() => setPaletteOpen(true)}
              notifications={notifications}
              account={accountItems}
              initials={initials(me.user.fullName)}
            />
          </div>
          <LocaleSync />
          <AccessBanner />
          <PasswordBanner />
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-col gap-4 pb-28 outline-none lg:pb-6">
            <Outlet />
          </main>
        </div>
      </div>
      <TabBar active={activeId} onNavigate={(id) => go(`/${id}`)} soon={SOON} className="lg:hidden" />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} entries={entries} />
    </PageBackdrop>
  );
}

export { MeProvider };
