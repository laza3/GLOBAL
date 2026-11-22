import { Link, NavLink, Outlet } from 'react-router';
import { isApiError } from '../../api/client';
import { useFinanceSummary } from '../../api/finances';
import { cn } from '../../lib/cn';
import { EmptyState } from '../../ui/data';
import { PageHeader } from '../../ui/page';

export default function FinancesLayout() {
  const probe = useFinanceSummary({});
  if (probe.isError && isApiError(probe.error) && probe.error.code === 'feature_not_in_plan') {
    return (<><PageHeader title="Finances" description="Encaissements, dépenses et résultat." /><EmptyState kind="key" title="Non inclus dans votre formule" description="Les finances font partie des formules Business et supérieures." action={<Link to="/settings/subscription" className="text-accent-ink underline">Voir les formules</Link>} /></>);
  }
  if (probe.isError && isApiError(probe.error) && probe.error.code === 'forbidden') {
    return <EmptyState kind="key" title="Accès réservé" description="Votre rôle ne donne pas accès aux finances. Demandez-le au propriétaire de l'établissement." />;
  }
  const tabs = [{ to: '.', label: 'Synthèse', end: true }, { to: 'expenses', label: 'Dépenses' }];
  return (
    <>
      <PageHeader title="Finances" description="Ce qui est entré, ce qui est sorti, ce qui reste à encaisser ou à payer. Base trésorerie : seuls les encaissements et paiements réels comptent." />
      <nav aria-label="Sections des finances" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex w-max gap-1 rounded-[14px] bg-silver-soft p-1">
          {tabs.map((t) => <li key={t.to}><NavLink to={t.to} end={t.end} className={({ isActive }) => cn('inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors', isActive ? 'bg-[var(--glass-data)] text-ink shadow-[0_1px_3px_rgba(20,35,80,0.14),0_0_0_1px_var(--hairline)]' : 'text-ink-2 hover:text-ink')}>{t.label}</NavLink></li>)}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
