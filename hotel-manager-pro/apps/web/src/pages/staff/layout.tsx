import { NavLink, Outlet } from 'react-router';
import { cn } from '../../lib/cn';
import { PageHeader } from '../../ui/page';

export default function StaffLayout() {
  const tabs = [{ to: '.', label: 'Équipe', end: true }, { to: 'roles', label: 'Rôles et permissions' }];
  return (
    <>
      <PageHeader title="Personnel" description="Qui se connecte à votre établissement, avec quel rôle. Chaque changement est tracé et prend effet tout de suite." />
      <nav aria-label="Sections du personnel" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex w-max gap-1 rounded-[14px] bg-silver-soft p-1">
          {tabs.map((t) => <li key={t.to}><NavLink to={t.to} end={t.end} className={({ isActive }) => cn('inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors', isActive ? 'bg-[var(--glass-data)] text-ink shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:text-ink')}>{t.label}</NavLink></li>)}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
