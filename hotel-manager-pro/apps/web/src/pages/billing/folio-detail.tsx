import { formatMoney } from '@hmp/shared';
import { ArrowLeft, Banknote, FilePlus2, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { invoicePdfUrl, useFolio, type Charge, type FolioInvoice, type Payment } from '../../api/billing';
import { isApiError } from '../../api/client';
import { useCan } from '../../auth/session';
import { CHARGE_KIND, PAYMENT_KIND, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '../../lib/billing-labels';
import { formatDate, formatDay } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { Badge, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { PageHeader, Panel } from '../../ui/page';
import { ChargeModal, CreditNoteModal, InvoiceModal, PaymentModal, RefundModal, VoidChargeModal, VoidInvoiceModal } from './modals';

type Dialog = null | 'payment' | 'charge' | 'invoice' | { refund: Payment } | { voidCharge: Charge } | { credit: FolioInvoice } | { voidInvoice: FolioInvoice };

export default function FolioDetailPage() {
  const { id } = useParams();
  const can = useCan();
  const res = useFolio(id);
  const f = res.data;
  useDocumentTitle(f ? `Note ${f.reservationReference ?? ''}` : 'Note du client');
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  if (res.isPending) return <div className="flex flex-col gap-4" role="status" aria-label="Chargement de la note"><Skeleton className="h-9 w-64" /><Skeleton className="h-40 w-full" /></div>;
  if (res.isError || !f) return <EmptyState kind="search" title={isApiError(res.error) && res.error.status === 404 ? 'Note introuvable' : 'Impossible de charger la note'} description="Elle n'existe pas, ou n'appartient pas à cet établissement." action={<Link to="/billing" className="text-accent-ink underline">Retour à la facturation</Link>} />;

  const live = f.charges.filter((c) => !c.voidedAt);
  const uninvoiced = live.filter((c) => !c.invoiceId).reduce((s, c) => s + c.amount + c.taxAmount, 0);
  const open = f.status === 'open';
  const manage = can('billing:manage');
  const money = (n: number) => formatMoney(n, f.currency);

  return (
    <>
      <PageHeader
        title={`Note ${f.reservationReference ?? 'libre'}`}
        description={f.guestName ?? undefined}
        actions={
          <>
            <StateBadge tone={PAYMENT_STATUS_TONE[f.paymentStatus as keyof typeof PAYMENT_STATUS_TONE] ?? 'neutral'}>{PAYMENT_STATUS_LABEL[f.paymentStatus as keyof typeof PAYMENT_STATUS_LABEL] ?? f.paymentStatus}</StateBadge>
            {open && can('payments:record') && f.balanceDue > 0 && <Button variant="primary" onClick={() => setDialog('payment')}><Banknote aria-hidden className="size-4" />Encaisser</Button>}
            {open && manage && <Button variant="secondary" onClick={() => setDialog('charge')}><Plus aria-hidden className="size-4" />Ajouter une charge</Button>}
            {open && manage && uninvoiced > 0 && <Button variant="secondary" onClick={() => setDialog('invoice')}><FilePlus2 aria-hidden className="size-4" />Facturer</Button>}
          </>
        }
      />
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
        <Link to="/billing" className="inline-flex min-h-10 items-center gap-2 font-medium text-accent-ink hover:underline"><ArrowLeft aria-hidden className="size-4" />Toutes les notes</Link>
        {f.reservationId && <Link to={`/reservations/${f.reservationId}`} className="inline-flex min-h-10 items-center font-medium text-accent-ink hover:underline">Voir la réservation</Link>}
      </div>

      <dl className="grid gap-4 sm:grid-cols-3" aria-label="Totaux de la note">
        {[['Charges', f.chargesTotal], ['Déjà payé', f.paymentsTotal], [f.balanceDue < 0 ? 'À rembourser au client' : 'Reste à payer', Math.abs(f.balanceDue)]].map(([label, value]) => (
          <div key={label as string} className="surface glass-1 flex flex-col gap-1 p-5 [--surface-radius:var(--r-card)]"><dt className="text-[13px] text-ink-2">{label}</dt><dd className="num-display text-[24px] font-semibold text-ink">{money(value as number)}</dd></div>
        ))}
      </dl>

      <Panel title="Charges">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Charges de la note">
          <table className="w-full min-w-[40rem] text-[14px]">
            <caption className="sr-only">Charges de la note</caption>
            <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Description</th><th scope="col" className="py-2 font-medium">Date</th><th scope="col" className="py-2 text-right font-medium">Hors taxe</th><th scope="col" className="py-2 text-right font-medium">Taxe</th><th scope="col" className="py-2 text-right font-medium">Total</th><th scope="col" className="py-2 font-medium">Facture</th><th scope="col" className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {f.charges.map((c) => (
                <tr key={c.id} className={`border-b border-hairline ${c.voidedAt ? 'text-ink-3 line-through' : ''}`}>
                  <td className="py-2.5"><span className="flex flex-col"><span>{c.description}</span><span className="text-[12.5px] text-ink-3 no-underline">{CHARGE_KIND[c.kind] ?? c.kind}{c.voidedAt ? ` — annulée : ${c.voidReason}` : ''}</span></span></td>
                  <td className="py-2.5 whitespace-nowrap">{formatDay(c.serviceDate)}</td>
                  <td className="num-col py-2.5 text-right">{money(c.amount)}</td>
                  <td className="num-col py-2.5 text-right">{c.taxAmount ? money(c.taxAmount) : '—'}</td>
                  <td className="num-col py-2.5 text-right font-medium">{money(c.amount + c.taxAmount)}</td>
                  <td className="py-2.5">{c.invoiceNumber ?? '—'}</td>
                  <td className="py-2.5 text-right">{open && manage && !c.voidedAt && !c.invoiceId && c.source !== 'reservation' && <Button size="sm" variant="ghost" onClick={() => setDialog({ voidCharge: c })} aria-label={`Annuler la charge ${c.description}`}>Annuler</Button>}</td>
                </tr>
              ))}
              {f.charges.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-ink-2">Aucune charge.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Encaissements">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Encaissements de la note">
          <table className="w-full min-w-[40rem] text-[14px]">
            <caption className="sr-only">Encaissements et remboursements</caption>
            <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Date</th><th scope="col" className="py-2 font-medium">Nature</th><th scope="col" className="py-2 font-medium">Moyen</th><th scope="col" className="py-2 text-right font-medium">Montant</th><th scope="col" className="py-2 font-medium">Référence</th><th scope="col" className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {f.payments.map((p) => (
                <tr key={p.id} className="border-b border-hairline">
                  <td className="py-2.5 whitespace-nowrap">{formatDate(p.receivedAt, { time: true })}</td>
                  <td className="py-2.5"><Badge tone={p.kind === 'refund' ? 'champagne' : 'neutral'}>{PAYMENT_KIND[p.kind]}</Badge>{p.reason && <span className="ml-2 text-[13px] text-ink-2">{p.reason}</span>}</td>
                  <td className="py-2.5">{p.methodLabel ?? p.methodCode}</td>
                  <td className="num-col py-2.5 text-right"><span className="flex flex-col items-end"><span className={p.kind === 'refund' ? 'text-[var(--st-cancelled)]' : ''}>{p.kind === 'refund' ? '− ' : ''}{formatMoney(p.amount, p.currency)}</span>{p.currency !== f.currency && <span className="text-[12.5px] text-ink-2">= {money(p.baseAmount)} (taux {p.exchangeRate})</span>}{p.refundedAmount > 0 && <span className="text-[12.5px] text-ink-2">dont {formatMoney(p.refundedAmount, p.currency)} remboursés</span>}</span></td>
                  <td className="py-2.5">{p.reference ?? '—'}</td>
                  <td className="py-2.5 text-right">{can('payments:refund') && p.kind !== 'refund' && p.amount - p.refundedAmount > 0 && <Button size="sm" variant="ghost" onClick={() => setDialog({ refund: p })} aria-label={`Rembourser le paiement du ${formatDate(p.receivedAt)}`}>Rembourser</Button>}</td>
                </tr>
              ))}
              {f.payments.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-ink-2">Aucun encaissement pour le moment.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Factures et avoirs" description="Numérotation continue, sans trou. Une facture émise ne se modifie pas.">
        {f.invoices.length === 0 ? <p className="text-[14px] text-ink-2">Aucune facture émise pour cette note.</p> : (
          <ul className="flex flex-col gap-2" aria-label="Factures de la note">
            {f.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-silver-soft px-4 py-3">
                <span className="flex flex-col"><span className="flex items-center gap-2 text-[14px] font-medium text-ink"><Receipt aria-hidden className="size-4 text-ink-3" />{i.number}{i.kind === 'credit_note' && <Badge tone="champagne">Avoir</Badge>}{i.status === 'void' && <StateBadge tone="danger">Annulée</StateBadge>}</span><span className="text-[13px] text-ink-2">{formatDate(i.issuedAt)} · <span className="num-col">{money(i.total)}</span></span></span>
                <span className="flex flex-wrap gap-2">
                  <a href={invoicePdfUrl(i.id)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })} aria-label={`Télécharger le PDF ${i.number}`}>PDF</a>
                  {manage && i.kind === 'invoice' && i.status === 'issued' && <Button size="sm" variant="secondary" onClick={() => setDialog({ credit: i })}>Avoir</Button>}
                  {can('billing:void') && i.kind === 'invoice' && i.status === 'issued' && <Button size="sm" variant="ghost" onClick={() => setDialog({ voidInvoice: i })}>Annuler</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dialog === 'payment' && <PaymentModal folio={f} onClose={close} />}
      {dialog === 'charge' && <ChargeModal folio={f} onClose={close} />}
      {dialog === 'invoice' && <InvoiceModal folio={f} uninvoiced={uninvoiced} onClose={close} />}
      {typeof dialog === 'object' && dialog && 'refund' in dialog && <RefundModal payment={dialog.refund} onClose={close} />}
      {typeof dialog === 'object' && dialog && 'voidCharge' in dialog && <VoidChargeModal folioId={f.id} charge={dialog.voidCharge} onClose={close} />}
      {typeof dialog === 'object' && dialog && 'credit' in dialog && <CreditNoteModal invoice={dialog.credit} currency={f.currency} onClose={close} />}
      {typeof dialog === 'object' && dialog && 'voidInvoice' in dialog && <VoidInvoiceModal invoice={dialog.voidInvoice} onClose={close} />}
    </>
  );
}
