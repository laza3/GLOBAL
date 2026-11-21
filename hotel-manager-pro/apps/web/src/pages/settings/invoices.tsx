import { formatMoney, toMinorUnits } from '@hmp/shared';
import { CircleHelp } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useDeclarePayment, useInvoice, useInvoices, usePaymentMethods } from '../../api/hotel';
import type { InvoiceDetail, InvoiceSummary } from '../../api/types';
import { useCan } from '../../auth/session';
import { feedbackFrom, type FormFeedback } from '../../lib/forms';
import { formatDate } from '../../lib/format';
import { INVOICE_KIND, INVOICE_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { Drawer, Modal } from '../../ui/overlay';
import { Callout, DefinitionList, Panel } from '../../ui/page';

const statusBadge = (i: Pick<InvoiceSummary, 'paymentStatus' | 'isOverdue'>) => {
  const st = INVOICE_STATUS[i.paymentStatus];
  return i.isOverdue && i.paymentStatus !== 'paid' && i.paymentStatus !== 'void' ? <StateBadge tone="danger">En retard</StateBadge> : <StateBadge tone={st.tone}>{st.label}</StateBadge>;
};

/* ------------------------------------------------------------------ Déclarer un paiement */
function DeclarePaymentModal({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const methods = usePaymentMethods();
  const declare = useDeclarePayment();
  // Une clé par ouverture : un double-clic ou une nouvelle tentative réseau ne crée jamais deux paiements
  const key = useRef(crypto.randomUUID());
  const amountId = useId();
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState(String(invoice.balanceDue / 10 ** (invoice.currency === 'MGA' ? 0 : 2)));
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });
  const list = methods.data?.methods.filter((m) => m.mode === 'manual') ?? [];
  const chosen = list.find((m) => m.code === method);
  const needsReference = chosen && !['cash', 'other'].includes(chosen.code);

  const submit = () => {
    const fields: Record<string, string> = {};
    if (!chosen) fields.method = 'Choisissez le moyen de paiement utilisé.';
    if (needsReference && reference.trim().length < 3) fields.reference = 'Saisissez la référence de la transaction (au moins 3 caractères).';
    const value = Number(amount.replace(',', '.'));
    const minor = toMinorUnits(value, invoice.currency);
    if (!Number.isFinite(value) || minor <= 0) fields.amount = 'Saisissez un montant supérieur à zéro.';
    else if (minor > invoice.balanceDue) fields.amount = `Le montant dépasse le reste à payer (${formatMoney(invoice.balanceDue, invoice.currency)}).`;
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    declare.mutate(
      { invoiceId: invoice.id, method, reference: reference.trim() || undefined, payerName: payer.trim() || undefined, amount: minor === invoice.balanceDue ? undefined : minor, idempotencyKey: key.current },
      {
        onSuccess: () => {
          toast.success('Paiement enregistré. Il sera pris en compte dès sa vérification par la plateforme.');
          onClose();
        },
        onError: (e) => setFeedback(feedbackFrom(e, { reference_required: 'reference', payment_exceeds_due: 'amount', payment_method_unavailable: 'method', provider_not_connected: 'method' })),
      },
    );
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Déclarer un paiement"
      description={`Facture ${invoice.number} — reste à payer ${formatMoney(invoice.balanceDue, invoice.currency)}`}
      width="34rem"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={declare.isPending} onClick={submit} disabled={list.length === 0}>Enregistrer le paiement</Button>
        </>
      }
    >
      {methods.isPending ? (
        <div role="status" className="flex flex-col gap-3"><Skeleton className="h-10 w-full" /><span className="sr-only">Chargement</span></div>
      ) : list.length === 0 ? (
        <Callout tone="warning">Aucun moyen de paiement n&apos;est ouvert pour le moment. Écrivez-nous depuis « Assistance » : nous vous indiquerons comment régler.</Callout>
      ) : (
        <div className="flex flex-col gap-5">
          {feedback.general && <Callout tone="danger">{feedback.general}</Callout>}
          <Callout>Effectuez d&apos;abord le paiement, puis déclarez-le ici. {methods.data?.notice}</Callout>
          <Field label="Moyen de paiement utilisé" error={feedback.fields.method} required>
            {(c) => <Select {...c} value={method} onValueChange={setMethod} placeholder="Choisir…" options={list.map((m) => ({ value: m.code, label: PAYMENT_METHOD[m.code] ?? m.name }))} />}
          </Field>
          {chosen?.instructions && (
            <div className="rounded-[14px] border border-hairline bg-[var(--glass-data)] p-4 text-[14px] leading-relaxed text-ink">
              <p className="mb-1 text-[13px] font-medium text-ink-2">Comment payer avec {PAYMENT_METHOD[chosen.code] ?? chosen.name}</p>
              <p className="whitespace-pre-line">{chosen.instructions}</p>
            </div>
          )}
          <Field label={needsReference ? 'Référence de la transaction' : 'Référence (facultatif)'} hint="Numéro de virement, code reçu par SMS Mobile Money…" error={feedback.fields.reference} required={!!needsReference}>
            {(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Montant payé" hint="Vous pouvez déclarer un paiement partiel." error={feedback.fields.amount} required>
              {(c) => <Input {...c} id={amountId} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Nom du payeur (facultatif)">{(c) => <Input {...c} value={payer} onChange={(e) => setPayer(e.target.value)} autoComplete="off" />}</Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Détail d'une facture */
function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const invoice = useInvoice(id);
  const can = useCan();
  const [declaring, setDeclaring] = useState(false);
  const d = invoice.data;
  const awaiting = d?.payments.filter((p) => p.status === 'awaiting_validation') ?? [];
  const payable = d && d.status === 'issued' && d.balanceDue > 0;

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={d?.number ? `Facture ${d.number}` : 'Facture'} description={d ? INVOICE_KIND[d.kind] : undefined}>
      {invoice.isPending ? (
        <div role="status" className="flex flex-col gap-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-32 w-full" /><span className="sr-only">Chargement</span></div>
      ) : invoice.isError || !d ? (
        <p className="text-[14px] text-ink-2">Impossible de charger cette facture.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-2">Reste à payer</span>
              <span className="num-display text-[30px] leading-none font-semibold text-ink">{formatMoney(d.balanceDue, d.currency)}</span>
            </div>
            {statusBadge(d)}
          </div>
          <DefinitionList
            items={[
              { label: 'Émise le', value: formatDate(d.issuedAt, { long: true }) },
              { label: 'Échéance', value: formatDate(d.dueAt, { long: true }) },
              ...(d.periodStart && d.periodEnd ? [{ label: 'Période', value: `${formatDate(d.periodStart)} → ${formatDate(d.periodEnd)}` }] : []),
              { label: 'Déjà réglé', value: formatMoney(d.amountPaid, d.currency) },
            ]}
          />
          <table className="w-full text-[14px]">
            <caption className="sr-only">Lignes de la facture</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Désignation</th><th scope="col" className="py-2 text-right font-medium">Montant</th></tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i} className="border-b border-hairline"><td className="py-2.5 pr-3">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</td><td className="num-col py-2.5 text-right">{formatMoney(l.amount, d.currency)}</td></tr>
              ))}
            </tbody>
            <tfoot className="text-ink-2">
              {d.taxAmount > 0 && <tr><th scope="row" className="py-2 text-left font-normal">Taxes</th><td className="num-col py-2 text-right">{formatMoney(d.taxAmount, d.currency)}</td></tr>}
              <tr className="text-ink"><th scope="row" className="py-2 text-left font-semibold">Total</th><td className="num-col py-2 text-right font-semibold">{formatMoney(d.totalAmount, d.currency)}</td></tr>
            </tfoot>
          </table>

          <section aria-labelledby="pay-h" className="flex flex-col gap-3">
            <h3 id="pay-h" className="text-[15px] font-semibold text-ink">Paiements</h3>
            {d.payments.length === 0 ? (
              <p className="text-[14px] text-ink-2">Aucun paiement déclaré pour cette facture.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.payments.map((p) => {
                  const st = PAYMENT_STATUS[p.status];
                  return (
                    <li key={p.id} className="flex flex-col gap-1.5 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="num-col text-[14px] font-medium text-ink">{formatMoney(p.amount, p.currency)}</span>
                        <StateBadge tone={st.tone}>{st.label}</StateBadge>
                      </div>
                      <span className="text-[13px] text-ink-2">{PAYMENT_METHOD[p.method] ?? p.method}{p.reference ? ` · réf. ${p.reference}` : ''} · {formatDate(p.submittedAt, { time: true })}</span>
                      {p.status === 'rejected' && p.rejectionReason && <span className="text-[13px] text-danger-ink">Motif du rejet : {p.rejectionReason}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {awaiting.length > 0 && <Callout>Un paiement est en attente de vérification par la plateforme. La facture sera marquée « réglée » dès sa validation.</Callout>}
          </section>

          {payable && can('subscription:manage') && (
            <Button variant="primary" onClick={() => setDeclaring(true)}>Déclarer un paiement</Button>
          )}
          {payable && !can('subscription:manage') && <p className="text-[13px] text-ink-2">Seul le propriétaire ou un gestionnaire d&apos;abonnement peut déclarer un paiement.</p>}
          {declaring && <DeclarePaymentModal invoice={d} onClose={() => setDeclaring(false)} />}
        </div>
      )}
    </Drawer>
  );
}

export default function InvoicesPage() {
  useDocumentTitle('Factures et paiements');
  const invoices = useInvoices();
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const open = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });
  const rows = invoices.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Factures de l'abonnement" description="Les factures émises par Hotel Manager Pro à votre établissement. Un paiement est vérifié manuellement avant que la facture soit marquée « réglée ».">
        {invoices.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les factures pour le moment.</p>
        ) : (
          <DataTable<InvoiceSummary>
            caption="Factures de l'abonnement"
            loading={invoices.isPending}
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'number', header: 'Numéro', cell: (r) => <span className="num-col font-medium">{r.number}</span>, sortValue: (r) => r.number ?? '' },
              { key: 'kind', header: 'Objet', cell: (r) => INVOICE_KIND[r.kind] ?? r.kind },
              { key: 'issued', header: 'Émise le', cell: (r) => formatDate(r.issuedAt), sortValue: (r) => r.issuedAt ?? '' },
              { key: 'due', header: 'Échéance', cell: (r) => formatDate(r.dueAt) },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => formatMoney(r.totalAmount, r.currency), sortValue: (r) => r.totalAmount },
              { key: 'balance', header: 'Reste à payer', align: 'right', cell: (r) => formatMoney(r.balanceDue, r.currency), sortValue: (r) => r.balanceDue },
              { key: 'status', header: 'État', cell: statusBadge },
              { key: 'open', header: 'Détails', cell: (r) => <Button size="sm" variant="secondary" onClick={() => open(r.id)} aria-label={`Détails de la facture ${r.number}`}>Détails</Button> },
            ]}
            mobileCard={(r) => (
              <button type="button" onClick={() => open(r.id)} className="flex w-full cursor-pointer flex-col gap-2 text-left">
                <span className="flex items-center justify-between gap-3"><span className="num-col font-medium text-ink">{r.number}</span>{statusBadge(r)}</span>
                <span className="text-[13px] text-ink-2">{INVOICE_KIND[r.kind]} · échéance {formatDate(r.dueAt)}</span>
                <span className="num-col text-[15px] font-medium text-ink">{formatMoney(r.totalAmount, r.currency)}</span>
              </button>
            )}
            empty={<EmptyState kind="key" title="Aucune facture pour le moment" description="Vos factures d'abonnement apparaîtront ici dès que vous aurez choisi une formule." />}
          />
        )}
      </Panel>
      <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
        <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
        Aucun paiement en ligne n&apos;est effectué depuis cette page : vous réglez par virement ou Mobile Money, puis vous déclarez le paiement pour qu&apos;il soit vérifié.
      </p>
      <InvoiceDrawer id={openId} onClose={() => open(null)} />
    </div>
  );
}
