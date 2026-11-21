import { formatMoney } from '@hmp/shared';
import { CreditCard, LifeBuoy, Play } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useRunLifecycle, useStats, type Stats } from '../../api/platform';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { Skeleton } from '../../ui/data';
import { PageHeader, Panel } from '../../ui/page';
import { fmt, SegmentedBar, StatTile } from '../../ui/stats';
import { Amounts } from './parts';

const HOTEL_STATUS: Record<string, string> = { onboarding: 'En configuration', active: 'Actifs', suspended: 'Suspendus', closed: 'Fermés' };
const SUB_STATUS: Record<string, string> = { trialing: 'En essai', active: 'Actifs', past_due: 'En retard', expired: 'Expirés', cancelled: 'Résiliés' };
const PRIORITY: Record<string, string> = { urgent: 'Urgentes', high: 'Hautes', normal: 'Normales', low: 'Basses' };

function Counts({ data, labels }: { data: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.keys(labels).filter((k) => (data[k] ?? 0) > 0);
  if (entries.length === 0) return <p className="text-[14px] text-ink-2">Aucun pour le moment.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((k) => (
        <li key={k} className="flex items-baseline justify-between gap-3 text-[14px]">
          <span className="text-ink-2">{labels[k]}</span>
          <span className="num-col font-medium text-ink">{fmt.int.format(data[k]!)}</span>
        </li>
      ))}
    </ul>
  );
}

function Content({ s }: { s: Stats }) {
  const awaiting = s.paymentsAwaitingValidation;
  const awaitingCount = awaiting.reduce((n, p) => n + p.payments, 0);
  const ticketCount = Object.values(s.openTickets).reduce((n, v) => n + v, 0);
  const totalHotels = Object.values(s.hotels).reduce((n, v) => n + v, 0);
  const mrr = s.recurringRevenue;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* File de travail : ce qui attend une action humaine, en premier */}
      <section aria-labelledby="queue-h" className="surface glass-1 flex flex-col justify-between gap-5 p-6 lg:col-span-5 [--surface-radius:var(--r-card)]">
        <div className="flex flex-col gap-1">
          <h2 id="queue-h" className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
            <CreditCard aria-hidden className="size-[18px] text-ink-2" />
            Paiements à valider
          </h2>
          <p className="num-display text-[44px] leading-none font-semibold text-ink">{fmt.int.format(awaitingCount)}</p>
          <div className="mt-1 text-[14px] text-ink-2">{awaitingCount === 0 ? 'Rien en attente de vérification.' : <Amounts rows={awaiting.map((a) => ({ currency: a.currency, amount: a.amount }))} />}</div>
        </div>
        <Link to="/platform/payments?status=awaiting_validation" className={buttonVariants({ variant: awaitingCount > 0 ? 'primary' : 'secondary' })}>
          {awaitingCount > 0 ? 'Vérifier les paiements' : 'Voir les paiements'}
        </Link>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
        {mrr.length === 0 ? (
          <StatTile className="sm:col-span-2" label="Revenu mensuel récurrent (MRR)" value="0" />
        ) : (
          mrr.map((m) => (
            <StatTile key={m.currency} label={`MRR en ${m.currency}`} value={formatMoney(m.mrr, m.currency)} />
          ))
        )}
        <div className="surface glass-1 flex flex-col gap-1.5 p-5 [--surface-radius:var(--r-card)]">
          <span className="text-[14px] text-ink-2">Encaissé ce mois</span>
          <div className="num-display text-[22px] leading-tight font-semibold text-ink">
            <Amounts rows={s.collectedThisMonth} empty="Rien d'encaissé" />
          </div>
        </div>
        <StatTile label="Essais se terminant sous 7 jours" value={fmt.int.format(s.trials.endingIn7Days)} />
      </div>

      <Panel title="Établissements" className="lg:col-span-4">
        <p className="num-display text-[34px] leading-none font-semibold text-ink">{fmt.int.format(totalHotels)}</p>
        <Counts data={s.hotels} labels={HOTEL_STATUS} />
        <p className="text-[13px] text-ink-2">{fmt.int.format(s.newHotelsLast30Days)} inscrit{s.newHotelsLast30Days > 1 ? 's' : ''} ces 30 derniers jours.</p>
      </Panel>

      <Panel title="Abonnements" className="lg:col-span-4">
        <Counts data={s.subscriptions} labels={SUB_STATUS} />
        <p className="text-[13px] text-ink-2">
          Résiliations sur 30 jours : {s.churnLast30Days.cancelled} · expirations : {s.churnLast30Days.expired}.
        </p>
      </Panel>

      <Panel title="Conversion des essais (30 jours)" className="lg:col-span-4">
        <div className="flex flex-col gap-1">
          <p className="num-display text-[34px] leading-none font-semibold text-ink">{s.trials.conversionRate === null ? '—' : `${fmt.pct1.format(s.trials.conversionRate)} %`}</p>
          <p className="text-[13px] text-ink-2">
            {s.trials.convertedLast30Days} activation{s.trials.convertedLast30Days > 1 ? 's' : ''} pour {s.trials.startedLast30Days} essai{s.trials.startedLast30Days > 1 ? 's' : ''} démarré{s.trials.startedLast30Days > 1 ? 's' : ''}.
          </p>
        </div>
        {totalHotels > 0 && s.trials.startedLast30Days > 0 && (
          <SegmentedBar
            label="Essais convertis"
            parts={[
              { label: 'Convertis', value: s.trials.convertedLast30Days, color: 'var(--series-1)' },
              { label: 'Pas encore', value: Math.max(s.trials.startedLast30Days - s.trials.convertedLast30Days, 0), color: 'var(--series-3)' },
            ]}
          />
        )}
      </Panel>

      <Panel title="Factures impayées" className="lg:col-span-6">
        {s.unpaidInvoices.length === 0 ? (
          <p className="text-[14px] text-ink-2">Aucune facture en attente de règlement.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {s.unpaidInvoices.map((u) => (
              <li key={u.currency} className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="num-display text-[24px] font-semibold text-ink">{formatMoney(u.due, u.currency)}</span>
                <span className="text-[14px] text-ink-2">
                  {u.invoices} facture{u.invoices > 1 ? 's' : ''}
                  {u.overdue > 0 && <span className="font-medium text-danger-ink"> dont {u.overdue} en retard</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/platform/invoices?paymentStatus=unpaid" className={buttonVariants({ variant: 'secondary', className: 'self-start' })}>Voir les factures</Link>
      </Panel>

      <Panel title="Assistance ouverte" className="lg:col-span-6">
        <p className="flex items-baseline gap-3">
          <span className="num-display text-[34px] leading-none font-semibold text-ink">{fmt.int.format(ticketCount)}</span>
          <LifeBuoy aria-hidden className="size-4 text-ink-3" />
        </p>
        <Counts data={s.openTickets} labels={PRIORITY} />
        <Link to="/platform/support" className={buttonVariants({ variant: 'secondary', className: 'self-start' })}>Ouvrir l&apos;assistance</Link>
      </Panel>

      <p className="text-[13px] leading-snug text-ink-2 lg:col-span-12">{s.note}</p>
    </div>
  );
}

export default function PlatformDashboard() {
  useDocumentTitle('Tableau de bord — Console');
  const stats = useStats();
  const run = useRunLifecycle();

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="L'état commercial de la plateforme, en direct. Les montants sont par devise, sans conversion."
        actions={
          <Button
            variant="secondary"
            loading={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (r) =>
                  toast.success(
                    `Cycle de vie exécuté : ${r.trialsExpired} essai(s) expiré(s), ${r.pastDue} impayé(s), ${r.expired} expiration(s), ${r.cancelledAtPeriodEnd} résiliation(s), ${r.renewalInvoices} facture(s) de renouvellement.`,
                  ),
                onError: (e) => toast.error(isApiError(e) ? e.message : "L'exécution a échoué."),
              })
            }
          >
            <Play aria-hidden className="size-4" />
            Exécuter le cycle de vie
          </Button>
        }
      />
      {stats.isPending ? (
        <div className="grid gap-4 lg:grid-cols-12" role="status">
          <Skeleton className="h-52 rounded-[22px] lg:col-span-5" />
          <Skeleton className="h-52 rounded-[22px] lg:col-span-7" />
          <span className="sr-only">Chargement</span>
        </div>
      ) : stats.isError ? (
        <Panel><p className="text-[14px] text-ink-2">Impossible de charger les statistiques. Rechargez la page.</p></Panel>
      ) : (
        <Content s={stats.data} />
      )}
    </>
  );
}
