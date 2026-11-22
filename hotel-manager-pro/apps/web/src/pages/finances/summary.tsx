import { formatMoney } from '@hmp/shared';
import { useSearchParams } from 'react-router';
import { useFinanceSummary } from '../../api/finances';
import { formatDay } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { EmptyState, Skeleton } from '../../ui/data';
import { Field, Input } from '../../ui/form';
import { Callout, Panel } from '../../ui/page';
import { BarList } from '../../ui/stats';

export default function FinanceSummaryPage() {
  useDocumentTitle('Finances');
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const sum = useFinanceSummary({ from, to });
  const s = sum.data;
  const set = (k: 'from' | 'to', v: string) => { const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); setParams(next, { replace: true }); };
  const money = (n: number) => formatMoney(n, s?.currency ?? 'MGA');
  return (
    <>
      <Panel>
        <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[14rem_14rem_1fr]">
          <Field label="Du">{(c) => <Input {...c} type="date" value={from ?? s?.from ?? ''} onChange={(e) => set('from', e.target.value)} />}</Field>
          <Field label="Au">{(c) => <Input {...c} type="date" value={to ?? s?.to ?? ''} onChange={(e) => set('to', e.target.value)} />}</Field>
          <p className="text-[13px] text-ink-2">Par défaut : le mois en cours.</p>
        </div>
        {sum.isError ? <Callout tone="danger">Impossible de charger la synthèse (la période est limitée à 400 jours).</Callout> : !s ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Chargement"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={`Synthèse du ${formatDay(s.from)} au ${formatDay(s.to)}`}>
              {[
                ['Encaissé (net)', money(s.collected.net), s.collected.refunded > 0 ? `après ${money(s.collected.refunded)} remboursés` : 'espèces, Mobile Money, carte, virement'],
                ['Dépenses payées', money(s.expenses.paid), `${money(s.expenses.total)} saisies sur la période`],
                ['Résultat de trésorerie', money(s.cashResult), s.cashResult < 0 ? 'les sorties dépassent les entrées' : 'encaissé − dépenses payées'],
                ['Reste à encaisser', money(s.receivables.total), `${s.receivables.folios} note${s.receivables.folios > 1 ? 's' : ''} ouverte${s.receivables.folios > 1 ? 's' : ''}`],
              ].map(([label, value, sub]) => (
                <div key={label} className="surface glass-1 flex flex-col gap-1 p-5 [--surface-radius:var(--r-card)]"><dt className="text-[13px] text-ink-2">{label}</dt><dd className="num-display text-[24px] font-semibold text-ink">{value}</dd><span className="text-[12.5px] text-ink-3">{sub}</span></div>
              ))}
            </dl>
            {s.payables.count > 0 && <Callout tone="warning">{s.payables.count} dépense{s.payables.count > 1 ? 's' : ''} à payer, pour {money(s.payables.total)} au total.</Callout>}
            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-labelledby="by-method" className="flex flex-col gap-4">
                <h2 id="by-method" className="text-[16px] font-semibold text-ink">Encaissements par moyen</h2>
                {s.collected.byMethod.length === 0 ? <EmptyState kind="search" title="Aucun encaissement" description="Rien n'a été encaissé sur cette période." /> : <BarList rows={s.collected.byMethod.map((m) => ({ label: m.label ?? m.code, value: Math.max(m.collected - m.refunded, 0) }))} format={money} />}
              </section>
              <section aria-labelledby="by-cat" className="flex flex-col gap-4">
                <h2 id="by-cat" className="text-[16px] font-semibold text-ink">Dépenses par catégorie</h2>
                {s.expenses.byCategory.length === 0 ? <EmptyState kind="search" title="Aucune dépense" description="Aucune dépense saisie sur cette période." /> : <BarList rows={s.expenses.byCategory.map((c) => ({ label: c.name, value: c.total }))} format={money} />}
              </section>
            </div>
            <details className="text-[14px]">
              <summary className="min-h-9 cursor-pointer text-accent-ink">Détail jour par jour</summary>
              <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Détail quotidien">
                <table className="w-full min-w-[28rem] text-[14px]"><caption className="sr-only">Encaissé et dépensé chaque jour</caption>
                  <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Jour</th><th scope="col" className="py-2 text-right font-medium">Encaissé</th><th scope="col" className="py-2 text-right font-medium">Dépensé</th></tr></thead>
                  <tbody>{s.daily.filter((d) => d.collected || d.spent).map((d) => <tr key={d.day} className="border-b border-hairline"><th scope="row" className="py-2 text-left font-normal">{formatDay(d.day)}</th><td className="num-col py-2 text-right">{money(d.collected)}</td><td className="num-col py-2 text-right">{money(d.spent)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Panel>
    </>
  );
}
