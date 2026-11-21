import { formatMoney } from '@hmp/shared';
import { Check, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCancelPlanChange, useHotel, usePlans, useRequestPlanChange, useSubscription, useSubscriptionHistory } from '../../api/hotel';
import type { Interval, Plan, SubscriptionResponse } from '../../api/types';
import { useCan } from '../../auth/session';
import { cn } from '../../lib/cn';
import { daysLabel, daysUntil, formatDate } from '../../lib/format';
import { FEATURE_LABEL, INTERVAL_LABEL, INTERVAL_UNIT, SUBSCRIPTION_EVENT, SUBSCRIPTION_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { DataTable, Skeleton, StateBadge } from '../../ui/data';
import { Field, SegmentedControl, Textarea } from '../../ui/form';
import { ConfirmDialog, Modal } from '../../ui/overlay';
import { Callout, DefinitionList, Panel } from '../../ui/page';

const priceOf = (plan: Plan, interval: Interval, currency: string) => {
  const p = plan.prices.find((x) => x.interval === interval && x.currency === currency);
  return p ? Number(p.amount) : null;
};

/* ------------------------------------------------------------------ État actuel */
function CurrentPanel({ data }: { data: SubscriptionResponse }) {
  const { subscription: s, license } = data;
  if (license) {
    return (
      <Panel title="Votre licence" description="Licence définitive : l'usage n'a pas de date de fin.">
        <DefinitionList
          items={[
            { label: 'Édition', value: license.editionCode },
            { label: 'Clé', value: <span className="num-col">{license.keyPrefix}…</span> },
            { label: 'Maintenance et support', value: license.maintenanceUntil ? `jusqu'au ${formatDate(license.maintenanceUntil, { long: true })}` : 'sans date de fin' },
            { label: 'Hébergement', value: license.hostingIncluded ? 'Inclus' : 'Non inclus' },
            { label: 'Limites', value: `${license.maxRooms ?? 'Chambres illimitées'}${license.maxRooms ? ' chambres' : ''} · ${license.maxUsers ?? 'Utilisateurs illimités'}${license.maxUsers ? ' utilisateurs' : ''}` },
          ]}
        />
        {license.terms && <p className="text-[13px] leading-relaxed text-ink-2">{license.terms}</p>}
      </Panel>
    );
  }
  if (!s) {
    return (
      <Panel title="Votre abonnement">
        <Callout tone="warning">Aucun abonnement n&apos;est en cours. Vos données sont conservées et consultables ; choisissez une formule ci-dessous pour reprendre la saisie.</Callout>
      </Panel>
    );
  }
  const trialing = s.status === 'trialing';
  const end = trialing ? s.trialEndsAt : s.currentPeriodEnd;
  const left = daysUntil(end);
  const st = SUBSCRIPTION_STATUS[s.cancelAtPeriodEnd ? 'cancel_at_period_end' : s.status]!;
  return (
    <Panel
      title={`Formule ${s.planName}`}
      actions={<StateBadge tone={st.tone}>{st.label}</StateBadge>}
      description={trialing ? 'Vous profitez de toutes les fonctions de cette formule pendant l\'essai.' : undefined}
    >
      <DefinitionList
        items={[
          { label: trialing ? "Fin de l'essai" : s.cancelAtPeriodEnd ? 'Fin de l\'abonnement' : 'Prochain renouvellement', value: `${formatDate(end, { long: true })}${left !== null && left >= 0 ? ` (${daysLabel(left)})` : ''}` },
          ...(!trialing
            ? [
                { label: 'Tarif', value: `${formatMoney(s.priceAmount - s.discountAmount, s.currency)} / ${INTERVAL_UNIT[s.billingInterval]}${s.discountAmount > 0 ? ` (remise de ${formatMoney(s.discountAmount, s.currency)} incluse)` : ''}` },
                { label: 'Facturation', value: INTERVAL_LABEL[s.billingInterval] },
              ]
            : []),
          { label: 'Chambres', value: s.maxRooms ?? 'Illimitées' },
          { label: 'Utilisateurs', value: s.maxUsers ?? 'Illimités' },
        ]}
      />
      {s.cancelAtPeriodEnd && <Callout tone="warning">La résiliation est programmée : l&apos;accès continue jusqu&apos;à la date ci-dessus, puis l&apos;application passe en lecture seule.</Callout>}
    </Panel>
  );
}

/* ------------------------------------------------------------------ Demande en cours */
function PendingPanel({ data }: { data: SubscriptionResponse }) {
  const req = data.pendingChangeRequest;
  const cancel = useCancelPlanChange();
  const can = useCan();
  const [confirm, setConfirm] = useState(false);
  if (!req) return null;
  const approved = req.status === 'approved';
  return (
    <Panel title="Demande en cours">
      <p className="text-[14px] leading-relaxed text-ink">
        Passage à la formule <strong>{req.toPlanName}</strong> ({INTERVAL_LABEL[req.toInterval]}), demandé le {formatDate(req.requestedAt, { long: true })}.
      </p>
      {approved ? (
        <Callout>La demande est approuvée : la formule change dès que le paiement de la facture est confirmé par la plateforme.</Callout>
      ) : (
        <Callout>Votre demande est en attente d&apos;une réponse de la plateforme (formule sur devis). Vous serez prévenu dans « Assistance » et par la facture qui sera émise.</Callout>
      )}
      <div className="flex flex-wrap gap-3">
        {approved && (
          <Link to="/settings/invoices" className={buttonVariants({ variant: 'primary' })}>
            <FileText aria-hidden className="size-4" />
            Voir la facture à régler
          </Link>
        )}
        {!approved && can('subscription:manage') && (
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Annuler la demande
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Annuler cette demande ?"
        description="Votre formule actuelle ne change pas. Vous pourrez refaire une demande à tout moment."
        confirmLabel="Annuler la demande"
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(req.id, {
            onSuccess: () => {
              setConfirm(false);
              toast.success('Demande annulée.');
            },
            onError: (e) => {
              setConfirm(false);
              toast.error(isApiError(e) ? e.message : "La demande n'a pas pu être annulée.");
            },
          })
        }
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------ Choix d'une formule */
function PlanCard({ plan, interval, currency, data, onChoose, canManage }: { plan: Plan; interval: Interval; currency: string; data: SubscriptionResponse; onChoose: () => void; canManage: boolean }) {
  const s = data.subscription;
  const price = priceOf(plan, interval, currency);
  const current = s?.status === 'active' && s.planCode === plan.code && s.billingInterval === interval;
  const monthly = priceOf(plan, 'month', currency);
  const yearly = priceOf(plan, 'year', currency);
  const saving = monthly !== null && yearly !== null ? monthly * 12 - yearly : 0;
  const included = Object.entries(FEATURE_LABEL).filter(([k]) => plan.features[k]);
  const pending = !!data.pendingChangeRequest;
  const custom = plan.is_custom_priced;

  let disabledReason: string | null = null;
  if (!canManage) disabledReason = 'Réservé au propriétaire ou à un gestionnaire';
  else if (pending) disabledReason = 'Une demande est déjà en cours';
  else if (!custom && price === null) disabledReason = `Tarif indisponible en ${currency}`;

  return (
    <li className={cn('surface glass-1 flex flex-col gap-5 p-6 [--surface-radius:var(--r-card)]', current && 'ring-2 ring-accent')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{plan.name}</h3>
          <p className="text-[13px] leading-snug text-ink-2">{plan.description}</p>
        </div>
        {current && <StateBadge tone="success">Formule actuelle</StateBadge>}
      </div>
      <div className="flex flex-col gap-0.5">
        {custom ? (
          <p className="num-display text-[26px] leading-none font-semibold text-ink">Sur devis</p>
        ) : price !== null ? (
          <>
            <p className="num-display text-[26px] leading-none font-semibold text-ink">
              {formatMoney(price, currency)}
              <span className="text-[14px] font-normal text-ink-2"> / {INTERVAL_UNIT[interval]}</span>
            </p>
            {interval === 'year' && saving > 0 && <p className="text-[13px] text-[var(--st-inhouse)]">Économie de {formatMoney(saving, currency)} par rapport au paiement mensuel</p>}
          </>
        ) : (
          <p className="text-[14px] text-ink-2">Tarif non disponible en {currency}</p>
        )}
      </div>
      <ul className="flex flex-col gap-2 text-[14px] text-ink">
        <li className="flex gap-2.5"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />{plan.max_rooms ? `Jusqu'à ${plan.max_rooms} chambres` : 'Chambres illimitées'}</li>
        <li className="flex gap-2.5"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />{plan.max_users ? `Jusqu'à ${plan.max_users} utilisateurs` : 'Utilisateurs illimités'}</li>
        {included.map(([k, label]) => (
          <li key={k} className="flex gap-2.5">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2">
        {current ? (
          <Button variant="secondary" disabled>Formule actuelle</Button>
        ) : (
          <Button variant="primary" onClick={onChoose} disabled={!!disabledReason} aria-describedby={disabledReason ? `why-${plan.code}` : undefined}>
            {custom ? 'Demander un devis' : s?.status === 'trialing' ? `Souscrire à ${plan.name}` : `Choisir ${plan.name}`}
          </Button>
        )}
        {disabledReason && <p id={`why-${plan.code}`} className="text-[13px] text-ink-2">{disabledReason}</p>}
      </div>
    </li>
  );
}

function ChangePlanModal({ plan, interval, currency, onClose }: { plan: Plan | null; interval: Interval; currency: string; onClose: () => void }) {
  const navigate = useNavigate();
  const request = useRequestPlanChange();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!plan) return null;
  const custom = plan.is_custom_priced;
  const price = priceOf(plan, interval, currency);

  const confirm = () => {
    setError(null);
    request.mutate(
      { planCode: plan.code, interval, message: message.trim() || undefined },
      {
        onSuccess: (r) => {
          onClose();
          if (r.invoice) {
            toast.success(`Facture ${r.invoice.number} émise. Réglez-la pour activer la formule ${plan.name}.`);
            navigate('/settings/invoices');
          } else {
            toast.success('Demande envoyée. Vous recevrez une réponse de la plateforme.');
          }
        },
        onError: (e) => setError(isApiError(e) ? e.message : "La demande n'a pas pu être envoyée."),
      },
    );
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={custom ? `Demander un devis pour ${plan.name}` : `Passer à la formule ${plan.name}`}
      description={custom ? 'Cette formule est sur mesure : la plateforme vous répondra avec un prix.' : `Facturation ${INTERVAL_LABEL[interval]}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={request.isPending} onClick={confirm}>
            {custom ? 'Envoyer la demande' : 'Confirmer et recevoir la facture'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!custom && price !== null && (
          <p className="num-display text-[28px] leading-none font-semibold text-ink">
            {formatMoney(price, currency)}
            <span className="text-[14px] font-normal text-ink-2"> / {INTERVAL_UNIT[interval]}</span>
          </p>
        )}
        {!custom && <Callout>Une facture est émise tout de suite. <strong>Votre formule change quand le paiement est confirmé</strong> par la plateforme — rien n&apos;est prélevé automatiquement.</Callout>}
        <Field label={custom ? 'Votre besoin' : 'Précisions (facultatif)'} hint={custom ? "Nombre de chambres, d'établissements, contraintes particulières…" : undefined}>
          {(c) => <Textarea {...c} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} />}
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

function PlansPanel({ data }: { data: SubscriptionResponse }) {
  const plans = usePlans();
  const hotel = useHotel();
  const can = useCan();
  const [interval, setIntervalValue] = useState<Interval>(data.subscription?.billingInterval ?? 'month');
  const [chosen, setChosen] = useState<Plan | null>(null);
  const currency = data.subscription?.currency ?? hotel.data?.defaultCurrency ?? 'MGA';
  return (
    <Panel
      title="Choisir une formule"
      description={`Prix en ${currency}. Le paiement se fait par virement ou Mobile Money et est vérifié par la plateforme.`}
      actions={
        <SegmentedControl<Interval>
          label="Périodicité de facturation"
          value={interval}
          onValueChange={setIntervalValue}
          options={[{ value: 'month', label: 'Mensuel' }, { value: 'year', label: 'Annuel' }]}
        />
      }
    >
      {plans.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" role="status">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[22px]" />)}
          <span className="sr-only">Chargement des formules</span>
        </div>
      ) : plans.isError ? (
        <p className="text-[14px] text-ink-2">Impossible de charger les formules pour le moment.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.data.map((p) => (
            <PlanCard key={p.code} plan={p} interval={interval} currency={currency} data={data} canManage={can('subscription:manage')} onChoose={() => setChosen(p)} />
          ))}
        </ul>
      )}
      <ChangePlanModal key={chosen?.code ?? 'none'} plan={chosen} interval={interval} currency={currency} onClose={() => setChosen(null)} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ Historique */
function HistoryPanel() {
  const history = useSubscriptionHistory();
  return (
    <Panel title="Historique">
      <DataTable
        caption="Abonnements successifs"
        loading={history.isPending}
        rows={history.data?.subscriptions ?? []}
        rowKey={(r) => r.id}
        columns={[
          { key: 'plan', header: 'Formule', cell: (r) => <span className="font-medium">{r.planName}</span> },
          { key: 'start', header: 'Début', cell: (r) => formatDate(r.startedAt), sortValue: (r) => r.startedAt },
          { key: 'end', header: 'Fin', cell: (r) => formatDate(r.endedAt ?? r.currentPeriodEnd) },
          { key: 'price', header: 'Tarif', align: 'right', cell: (r) => (r.priceAmount ? `${formatMoney(r.priceAmount, r.currency)} / ${INTERVAL_UNIT[r.billingInterval]}` : '—') },
          { key: 'status', header: 'État', cell: (r) => { const st = SUBSCRIPTION_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }; return <StateBadge tone={st.tone}>{st.label}</StateBadge>; } },
        ]}
        mobileCard={(r) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.planName}</span>{(() => { const st = SUBSCRIPTION_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }; return <StateBadge tone={st.tone}>{st.label}</StateBadge>; })()}</div>
            <span className="text-[13px] text-ink-2">Du {formatDate(r.startedAt)} au {formatDate(r.endedAt ?? r.currentPeriodEnd)}</span>
          </div>
        )}
        empty={<p className="px-6 py-10 text-center text-[14px] text-ink-2">Aucun abonnement pour le moment.</p>}
      />
      {(history.data?.events.length ?? 0) > 0 && (
        <ol className="flex flex-col gap-3 border-l border-hairline pl-5">
          {history.data!.events.slice(0, 12).map((e) => (
            <li key={e.id} className="relative text-[14px]">
              <span aria-hidden className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full bg-champagne ring-4 ring-[var(--canvas)]" />
              <span className="font-medium text-ink">{SUBSCRIPTION_EVENT[e.eventType] ?? e.eventType}</span>
              <span className="text-ink-2"> — {formatDate(e.createdAt, { time: true })}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function SubscriptionPage() {
  useDocumentTitle('Abonnement');
  const sub = useSubscription();
  if (sub.isPending) {
    return (
      <Panel>
        <div className="flex flex-col gap-4" role="status">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <span className="sr-only">Chargement</span>
        </div>
      </Panel>
    );
  }
  if (sub.isError) return <Panel><p className="text-[14px] text-ink-2">Impossible de charger l&apos;abonnement. Rechargez la page.</p></Panel>;
  return (
    <div className="flex flex-col gap-4">
      <CurrentPanel data={sub.data} />
      <PendingPanel data={sub.data} />
      <PlansPanel data={sub.data} />
      <HistoryPanel />
    </div>
  );
}
