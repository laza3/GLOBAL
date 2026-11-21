import { CURRENCIES, formatMoney } from '@hmp/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useApproveRequest, useChangeRequests, useRejectRequest, useSubscriptionsList, type PlanChangeRequestRow, type SubscriptionRow } from '../../api/platform';
import { formatDate } from '../../lib/format';
import { INTERVAL_LABEL, INTERVAL_UNIT, SUBSCRIPTION_STATUS } from '../../lib/labels';
import { parseMoneyInput } from '../../lib/money-input';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Modal } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { HotelLink, Pager, ReasonModal } from './parts';

const REQUEST_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  pending: { label: 'En attente', tone: 'warning' },
  approved: { label: 'Approuvée', tone: 'info' },
  applied: { label: 'Appliquée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

function ApproveModal({ req, onClose }: { req: PlanChangeRequestRow; onClose: () => void }) {
  const approve = useApproveRequest();
  const [currency, setCurrency] = useState('MGA');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const priceAmount = price.trim() ? parseMoneyInput(price, currency) : undefined;
    const discountAmount = discount.trim() ? parseMoneyInput(discount, currency) : 0;
    if (priceAmount === null || discountAmount === null) return setError('Montant invalide pour cette devise.');
    if (req.isCustomPriced && priceAmount === undefined) return setError('Cette formule est sur devis : saisissez le prix convenu.');
    setError(null);
    setBusy(true);
    try {
      await approve.mutateAsync({ id: req.id, priceAmount, discountAmount, currency, notes: notes.trim() || undefined });
      toast.success('Demande approuvée : la facture a été émise.');
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'approbation a échoué.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Approuver la demande" description={`${req.hotelName} → ${req.toPlanName} (${INTERVAL_LABEL[req.toInterval]}). Une facture sera émise ; la formule change à la confirmation du paiement.`}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Approuver et facturer</Button></>}>
      <div className="flex flex-col gap-5">
        {req.message && <Callout>Message de l&apos;établissement : « {req.message} »</Callout>}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Devise">{(c) => <Select {...c} value={currency} onValueChange={setCurrency} options={Object.entries(CURRENCIES).map(([value, x]) => ({ value, label: x.symbol + ' ' + value }))} />}</Field>
          <Field label={req.isCustomPriced ? 'Prix convenu' : 'Prix (facultatif)'} hint={req.isCustomPriced ? undefined : 'Vide = tarif catalogue'} required={req.isCustomPriced}>{(c) => <Input {...c} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" />}</Field>
          <Field label="Remise (facultatif)">{(c) => <Input {...c} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} autoComplete="off" />}</Field>
        </div>
        <Field label="Note pour l'établissement (facultatif)">{(c) => <Textarea {...c} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />}</Field>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

function Requests() {
  const [status, setStatus] = useState('pending');
  const list = useChangeRequests({ status: status === 'all' ? undefined : status });
  const reject = useRejectRequest();
  const [approving, setApproving] = useState<PlanChangeRequestRow | null>(null);
  const [rejecting, setRejecting] = useState<PlanChangeRequestRow | null>(null);
  return (
    <Panel title="Demandes de changement de formule" description="Les formules sur devis (Enterprise) attendent ici votre prix. Les formules au tarif catalogue sont approuvées automatiquement.">
      <div className="max-w-xs"><Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={setStatus} options={[{ value: 'pending', label: 'En attente' }, { value: 'approved', label: 'Approuvées' }, { value: 'applied', label: 'Appliquées' }, { value: 'rejected', label: 'Refusées' }, { value: 'all', label: 'Toutes' }]} />}</Field></div>
      <DataTable<PlanChangeRequestRow>
        caption="Demandes de changement de formule"
        loading={list.isPending}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        columns={[
          { key: 'h', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
          { key: 'to', header: 'Formule demandée', cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.toPlanName}{r.isCustomPriced ? ' (sur devis)' : ''}</span><span className="text-[13px] text-ink-2">{INTERVAL_LABEL[r.toInterval]}{r.fromPlanCode ? ` · depuis ${r.fromPlanCode}` : ''}</span></span> },
          { key: 'm', header: 'Message', cell: (r) => <span className="line-clamp-2 max-w-xs text-ink-2">{r.message ?? '—'}</span> },
          { key: 'd', header: 'Demandée le', cell: (r) => formatDate(r.requestedAt) },
          { key: 's', header: 'État', cell: (r) => { const s = REQUEST_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }; return <StateBadge tone={s.tone}>{s.label}</StateBadge>; } },
          { key: 'a', header: 'Actions', cell: (r) => r.status === 'pending' ? <span className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setApproving(r)}>Approuver</Button><Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>Refuser</Button></span> : <span className="text-[13px] text-ink-2">{r.decisionNotes ?? ''}</span> },
        ]}
        mobileCard={(r) => (
          <div className="flex flex-col gap-2"><HotelLink id={r.hotelId} name={r.hotelName} /><span className="text-[14px] text-ink">{r.toPlanName} · {INTERVAL_LABEL[r.toInterval]}</span>{r.status === 'pending' && <span className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setApproving(r)}>Approuver</Button><Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>Refuser</Button></span>}</div>
        )}
        empty={<EmptyState title="Aucune demande" description="Rien à traiter pour ce filtre." />}
      />
      {approving && <ApproveModal req={approving} onClose={() => setApproving(null)} />}
      {rejecting && <ReasonModal title="Refuser la demande" label="Réponse à l'établissement" hint="Visible par l'établissement." confirmLabel="Refuser la demande" destructive onSubmit={(notes) => reject.mutateAsync({ id: rejecting.id, notes }).then(() => void toast.success('Demande refusée.'))} onClose={() => setRejecting(null)} />}
    </Panel>
  );
}

export default function SubscriptionsPage() {
  useDocumentTitle('Abonnements — Console');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useSubscriptionsList({ status: status === 'all' ? undefined : status, page, pageSize: 25 });
  const set = (patch: Record<string, string>) => setParams(patch, { replace: true });
  return (
    <>
      <PageHeader title="Abonnements" description="Tous les abonnements, passés et présents. Les prix sont ceux figés à la souscription : changer un tarif n'altère pas les abonnements existants." />
      <Requests />
      <Panel title="Tous les abonnements">
        <div className="max-w-xs"><Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v })} options={[{ value: 'all', label: 'Tous' }, ...Object.entries(SUBSCRIPTION_STATUS).filter(([k]) => k !== 'cancel_at_period_end').map(([value, s]) => ({ value, label: s.label }))]} />}</Field></div>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les abonnements.</p> : (
          <>
            <DataTable<SubscriptionRow>
              caption="Abonnements"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'h', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
                { key: 'p', header: 'Formule', cell: (r) => <span className="font-medium">{r.planName}</span> },
                { key: 's', header: 'État', cell: (r) => { const s = SUBSCRIPTION_STATUS[r.cancelAtPeriodEnd ? 'cancel_at_period_end' : r.status] ?? { label: r.status, tone: 'neutral' as const }; return <StateBadge tone={s.tone}>{s.label}</StateBadge>; } },
                { key: 'start', header: 'Début', cell: (r) => formatDate(r.startedAt) },
                { key: 'end', header: 'Échéance', cell: (r) => formatDate(r.trialEndsAt ?? r.endedAt ?? r.currentPeriodEnd) },
                { key: 'price', header: 'Tarif', align: 'right', cell: (r) => (r.priceAmount ? `${formatMoney(r.priceAmount - r.discountAmount, r.currency)} / ${INTERVAL_UNIT[r.billingInterval]}` : '—') },
              ]}
              mobileCard={(r) => <div className="flex flex-col gap-1.5"><HotelLink id={r.hotelId} name={r.hotelName} /><span className="text-[14px] text-ink">{r.planName} · {SUBSCRIPTION_STATUS[r.status]?.label ?? r.status}</span><span className="text-[13px] text-ink-2">Échéance {formatDate(r.trialEndsAt ?? r.endedAt ?? r.currentPeriodEnd)}</span></div>}
              empty={<EmptyState kind="search" title="Aucun abonnement" description="Aucun abonnement pour ce filtre." />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ status, page: String(p) })} />
          </>
        )}
      </Panel>
    </>
  );
}
