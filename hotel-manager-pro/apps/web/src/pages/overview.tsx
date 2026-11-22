import { formatMoney } from '@hmp/shared';
import { ArrowRight, BedDouble, CalendarCheck, Check, CircleDashed, CreditCard, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../api/client';
import { useCompleteOnboarding, useHotel, useSubscription, useTickets, useUsage } from '../api/hotel';
import { useDashboard } from '../api/reports';
import { useT } from '../i18n';
import type { HotelProfile, SubscriptionResponse } from '../api/types';
import { useCan, useMe } from '../auth/session';
import { daysLabel, daysUntil, formatDate } from '../lib/format';
import { SUBSCRIPTION_STATUS } from '../lib/labels';
import { buttonVariants } from '../ui/button';
import { Button } from '../ui/button';
import { Skeleton, StateBadge } from '../ui/data';
import { ConfirmDialog } from '../ui/overlay';
import { Meter, Ring } from '../ui/stats';
import { cn } from '../lib/cn';

const card = 'surface glass-1 flex flex-col gap-5 p-6 [--surface-radius:var(--r-card)]';

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
      <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-silver-soft text-ink-2 [&_svg]:size-[17px]">
        {icon}
      </span>
      {children}
    </h2>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Configuration initiale : l'état se déduit des données réelles du profil.
 * ------------------------------------------------------------------------------------------- */
function profileComplete(h: HotelProfile) {
  return !!(h.phone && h.address && h.city);
}

function SetupCard({ hotel }: { hotel: HotelProfile }) {
  const can = useCan();
  const complete = useCompleteOnboarding();
  const [confirm, setConfirm] = useState(false);
  const steps = [
    { done: profileComplete(hotel), label: "Coordonnées de l'établissement", hint: 'Adresse, ville et téléphone, repris sur vos factures.', to: '/settings/hotel' },
    { done: false, label: 'Devise et horaires', hint: `Devise de facturation : ${hotel.defaultCurrency}. Elle ne pourra plus être modifiée une fois la configuration terminée.`, to: '/settings/hotel', review: true },
  ];
  return (
    <section aria-labelledby="setup-h" className={cn(card, 'lg:col-span-8')}>
      <div className="flex flex-col gap-1.5">
        <h2 id="setup-h" className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Terminez la configuration de {hotel.name}
        </h2>
        <p className="text-[14px] leading-snug text-ink-2">Deux vérifications, puis votre établissement est prêt.</p>
      </div>
      <ol className="flex flex-col divide-y divide-[var(--hairline)] rounded-[16px] border border-hairline bg-[var(--glass-data)]">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-4 p-4">
            <span
              aria-hidden
              className={cn('grid size-8 shrink-0 place-items-center rounded-full', s.done ? 'bg-[var(--st-inhouse-soft)] text-[var(--st-inhouse)]' : 'bg-silver-soft text-ink-3')}
            >
              {s.done ? <Check className="size-[18px]" strokeWidth={2.5} /> : <CircleDashed className="size-[18px]" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-medium text-ink">
                {s.label}
                <span className="sr-only">{s.done ? ' : fait' : ' : à vérifier'}</span>
              </span>
              <span className="text-[13px] leading-snug text-ink-2">{s.hint}</span>
            </div>
            {can('settings:manage') && (
              <Link to={s.to} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                {s.done ? 'Modifier' : 'Vérifier'}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {can('settings:manage') ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setConfirm(true)}>
            Terminer la configuration
          </Button>
          <span className="text-[13px] text-ink-2">Vous pourrez toujours modifier le reste ensuite.</span>
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">Seul le propriétaire ou un gestionnaire peut terminer la configuration.</p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Terminer la configuration ?"
        description={`La devise de facturation (${hotel.defaultCurrency}) ne pourra plus être modifiée : des factures en dépendront. Vérifiez-la avant de continuer.`}
        confirmLabel="Terminer la configuration"
        destructive={false}
        loading={complete.isPending}
        onConfirm={() =>
          complete.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              toast.success('Configuration terminée. Votre établissement est prêt.');
            },
            onError: (e) => {
              setConfirm(false);
              toast.error(isApiError(e) ? e.message : 'La configuration n\'a pas pu être terminée.');
            },
          })
        }
      />
    </section>
  );
}

function ReadyCard({ hotel, firstName }: { hotel: HotelProfile; firstName: string }) {
  return (
    <section aria-labelledby="ready-h" className={cn(card, 'justify-between lg:col-span-8')}>
      <div className="flex flex-col gap-1.5">
        <h2 id="ready-h" className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Bonjour {firstName}
        </h2>
        <p className="max-w-xl text-[14px] leading-relaxed text-ink-2">
          {hotel.name} est configuré. Voici votre journée, calculée à partir de vos chambres, de vos réservations et de vos notes.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link to="/settings/hotel" className={buttonVariants({ variant: 'secondary' })}>
          Profil de l&apos;établissement
        </Link>
        <Link to="/settings/subscription" className={buttonVariants({ variant: 'secondary' })}>
          Abonnement
        </Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Abonnement : anneau d'essai (jours restants) ou prochaine échéance.
 * ------------------------------------------------------------------------------------------- */
function SubscriptionCard({ data }: { data: SubscriptionResponse }) {
  const { subscription: s, license } = data;
  if (license) {
    return (
      <section aria-labelledby="sub-h" className={cn(card, 'lg:col-span-4')}>
        <CardTitle icon={<CreditCard />}>
          <span id="sub-h">Licence définitive</span>
        </CardTitle>
        <div className="flex flex-col gap-1">
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{license.editionCode}</p>
          <p className="text-[14px] text-ink-2">
            Pas d&apos;échéance d&apos;usage.{' '}
            {license.maintenanceUntil ? `Maintenance jusqu'au ${formatDate(license.maintenanceUntil, { long: true })}.` : 'Maintenance sans date de fin.'}
          </p>
        </div>
      </section>
    );
  }
  if (!s) {
    return (
      <section aria-labelledby="sub-h" className={cn(card, 'lg:col-span-4')}>
        <CardTitle icon={<CreditCard />}>
          <span id="sub-h">Abonnement</span>
        </CardTitle>
        <p className="text-[14px] leading-snug text-ink-2">Aucun abonnement en cours. Vos données sont conservées ; choisissez une formule pour reprendre la saisie.</p>
        <Link to="/settings/subscription" className={buttonVariants({ variant: 'primary' })}>
          Choisir une formule
        </Link>
      </section>
    );
  }
  const trialing = s.status === 'trialing';
  const end = trialing ? s.trialEndsAt : s.currentPeriodEnd;
  const left = daysUntil(end) ?? 0;
  const start = new Date(trialing ? s.startedAt : s.currentPeriodStart).getTime();
  const total = Math.max(1, (new Date(end ?? s.currentPeriodEnd).getTime() - start) / 86_400_000);
  const pctLeft = Math.max(0, Math.min(100, (left / total) * 100));
  const st = SUBSCRIPTION_STATUS[s.cancelAtPeriodEnd ? 'cancel_at_period_end' : s.status]!;
  return (
    <section aria-labelledby="sub-h" className={cn(card, 'lg:col-span-4')}>
      <div className="flex items-start justify-between gap-3">
        <CardTitle icon={<CreditCard />}>
          <span id="sub-h">Abonnement</span>
        </CardTitle>
        <StateBadge tone={st.tone}>{st.label}</StateBadge>
      </div>
      <div className="flex items-center gap-5">
        <Ring value={pctLeft} size={108} label={`${trialing ? 'Essai gratuit' : 'Période en cours'} : ${daysLabel(left)} restant${left > 1 ? 's' : ''}`}>
          <div className="flex flex-col items-center leading-none">
            <span className="num-display text-[28px] font-semibold text-ink">{Math.max(left, 0)}</span>
            <span className="mt-1 text-[12px] text-ink-2">{left > 1 ? 'jours' : 'jour'}</span>
          </div>
        </Ring>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{s.planName}</p>
          <p className="text-[13px] leading-snug text-ink-2">
            {trialing ? `Essai gratuit jusqu'au ${formatDate(s.trialEndsAt, { long: true })}` : `${s.cancelAtPeriodEnd ? 'Se termine' : 'Renouvellement'} le ${formatDate(s.currentPeriodEnd, { long: true })}`}
          </p>
          {!trialing && <p className="num-col text-[13px] text-ink-2">{formatMoney(s.priceAmount - s.discountAmount, s.currency)} / {s.billingInterval === 'month' ? 'mois' : 'an'}</p>}
        </div>
      </div>
      <Link to="/settings/subscription" className={buttonVariants({ variant: trialing ? 'primary' : 'secondary', className: 'mt-auto' })}>
        {trialing ? 'Choisir une formule' : "Gérer l'abonnement"}
      </Link>
    </section>
  );
}

function UsageCard() {
  const usage = useUsage();
  return (
    <section aria-labelledby="usage-h" className={cn(card, 'lg:col-span-4')}>
      <CardTitle icon={<BedDouble />}>
        <span id="usage-h">Utilisation de votre formule</span>
      </CardTitle>
      {usage.isPending ? (
        <div className="flex flex-col gap-4" role="status">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <span className="sr-only">Chargement</span>
        </div>
      ) : usage.isError ? (
        <p className="text-[14px] text-ink-2">Impossible de charger l&apos;utilisation pour le moment.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Meter label="Chambres" value={usage.data.rooms.count} max={usage.data.rooms.max} />
          <Meter label="Utilisateurs" value={usage.data.users.count} max={usage.data.users.max} />
        </div>
      )}
    </section>
  );
}

function BillingCard({ data }: { data: SubscriptionResponse | undefined }) {
  const due = data?.nextInvoiceDue;
  const currency = data?.subscription?.currency ?? 'MGA';
  return (
    <section aria-labelledby="bill-h" className={cn(card, 'lg:col-span-4')}>
      <CardTitle icon={<CreditCard />}>
        <span id="bill-h">Facturation de l&apos;abonnement</span>
      </CardTitle>
      {!data ? (
        <Skeleton className="h-16 w-full" />
      ) : due ? (
        <>
          <div className="flex flex-col gap-1">
            <p className="num-display text-[28px] leading-none font-semibold text-ink">{formatMoney(due.balanceDue, currency)}</p>
            <p className="text-[14px] text-ink-2">
              Facture {due.number} — {due.isOverdue ? <span className="font-medium text-danger-ink">en retard depuis le {formatDate(due.dueAt)}</span> : `à régler avant le ${formatDate(due.dueAt)}`}
            </p>
          </div>
          <Link to="/settings/invoices" className={buttonVariants({ variant: 'primary' })}>
            Régler cette facture
          </Link>
        </>
      ) : (
        <p className="text-[14px] leading-snug text-ink-2">Aucune facture en attente de règlement. Vos factures passées sont dans « Factures et paiements ».</p>
      )}
    </section>
  );
}

function SupportCard() {
  const tickets = useTickets();
  const open = (tickets.data ?? []).filter((t) => t.status !== 'closed' && t.status !== 'resolved');
  const waiting = open.filter((t) => t.status === 'waiting_customer');
  return (
    <section aria-labelledby="sup-h" className={cn(card, 'lg:col-span-4')}>
      <CardTitle icon={<LifeBuoy />}>
        <span id="sup-h">Assistance</span>
      </CardTitle>
      {tickets.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <p className="text-[14px] leading-snug text-ink-2">
          {open.length === 0
            ? 'Aucune demande en cours. Une question, un problème ? Écrivez-nous.'
            : waiting.length > 0
              ? `${waiting.length} demande${waiting.length > 1 ? 's attendent' : ' attend'} votre réponse.`
              : `${open.length} demande${open.length > 1 ? 's' : ''} en cours de traitement.`}
        </p>
      )}
      <Link to="/settings/support" className={buttonVariants({ variant: 'secondary' })}>
        {open.length === 0 ? 'Écrire au support' : 'Voir mes demandes'}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}

/** Indicateurs d'exploitation : tous calculés à partir des chambres, réservations et notes réelles ; un bloc absent = pas de droit de le voir. */
function OperationsCard() {
  const t = useT();
  const dash = useDashboard();
  const d = dash.data;
  const money = (n: number) => formatMoney(n, d?.currency ?? 'MGA');
  return (
    <section aria-labelledby="ops-h" className={cn(card, 'lg:col-span-8')}>
      <CardTitle icon={<CalendarCheck />}>
        <span id="ops-h">{t('dash.today')}</span>
      </CardTitle>
      {dash.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2" role="status"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><span className="sr-only">Chargement</span></div>
      ) : dash.isError || !d ? (
        <p className="text-[14px] text-ink-2">Impossible de charger les indicateurs pour le moment.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {d.rooms && d.rooms.total === 0 && <p className="rounded-[14px] border border-dashed border-field-border p-4 text-[14px] text-ink-2">Aucune chambre pour le moment. <Link to="/rooms" className="text-accent-ink underline">Créez vos chambres</Link> : l&apos;occupation et les arrivées s&apos;afficheront ici.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Indicateurs du jour">
            {d.rooms && d.rooms.total > 0 && <Stat label={t('dash.occupancy')} value={`${(d.rooms.occupancyRate * 100).toFixed(0)} %`} sub={`${d.rooms.occupied} chambre${d.rooms.occupied > 1 ? 's' : ''} occupée${d.rooms.occupied > 1 ? 's' : ''} sur ${d.rooms.total}`} to="/rooms" />}
            {d.stays && <Stat label={t('dash.arrivals')} value={`${d.stays.arrivalsDone}/${d.stays.arrivals}`} sub="enregistrées aujourd'hui" to="/reception" />}
            {d.stays && <Stat label={t('dash.departures')} value={`${d.stays.departuresDone}/${d.stays.departures}`} sub={d.stays.overdue ? `${d.stays.overdue} en retard` : "enregistrés aujourd'hui"} to="/reception?section=departures" tone={d.stays.overdue ? 'warning' : undefined} />}
            {d.stays && <Stat label={t('dash.inhouse')} value={String(d.stays.inHouse)} sub={d.stays.pendingConfirmation ? `${d.stays.pendingConfirmation} réservation${d.stays.pendingConfirmation > 1 ? 's' : ''} à confirmer` : 'clients dans l\'hôtel'} to="/reception?section=inhouse" />}
            {d.money && <Stat label={t('dash.collected')} value={money(d.money.collectedToday)} sub="remboursements déduits" to="/billing/payments" />}
            {d.money && <Stat label={t('dash.receivables')} value={money(d.money.receivables)} sub={`${d.money.receivablesFolios} note${d.money.receivablesFolios > 1 ? 's' : ''} ouverte${d.money.receivablesFolios > 1 ? 's' : ''}`} to="/billing?payment=due" />}
            {d.housekeeping && <Stat label={t('dash.dirty')} value={String(d.housekeeping.dirty)} sub={d.housekeeping.issues ? `${d.housekeeping.issues} panne${d.housekeeping.issues > 1 ? 's' : ''} ouverte${d.housekeeping.issues > 1 ? 's' : ''}` : 'aucune panne ouverte'} to="/housekeeping" tone={d.housekeeping.issues ? 'warning' : undefined} />}
            {d.restaurant && <Stat label={t('dash.restaurant')} value={money(d.restaurant.salesToday)} sub={`${d.restaurant.openOrders} commande${d.restaurant.openOrders > 1 ? 's' : ''} en cours`} to="/restaurant" />}
          </ul>
          {d.stays && d.stays.upcomingArrivals.some((u) => u.n > 0) && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-ink-2">Arrivées des 7 prochains jours</h3>
              <ul className="grid grid-cols-7 gap-1.5" aria-label="Arrivées des 7 prochains jours">
                {d.stays.upcomingArrivals.map((u) => <li key={u.date} className="flex flex-col items-center gap-0.5 rounded-[10px] bg-silver-soft px-1 py-2"><span className="text-[11px] text-ink-3">{formatDate(`${u.date}T12:00:00Z`, { timeZone: 'UTC' }).slice(0, 6)}</span><span className="num-col text-[16px] font-semibold text-ink">{u.n}</span></li>)}
              </ul>
            </div>
          )}
          {d.stays && d.stays.expiringOptions > 0 && <p className="rounded-[14px] bg-[var(--st-pending-soft)] px-4 py-3 text-[14px] text-[var(--st-pending)]">{d.stays.expiringOptions} option{d.stays.expiringOptions > 1 ? 's expirent' : ' expire'} dans les 48 heures : confirmez-les ou laissez-les se libérer. <Link to="/reservations?status=tentative" className="underline">Voir les options</Link></p>}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub, to, tone }: { label: string; value: string; sub: string; to: string; tone?: 'warning' }) {
  return (
    <li>
      <Link to={to} className="flex h-full flex-col gap-0.5 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4 transition-colors hover:bg-accent-soft focus-visible:outline-2">
        <span className="text-[13px] text-ink-2">{label}</span>
        <span className={cn('num-display text-[24px] leading-tight font-semibold', tone === 'warning' ? 'text-[var(--st-pending)]' : 'text-ink')}>{value}</span>
        <span className="text-[12.5px] text-ink-3">{sub}</span>
      </Link>
    </li>
  );
}

export default function OverviewPage() {
  const me = useMe();
  const hotel = useHotel();
  const sub = useSubscription();
  const firstName = me.user.fullName.split(/\s+/)[0] ?? me.user.fullName;

  return (
    <>
      <h1 className="sr-only">Vue d&apos;ensemble de {me.hotel.name}</h1>
      <div className="grid gap-4 lg:grid-cols-12">
        {hotel.isPending ? (
          <div className={cn(card, 'lg:col-span-8')} role="status">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">Chargement</span>
          </div>
        ) : hotel.isError ? (
          <section className={cn(card, 'lg:col-span-8')}>
            <p className="text-[14px] text-ink-2">Impossible de charger le profil de l&apos;établissement. Rechargez la page.</p>
          </section>
        ) : hotel.data.status === 'onboarding' ? (
          <SetupCard hotel={hotel.data} />
        ) : (
          <ReadyCard hotel={hotel.data} firstName={firstName} />
        )}
        {sub.data ? (
          <SubscriptionCard data={sub.data} />
        ) : (
          <div className={cn(card, 'lg:col-span-4')} role="status">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="size-24 rounded-full" />
            <span className="sr-only">Chargement</span>
          </div>
        )}
        <UsageCard />
        <BillingCard data={sub.data} />
        <SupportCard />
        <OperationsCard />
      </div>
    </>
  );
}
