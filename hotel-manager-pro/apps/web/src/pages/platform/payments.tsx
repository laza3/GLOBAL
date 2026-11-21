import { formatMoney } from '@hmp/shared';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useRejectPayment, useValidatePayment, usePlatformPayments, type PaymentRow } from '../../api/platform';
import { formatDate } from '../../lib/format';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Select } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { HotelLink, Pager, ReasonModal } from './parts';

const FILTERS = [
  { value: 'awaiting_validation', label: 'À valider' },
  { value: 'confirmed', label: 'Confirmés' },
  { value: 'rejected', label: 'Rejetés' },
  { value: 'all', label: 'Tous' },
];
const EFFECTS: Record<string, string> = {
  subscription_activated: 'abonnement activé',
  subscription_renewed: 'abonnement renouvelé',
  subscription_reactivated: 'abonnement réactivé',
  plan_changed: 'formule changée',
  license_activated: 'licence activée',
};

export default function PaymentsPage() {
  useDocumentTitle('Paiements — Console');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'awaiting_validation';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = usePlatformPayments({ status: status === 'all' ? undefined : status, page, pageSize: 25 });
  const validate = useValidatePayment();
  const [toValidate, setToValidate] = useState<PaymentRow | null>(null);
  const [toReject, setToReject] = useState<PaymentRow | null>(null);
  const reject = useRejectPayment();
  const set = (next: Record<string, string>) => setParams(next, { replace: true });

  return (
    <>
      <PageHeader
        title="Paiements"
        description="Les paiements déclarés par les établissements. Vérifiez la référence sur votre relevé bancaire ou le SMS Mobile Money AVANT de valider : une validation règle la facture et active la formule."
      />
      <Panel>
        <div className="max-w-xs">
          <Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v })} options={FILTERS} />}</Field>
        </div>
        {list.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les paiements.</p>
        ) : (
          <>
            <DataTable<PaymentRow>
              caption="Paiements des établissements"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'hotel', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
                { key: 'invoice', header: 'Facture', cell: (r) => <span className="num-col">{r.invoiceNumber ?? '—'}</span> },
                { key: 'amount', header: 'Montant', align: 'right', cell: (r) => formatMoney(r.amount, r.currency) },
                { key: 'method', header: 'Moyen', cell: (r) => PAYMENT_METHOD[r.method] ?? r.method },
                { key: 'ref', header: 'Référence / payeur', cell: (r) => <span className="flex flex-col"><span className="num-col font-medium">{r.reference ?? '—'}</span><span className="text-[13px] text-ink-2">{[r.payerName, r.payerPhone].filter(Boolean).join(' · ')}</span></span> },
                { key: 'date', header: 'Déclaré le', cell: (r) => formatDate(r.submittedAt, { time: true }) },
                { key: 'status', header: 'État', cell: (r) => <StateBadge tone={PAYMENT_STATUS[r.status].tone}>{PAYMENT_STATUS[r.status].label}</StateBadge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  cell: (r) =>
                    r.status === 'awaiting_validation' || r.status === 'pending' ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => setToValidate(r)} aria-label={`Valider le paiement de ${r.hotelName}`}><Check aria-hidden className="size-4" />Valider</Button>
                        <Button size="sm" variant="secondary" onClick={() => setToReject(r)} aria-label={`Rejeter le paiement de ${r.hotelName}`}><X aria-hidden className="size-4" />Rejeter</Button>
                      </span>
                    ) : r.rejectionReason ? <span className="text-[13px] text-ink-2">{r.rejectionReason}</span> : null,
                },
              ]}
              mobileCard={(r) => (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3"><HotelLink id={r.hotelId} name={r.hotelName} /><StateBadge tone={PAYMENT_STATUS[r.status].tone}>{PAYMENT_STATUS[r.status].label}</StateBadge></div>
                  <span className="num-col text-[17px] font-semibold text-ink">{formatMoney(r.amount, r.currency)}</span>
                  <span className="text-[13px] text-ink-2">{PAYMENT_METHOD[r.method] ?? r.method} · réf. {r.reference ?? '—'}</span>
                  {(r.status === 'awaiting_validation' || r.status === 'pending') && (
                    <span className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setToValidate(r)}>Valider</Button><Button size="sm" variant="secondary" onClick={() => setToReject(r)}>Rejeter</Button></span>
                  )}
                </div>
              )}
              empty={<EmptyState kind="key" title={status === 'awaiting_validation' ? 'Aucun paiement à valider' : 'Aucun paiement'} description="Les paiements déclarés par les établissements apparaîtront ici." />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ status, page: String(p) })} />
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={!!toValidate}
        onOpenChange={(o) => !o && setToValidate(null)}
        title="Valider ce paiement ?"
        description={toValidate ? `${formatMoney(toValidate.amount, toValidate.currency)} de ${toValidate.hotelName}, référence « ${toValidate.reference ?? 'aucune'} ». Confirmez que vous l'avez bien reçu : la facture sera réglée et ses effets appliqués.` : ''}
        confirmLabel="Valider le paiement"
        destructive={false}
        loading={validate.isPending}
        onConfirm={() =>
          toValidate &&
          validate.mutate(toValidate.id, {
            onSuccess: (r) => {
              setToValidate(null);
              toast.success(r.effects.length ? `Paiement validé : ${r.effects.map((e) => EFFECTS[e] ?? e).join(', ')}.` : 'Paiement validé.');
            },
            onError: (e) => {
              setToValidate(null);
              toast.error(isApiError(e) ? e.message : 'La validation a échoué.');
            },
          })
        }
      />
      {toReject && (
        <ReasonModal
          title="Rejeter ce paiement"
          description={`${formatMoney(toReject.amount, toReject.currency)} de ${toReject.hotelName}.`}
          label="Motif du rejet"
          hint="Visible par l'établissement : référence introuvable, montant incorrect…"
          confirmLabel="Rejeter le paiement"
          destructive
          extra={<Callout tone="warning">L&apos;établissement verra ce motif et pourra déclarer un nouveau paiement.</Callout>}
          onSubmit={(reason) => reject.mutateAsync({ id: toReject.id, reason }).then(() => toast.success('Paiement rejeté.'))}
          onClose={() => setToReject(null)}
        />
      )}
    </>
  );
}
