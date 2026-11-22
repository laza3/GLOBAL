import { addDays, formatMoney, todayIn } from '@hmp/shared';
import { Download } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { usePerformance, type Kpis } from '../../api/reports';
import { useHotel } from '../../api/hotel';
import { useCan, useMe } from '../../auth/session';
import { formatDay } from '../../lib/format';
import { SOURCE_LABEL } from '../../lib/reservation-status';
import { CHARGE_KIND } from '../../lib/billing-labels';
import { useDocumentTitle } from '../../lib/use-title';
import { buttonVariants } from '../../ui/button';
import { ChartFigure, TrendChart } from '../../ui/charts';
import { EmptyState, Skeleton } from '../../ui/data';
import { Field, Input, SegmentedControl } from '../../ui/form';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { BarList } from '../../ui/stats';

const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')} %`;

function Delta({ now, before, invert }: { now: number; before: number | undefined; invert?: boolean }) {
  if (before === undefined) return null;
  if (before === 0) return <dd className="text-[12.5px] text-ink-3">Période précédente : aucune donnée</dd>;
  const d = ((now - before) / before) * 100;
  const good = invert ? d <= 0 : d >= 0;
  return <dd className={`text-[12.5px] ${Math.abs(d) < 0.05 ? 'text-ink-3' : good ? 'text-[var(--st-inhouse)]' : 'text-[var(--st-cancelled)]'}`}>{d >= 0 ? '+' : '−'}{Math.abs(d).toFixed(1).replace('.', ',')} % vs période précédente</dd>;
}

export default function ReportsPage() {
  useDocumentTitle('Rapports');
  const can = useCan();
  const me = useMe();
  const tz = useHotel().data?.timezone ?? 'Indian/Antananarivo';
  const [params, setParams] = useSearchParams();
  const today = todayIn(tz);
  const from = params.get('from') ?? addDays(today, -29);
  const to = params.get('to') ?? today;
  const perf = usePerformance({ from, to });
  const p = perf.data;
  const set = (patch: Record<string, string | null>) => { const next = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k)); setParams(next, { replace: true }); };
  const preset = (days: number) => set({ from: addDays(today, -(days - 1)), to: today });
  const money = (n: number) => formatMoney(n, p?.currency ?? 'MGA');
  const exportable = can('reports:export') && me.entitlements.features.exports;

  const trend = (key: 'revenue' | 'roomsSold') => (p ? p.daily.map((d, i) => ({ label: formatDay(d.date), current: d[key], previous: p.previousDaily?.[i]?.[key] ?? 0 })) : []);
  const tiles: Array<[string, string, React.ReactNode]> = p ? [
    ["Taux d'occupation", pct(p.kpis.occupancyRate), <Delta key="o" now={p.kpis.occupancyRate} before={p.previous?.occupancyRate} />],
    ['Prix moyen par nuit (ADR)', money(p.kpis.adr), <Delta key="a" now={p.kpis.adr} before={p.previous?.adr} />],
    ['Revenu par chambre disponible (RevPAR)', money(p.kpis.revpar), <Delta key="r" now={p.kpis.revpar} before={p.previous?.revpar} />],
    ['Revenu des nuits', money(p.kpis.revenue), <Delta key="v" now={p.kpis.revenue} before={p.previous?.revenue} />],
  ] : [];

  return (
    <>
      <PageHeader
        title="Rapports"
        description="Les performances de l'hébergement, calculées sur les nuits réservées avec leur prix figé : un tarif modifié plus tard ne réécrit jamais le passé."
        actions={exportable ? <a href={`/api/v1/reports/performance.csv?from=${from}&to=${to}`} download className={buttonVariants({ variant: 'secondary' })}><Download aria-hidden className="size-4" />Exporter (CSV)</a> : undefined}
      />
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Du">{(c) => <Input {...c} type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />}</Field>
          <Field label="Au">{(c) => <Input {...c} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} />}</Field>
          <SegmentedControl label="Périodes rapides" value={'' as string} onValueChange={(v) => preset(Number(v))} options={[{ value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' }]} />
        </div>

        {perf.isError ? <Callout tone="danger">Impossible de charger les rapports (la période est limitée à 366 jours).</Callout> : !p ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Chargement"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : p.kpis.roomsAvailable === 0 ? (
          <EmptyState kind="calendar" title="Aucune chambre à analyser" description="Créez vos chambres : les rapports se calculent à partir d'elles et de leurs réservations." />
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={`Indicateurs du ${formatDay(p.from)} au ${formatDay(p.to)}`}>
              {tiles.map(([label, value, delta]) => <div key={label} className="surface glass-1 flex flex-col gap-1 p-5 [--surface-radius:var(--r-card)]"><dt className="text-[13px] text-ink-2">{label}</dt><dd className="num-display text-[24px] font-semibold text-ink">{value}</dd>{delta}</div>)}
            </dl>
            <p className="text-[13px] text-ink-2">{p.kpis.roomsSold} nuitée{p.kpis.roomsSold > 1 ? 's' : ''} vendue{p.kpis.roomsSold > 1 ? 's' : ''} sur {p.kpis.roomsAvailable} disponibles (les chambres bloquées pour maintenance ne comptent pas comme disponibles ; les options non confirmées ne sont pas des ventes).</p>

            <div className="grid gap-6 xl:grid-cols-2">
              <ChartFigure title="Revenu des nuits" summary={`Revenu total ${money(p.kpis.revenue)} du ${formatDay(p.from)} au ${formatDay(p.to)}.`} table={{ columns: ['Jour', 'Revenu', 'Période précédente'], rows: trend('revenue').map((d) => [d.label, d.current, d.previous]) }} legend={undefined}>
                <TrendChart data={trend('revenue')} names={['Cette période', 'Précédente']} />
              </ChartFigure>
              <ChartFigure title="Nuitées vendues" summary={`${p.kpis.roomsSold} nuitées vendues.`} table={{ columns: ['Jour', 'Vendues', 'Période précédente'], rows: trend('roomsSold').map((d) => [d.label, d.current, d.previous]) }} legend={undefined}>
                <TrendChart data={trend('roomsSold')} names={['Cette période', 'Précédente']} />
              </ChartFigure>
            </div>
            {!p.advanced && <Callout tone="info">La comparaison avec la période précédente, la ventilation par catégorie et par origine et les meilleurs clients font partie de l'analytique avancée (formule Premium).</Callout>}

            {p.advanced && (
              <div className="grid gap-6 lg:grid-cols-2">
                <section aria-labelledby="by-cat" className="flex flex-col gap-3">
                  <h2 id="by-cat" className="text-[16px] font-semibold text-ink">Par catégorie de chambres</h2>
                  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Performances par catégorie"><table className="w-full min-w-[28rem] text-[14px]"><caption className="sr-only">Occupation, prix moyen et revenu par catégorie</caption>
                    <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Catégorie</th><th scope="col" className="py-2 text-right font-medium">Occupation</th><th scope="col" className="py-2 text-right font-medium">ADR</th><th scope="col" className="py-2 text-right font-medium">Revenu</th></tr></thead>
                    <tbody>{p.byCategory?.map((c) => <tr key={c.id} className="border-b border-hairline"><th scope="row" className="py-2 text-left font-medium text-ink">{c.name}<span className="block text-[12.5px] font-normal text-ink-3">{c.rooms} chambre{c.rooms > 1 ? 's' : ''}</span></th><td className="num-col py-2 text-right">{pct(c.occupancyRate)}</td><td className="num-col py-2 text-right">{money(c.adr)}</td><td className="num-col py-2 text-right">{money(c.revenue)}</td></tr>)}</tbody></table></div>
                </section>
                <section aria-labelledby="by-src" className="flex flex-col gap-3">
                  <h2 id="by-src" className="text-[16px] font-semibold text-ink">Revenu par origine de réservation</h2>
                  {p.bySource && p.bySource.length > 0 ? <BarList rows={p.bySource.map((s) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.revenue }))} format={money} /> : <p className="text-[14px] text-ink-2">Aucune nuit vendue sur la période.</p>}
                </section>
                <section aria-labelledby="top" className="flex flex-col gap-3 lg:col-span-2">
                  <h2 id="top" className="text-[16px] font-semibold text-ink">Meilleurs clients de la période</h2>
                  {p.topGuests && p.topGuests.length > 0 ? (
                    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Meilleurs clients"><table className="w-full min-w-[26rem] text-[14px]"><caption className="sr-only">Les dix clients au plus fort revenu</caption>
                      <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Client</th><th scope="col" className="py-2 text-right font-medium">Séjours</th><th scope="col" className="py-2 text-right font-medium">Nuits</th><th scope="col" className="py-2 text-right font-medium">Revenu</th></tr></thead>
                      <tbody>{p.topGuests.map((g) => <tr key={g.guestId} className="border-b border-hairline"><th scope="row" className="py-2 text-left font-medium text-ink">{g.name}</th><td className="num-col py-2 text-right">{g.stays}</td><td className="num-col py-2 text-right">{g.nights}</td><td className="num-col py-2 text-right">{money(g.revenue)}</td></tr>)}</tbody></table></div>
                  ) : <p className="text-[14px] text-ink-2">Aucun séjour sur la période.</p>}
                </section>
              </div>
            )}

            {p.charges.length > 0 && (
              <section aria-labelledby="charges" className="flex flex-col gap-3">
                <h2 id="charges" className="text-[16px] font-semibold text-ink">Charges portées sur les notes</h2>
                <p className="text-[13px] text-ink-2">Hébergement, restaurant, services… par date de service, hors charges annulées et hors options non confirmées.</p>
                <BarList rows={p.charges.filter((c) => c.amount > 0).map((c) => ({ label: CHARGE_KIND[c.kind] ?? c.kind, value: c.amount }))} format={money} />
              </section>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
