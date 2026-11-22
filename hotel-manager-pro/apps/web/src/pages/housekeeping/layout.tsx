import { Link, NavLink, Outlet } from 'react-router';
import { isApiError } from '../../api/client';
import { useHkBoard } from '../../api/housekeeping';
import { cn } from '../../lib/cn';
import { EmptyState } from '../../ui/data';
import { PageHeader } from '../../ui/page';

export default function HousekeepingLayout() {
  const probe = useHkBoard(false);
  if (probe.isError && isApiError(probe.error) && probe.error.code === 'feature_not_in_plan') {
    return (
      <>
        <PageHeader title="Housekeeping" description="Le ménage et la maintenance des chambres." />
        <EmptyState kind="key" title="Non inclus dans votre formule" description="Le housekeeping fait partie des formules Business et supérieures. Sans lui, une chambre quittée est directement disponible à la vente." action={<Link to="/settings/subscription" className="text-accent-ink underline">Voir les formules</Link>} />
      </>
    );
  }
  const tabs = [{ to: '.', label: 'Chambres', end: true }, { to: 'tasks', label: 'Tâches' }, { to: 'maintenance', label: 'Maintenance' }];
  return (
    <>
      <PageHeader title="Housekeeping" description="Quelles chambres sont prêtes, lesquelles attendent le ménage, et qui s'en occupe. Un départ crée la tâche tout seul ; terminer la tâche rend la chambre disponible." />
      <nav aria-label="Sections du housekeeping" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex w-max gap-1 rounded-[14px] bg-silver-soft p-1">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end} className={({ isActive }) => cn('inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors', isActive ? 'bg-[var(--glass-data)] text-ink shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:text-ink')}>{t.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
