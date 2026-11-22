import { Link, NavLink, Outlet } from 'react-router';
import { isApiError } from '../../api/client';
import { useRestaurantSummary } from '../../api/restaurant';
import { cn } from '../../lib/cn';
import { EmptyState } from '../../ui/data';
import { PageHeader } from '../../ui/page';

export default function RestaurantLayout() {
  const probe = useRestaurantSummary();
  if (probe.isError && isApiError(probe.error) && probe.error.code === 'feature_not_in_plan') {
    return (
      <>
        <PageHeader title="Restaurant" description="La carte, les tables et les commandes." />
        <EmptyState kind="key" title="Non inclus dans votre formule" description="Le restaurant fait partie des formules Business et supérieures." action={<Link to="/settings/subscription" className="text-accent-ink underline">Voir les formules</Link>} />
      </>
    );
  }
  if (probe.isError && isApiError(probe.error) && probe.error.code === 'forbidden') {
    return <EmptyState kind="key" title="Accès réservé" description="Votre rôle ne donne pas accès au restaurant. Demandez-le au propriétaire de l'établissement." />;
  }
  const tabs = [{ to: '.', label: 'Commandes', end: true }, { to: 'menu', label: 'Carte' }, { to: 'tables', label: 'Tables' }];
  return (
    <>
      <PageHeader title="Restaurant" description="Prenez les commandes, encaissez à table ou imputez l'addition à la chambre d'un client en séjour : elle sera facturée avec son séjour." />
      <nav aria-label="Sections du restaurant" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex w-max gap-1 rounded-[14px] bg-silver-soft p-1">
          {tabs.map((t) => (
            <li key={t.to}><NavLink to={t.to} end={t.end} className={({ isActive }) => cn('inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors', isActive ? 'bg-[var(--glass-data)] text-ink shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:text-ink')}>{t.label}</NavLink></li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
