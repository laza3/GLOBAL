import { NavLink, Outlet } from 'react-router';
import { useCan } from '../../auth/session';
import { PageHeader } from '../../ui/page';
import { cn } from '../../lib/cn';

/** Paramètres : une page par sujet, adressable (lien direct, bouton retour du navigateur). */
export default function SettingsLayout() {
  const can = useCan();
  const tabs = [
    { to: 'hotel', label: 'Établissement', show: true },
    { to: 'subscription', label: 'Abonnement', show: can('subscription:read') },
    { to: 'invoices', label: 'Factures et paiements', show: can('subscription:read') },
    { to: 'support', label: 'Assistance', show: true },
    { to: 'account', label: 'Mon compte', show: true },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Paramètres" description="Votre établissement, votre abonnement et votre compte." />
      <nav aria-label="Sections des paramètres" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex w-max gap-1 rounded-[14px] bg-silver-soft p-1">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors',
                    isActive ? 'bg-[var(--glass-data)] text-ink shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:text-ink',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
