import {
  Bell,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  ConciergeBell,
  Ellipsis,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings,
  Sparkles,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Drawer, Menu, Tip, type MenuItem } from './overlay';

/* ---------------------------------------------------------------------------------------------
 * Navigation de l'application (13 modules)
 * ------------------------------------------------------------------------------------------- */
export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Exploitation',
    items: [
      { id: 'overview', label: "Vue d'ensemble", icon: LayoutDashboard },
      { id: 'reservations', label: 'Réservations', icon: CalendarCheck },
      { id: 'calendar', label: 'Calendrier', icon: CalendarDays },
      { id: 'rooms', label: 'Chambres', icon: BedDouble },
      { id: 'guests', label: 'Clients', icon: Users },
      { id: 'reception', label: 'Réception', icon: ConciergeBell },
      { id: 'housekeeping', label: 'Housekeeping', icon: Sparkles },
      { id: 'restaurant', label: 'Restaurant', icon: UtensilsCrossed },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { id: 'billing', label: 'Facturation', icon: Receipt },
      { id: 'finances', label: 'Finances', icon: Wallet },
      { id: 'staff', label: 'Personnel', icon: UserCog },
      { id: 'reports', label: 'Rapports', icon: ChartColumn },
    ],
  },
  { label: 'Administration', items: [{ id: 'settings', label: 'Paramètres', icon: Settings }] },
];

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);
/**
 * Entrées permanentes de la barre d'onglets mobile ; « Plus » ouvre le reste (5 entrées maximum au total).
 * Trois entrées + « Plus » : avec cinq, « Réservations » ne tient pas sur un téléphone de 360 px.
 */
const TAB_IDS = ['overview', 'reservations', 'reception'];

export function BrandMark({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#0a0f1e] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_12px_-4px_rgba(10,15,30,0.5)]"
      >
        <svg viewBox="0 0 64 64" className="size-6">
          <defs>
            <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ecd3a0" />
              <stop offset="1" stopColor="#5b86ff" />
            </linearGradient>
          </defs>
          <path d="M20 46V18m24 28V18M20 32h24" stroke="url(#brand-g)" strokeWidth="6" strokeLinecap="round" fill="none" />
        </svg>
      </span>
      {!compact && (
        <span className="text-[15px] leading-none font-semibold tracking-[-0.01em] whitespace-nowrap text-ink max-[429px]:sr-only">
          Hotel Manager <span className="text-champagne-ink">Pro</span>
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Barre latérale repliable (bureau). Réduite : icônes + infobulles ; l'état actif reste visible.
 * ------------------------------------------------------------------------------------------- */
export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggle,
  className,
}: {
  active: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        'surface glass-1 flex h-full flex-col gap-1 overflow-y-auto p-3 transition-[width] duration-[var(--d-base)] ease-out [--surface-radius:var(--r-card)]',
        collapsed ? 'w-[4.75rem]' : 'w-64',
        className,
      )}
    >
      <div className={cn('flex h-12 items-center', collapsed ? 'justify-center' : 'px-2')}>
        <BrandMark compact={collapsed} />
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mt-2 flex flex-col gap-0.5">
          {collapsed ? (
            <div aria-hidden className="mx-3 mb-1 h-px bg-hairline" />
          ) : (
            <p className="px-3 pb-1 text-[13px] font-medium text-ink-3">{group.label}</p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === active;
            const button = (
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  'group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[12px] px-3 text-left text-[14px] font-medium transition-colors duration-[var(--d-quick)]',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-glass-hover hover:text-ink',
                )}
              >
                <Icon aria-hidden className="size-[19px] shrink-0" strokeWidth={isActive ? 2.1 : 1.75} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
            return collapsed ? (
              <Tip key={item.id} label={item.label} side="right">
                {button}
              </Tip>
            ) : (
              <div key={item.id}>{button}</div>
            );
          })}
        </div>
      ))}

      <div className="mt-auto pt-3">
        <Tip label={collapsed ? 'Déplier le menu' : 'Replier le menu'} side="right">
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'md'}
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
            className={cn('w-full', !collapsed && 'justify-start gap-3 px-3')}
          >
            {collapsed ? <PanelLeftOpen aria-hidden className="size-[19px]" /> : <PanelLeftClose aria-hidden className="size-[19px]" />}
            {!collapsed && 'Replier le menu'}
          </Button>
        </Tip>
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Barre d'onglets mobile : 5 entrées maximum, « Plus » ouvre une feuille avec les autres modules.
 * ------------------------------------------------------------------------------------------- */
export function TabBar({ active, onNavigate, className }: { active: string; onNavigate: (id: string) => void; className?: string }) {
  const [more, setMore] = useState(false);
  const tabs = TAB_IDS.map((id) => ALL_NAV.find((n) => n.id === id)!);
  const rest = ALL_NAV.filter((n) => !TAB_IDS.includes(n.id));
  const moreActive = rest.some((n) => n.id === active);
  const tabClass = (on: boolean) =>
    cn(
      'flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[18px] px-1 text-[12px] font-medium transition-colors duration-[var(--d-quick)]',
      on ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:text-ink',
    );
  return (
    <>
      <nav
        aria-label="Navigation principale"
        className={cn(
          'surface glass-2 fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-stretch gap-1 p-1.5 [--surface-radius:26px]',
          className,
        )}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => onNavigate(t.id)} aria-current={t.id === active ? 'page' : undefined} className={tabClass(t.id === active)}>
              <Icon aria-hidden className="size-5" strokeWidth={t.id === active ? 2.1 : 1.75} />
              {t.label === "Vue d'ensemble" ? 'Accueil' : t.label}
            </button>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={tabClass(moreActive)}>
          <Ellipsis aria-hidden className="size-5" />
          Plus
        </button>
      </nav>
      <Drawer open={more} onOpenChange={setMore} title="Tous les modules" description="Accédez rapidement à une autre section.">
        <ul className="grid grid-cols-2 gap-2">
          {rest.map((n) => {
            const Icon = n.icon;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMore(false);
                    onNavigate(n.id);
                  }}
                  aria-current={n.id === active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[14px] border border-hairline px-3.5 text-left text-[14px] font-medium text-ink',
                    n.id === active ? 'bg-accent-soft text-accent-ink' : 'bg-[var(--glass-data)] hover:bg-accent-soft',
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0 text-ink-2" />
                  {n.label}
                </button>
              </li>
            );
          })}
        </ul>
      </Drawer>
    </>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Connexion : état RÉEL du navigateur (navigator.onLine + événements). Aucune promesse de synchronisation.
 * ------------------------------------------------------------------------------------------- */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function ConnectionIndicator({ online, className }: { online: boolean; className?: string }) {
  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap',
        online ? 'bg-[var(--st-inhouse-soft)] text-[var(--st-inhouse)]' : 'bg-[var(--st-pending-soft)] text-[var(--st-pending)]',
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {online ? 'En ligne' : 'Hors ligne'}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Barre supérieure : recherche globale (ouvre la palette), notifications, connexion, compte.
 * ------------------------------------------------------------------------------------------- */
export function Topbar({
  title,
  online,
  onOpenPalette,
  notifications,
  account,
  leading,
  className,
}: {
  title: string;
  online: boolean;
  onOpenPalette: () => void;
  notifications: MenuItem[];
  account: MenuItem[];
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('@container surface glass-1 flex min-h-16 items-center gap-3 px-4 [--surface-radius:var(--r-card)]', className)}>
      {leading}
      <h2 className="mr-auto min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden h-10 min-w-56 cursor-pointer items-center gap-2.5 rounded-control border border-hairline bg-[var(--glass-data)] px-3 text-[14px] text-ink-3 transition-colors hover:border-field-border @xl:flex"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 text-left">Rechercher…</span>
        <kbd className="rounded-md border border-hairline px-1.5 py-0.5 text-[12px] text-ink-3">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" aria-label="Rechercher" onClick={onOpenPalette} className="@xl:hidden">
        <Search aria-hidden className="size-[18px]" />
      </Button>
      <ConnectionIndicator online={online} className="hidden @2xl:inline-flex" />
      <Menu
        trigger={
          <Button variant="ghost" size="icon" aria-label="Notifications" className="hidden @sm:inline-flex">
            <Bell aria-hidden className="size-[18px]" />
          </Button>
        }
        items={notifications}
      />
      <Menu
        trigger={
          <button
            type="button"
            aria-label="Menu du compte, AR"
            className="grid size-10 cursor-pointer place-items-center rounded-full bg-champagne-soft text-[13px] font-semibold text-champagne-ink ring-1 ring-[var(--edge-warm)]"
          >
            AR
          </button>
        }
        items={account}
      />
    </header>
  );
}
