import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import {
  useConnectors, useIssueInvoice, usePlatformInvoice, usePlatformInvoices, useRecordPayment, useVoidInvoice, type InvoiceRow,
} from '../../api/platform';
import { formatDate } from '../../lib/format';
import { INVOICE_KIND, INVOICE_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../../lib/labels';
import { parseMoneyInput } from '../../lib/money-input';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Input, Select, Switch } from '../../ui/form';
import { Drawer, Modal } from '../../ui/overlay';
import { Callout, DefinitionList, PageHeader, Panel } from '../../ui/page';
import { CreateInvoiceModal } from './hotel-actions';
import { HotelLink, HotelPicker, Pager, ReasonModal } from './parts';

const FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'unpaid', label: 'À régler' },
  { value: 'partially_paid', label: 'Partiellement réglées' },
  { value: 'paid', label: 'Réglées' },
  { value: 'void', label: 'Annulées' },
  { value: 'draft', label: 'Brouillons' },
];
const badge = (r: Pick<InvoiceRow, 'paymentStatus' | 'isOverdue' | 'balanceDue'>) =>
  r.isOverdue && r.balanceDue > 0 ? <StateBadge tone="danger">En retard</StateBadge> : <StateBadge tone={INVOICE_STATUS[r.paymentStatus].tone}>{INVOICE_STATUS[r.paymentStatus].label}</StateBadge>;

function RecordPaymentModal({ invoiceId, currency, balance, onClose }: { invoiceId: string; currency: string; balance: number; onClose: () => void }) {
  const connectors = useConnectors();
  const record = useRecordPayment();
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = (connectors.data?.connectors ?? []).filter((c) => c.mode === 'manual').map((c) => ({ value: c.code, label: PAYMENT_METHOD[c.code] ?? c.name }));
  const submit = async () => {
    const needsRef = !['cash', 'other'].includes(method);
    if (needsRef && reference.trim().length < 3) return setError('La référence de la transaction est obligatoire (3 caractères minimum).');
    const minor = amount.trim() ? parseMoneyInput(amount, currency) : undefined;
    if (minor === null || minor === 0) return setError('Montant invalide pour cette devise.');
    if (minor !== undefined && minor > balance) return setError(`Le montant dépasse le reste à payer (${formatMoney(balance, currency)}).`);
    setError(null);
    setBusy(true);
    try {
      const r = await record.mutateAsync({ invoiceId, method, amount: minor, reference: reference.trim() || undefined, payerName: payer.trim() || undefined });
      toast.success(r.effects.length ? 'Paiement enregistré : la facture est réglée et ses effets sont appliqués.' : 'Paiement enregistré.');
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Enregistrer un paiement reçu" description={`Reste à payer : ${formatMoney(balance, currency)}. Le paiement est considéré comme déjà vérifié par vous.`}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Enregistrer</Button></>}>
      <div className="flex flex-col gap-5">
        <Field label="Moyen de paiement">{(c) => <Select {...c} value={method} onValueChange={setMethod} options={methods.length ? methods : [{ value: 'bank_transfer', label: 'Virement bancaire' }]} />}</Field>
        <Field label="Référence de la transaction" hint="Obligatoire sauf espèces.">{(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />}</Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Montant reçu" hint="Vide = solde complet.">{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />}</Field>
          <Field label="Payeur (facultatif)">{(c) => <Input {...c} value={payer} onChange={(e) => setPayer(e.target.value)} autoComplete="off" />}</Field>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = usePlatformInvoice(id);
  const issue = useIssueInvoice();
  const voidInv = useVoidInvoice();
  const [mode, setMode] = useState<'pay' | 'void' | null>(null);
  const d = q.data;
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={d ? (d.number ? `Facture ${d.number}` : 'Brouillon de facture') : 'Facture'} description={d ? `${d.hotelName} — ${INVOICE_KIND[d.kind] ?? d.kind}` : undefined}>
      {q.isPending ? (
        <div role="status" className="flex flex-col gap-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-32 w-full" /><span className="sr-only">Chargement</span></div>
      ) : q.isError || !d ? (
        <p className="text-[14px] text-ink-2">Facture introuvable.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1"><span className="text-[13px] text-ink-2">Reste à payer</span><span className="num-display text-[30px] leading-none font-semibold text-ink">{formatMoney(d.balanceDue, d.currency)}</span></div>
            {d.status === 'draft' ? <StateBadge tone="neutral">Brouillon</StateBadge> : badge(d)}
          </div>
          <DefinitionList items={[
            { label: 'Établissement', value: <HotelLink id={d.hotelId} name={d.hotelName} /> },
            { label: 'Émise le', value: formatDate(d.issuedAt, { long: true }) },
            { label: 'Échéance', value: formatDate(d.dueAt, { long: true }) },
            { label: 'Total', value: formatMoney(d.totalAmount, d.currency) },
            { label: 'Déjà réglé', value: formatMoney(d.amountPaid, d.currency) },
          ]} />
          <table className="w-full text-[14px]">
            <caption className="sr-only">Lignes</caption>
            <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Désignation</th><th scope="col" className="py-2 text-right font-medium">Montant</th></tr></thead>
            <tbody>{d.lines.map((l, i) => <tr key={i} className="border-b border-hairline"><td className="py-2.5 pr-3">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</td><td className="num-col py-2.5 text-right">{formatMoney(l.amount, d.currency)}</td></tr>)}</tbody>
          </table>
          <section aria-labelledby="ip-h" className="flex flex-col gap-2">
            <h3 id="ip-h" className="text-[15px] font-semibold text-ink">Paiements</h3>
            {d.payments.length === 0 ? <p className="text-[14px] text-ink-2">Aucun paiement.</p> : d.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3 text-[14px]">
                <span className="flex flex-col"><span className="num-col font-medium">{formatMoney(p.amount, d.currency)}</span><span className="text-[13px] text-ink-2">{PAYMENT_METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span></span>
                <StateBadge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</StateBadge>
              </div>
            ))}
          </section>
          <div className="flex flex-wrap gap-3">
            {d.status === 'draft' && (
              <Button variant="primary" loading={issue.isPending} onClick={() => issue.mutate(d.id, { onSuccess: (r) => toast.success(`Facture ${r.number} émise.`), onError: (e) => toast.error(e.message) })}>Émettre la facture</Button>
            )}
            {d.status === 'issued' && d.balanceDue > 0 && <Button variant="primary" onClick={() => setMode('pay')}>Enregistrer un paiement reçu</Button>}
            {d.status === 'issued' && d.amountPaid === 0 && <Button variant="secondary" onClick={() => setMode('void')}>Annuler la facture</Button>}
          </div>
          {mode === 'pay' && <RecordPaymentModal invoiceId={d.id} currency={d.currency} balance={d.balanceDue} onClose={() => setMode(null)} />}
          {mode === 'void' && (
            <ReasonModal title="Annuler cette facture" description="Une facture annulée ne peut plus être réglée ; son numéro reste dans la séquence." confirmLabel="Annuler la facture" destructive
              onSubmit={(reason) => voidInv.mutateAsync({ id: d.id, reason }).then(() => void toast.success('Facture annulée.'))} onClose={() => setMode(null)} />
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function PlatformInvoicesPage() {
  useDocumentTitle('Factures — Console');
  const [params, setParams] = useSearchParams();
  const status = params.get('paymentStatus') ?? 'all';
  const overdue = params.get('overdue') === 'true';
  const page = Number(params.get('page') ?? 1) || 1;
  const openId = params.get('open');
  const [creating, setCreating] = useState(false);
  const [hotel, setHotel] = useState<{ id: string; name: string } | null>(null);
  const list = usePlatformInvoices({ paymentStatus: status === 'all' ? undefined : status, overdue: overdue || undefined, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === 'all' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch) && !('open' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Factures" description="Les factures d'abonnement, de licence et de prestations émises aux établissements. Une facture n'est « réglée » que par des paiements confirmés." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />Créer une facture</Button>} />
      <Panel>
        <div className="grid items-end gap-4 sm:grid-cols-[14rem_auto]">
          <Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ paymentStatus: v })} options={FILTERS} />}</Field>
          <div className="pb-1"><Switch label="Seulement les factures en retard" checked={overdue} onCheckedChange={(c) => set({ overdue: c ? 'true' : null })} /></div>
        </div>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les factures.</p> : (
          <>
            <DataTable<InvoiceRow>
              caption="Factures SaaS"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'n', header: 'Numéro', cell: (r) => <button type="button" onClick={() => set({ open: r.id })} className="num-col cursor-pointer font-medium text-accent-ink hover:underline">{r.number ?? 'Brouillon'}</button> },
                { key: 'h', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
                { key: 'k', header: 'Objet', cell: (r) => INVOICE_KIND[r.kind] ?? r.kind },
                { key: 'due', header: 'Échéance', cell: (r) => formatDate(r.dueAt) },
                { key: 't', header: 'Total', align: 'right', cell: (r) => formatMoney(r.totalAmount, r.currency) },
                { key: 'b', header: 'Reste', align: 'right', cell: (r) => formatMoney(r.balanceDue, r.currency) },
                { key: 's', header: 'État', cell: (r) => (r.status === 'draft' ? <StateBadge tone="neutral">Brouillon</StateBadge> : badge(r)) },
              ]}
              mobileCard={(r) => (
                <button type="button" onClick={() => set({ open: r.id })} className="flex w-full cursor-pointer flex-col gap-1.5 text-left">
                  <span className="flex items-center justify-between gap-3"><span className="num-col font-medium text-ink">{r.number ?? 'Brouillon'}</span>{r.status === 'draft' ? <StateBadge tone="neutral">Brouillon</StateBadge> : badge(r)}</span>
                  <span className="text-[13px] text-ink-2">{r.hotelName}</span>
                  <span className="num-col text-[15px] font-medium text-ink">{formatMoney(r.totalAmount, r.currency)}</span>
                </button>
              )}
              empty={<EmptyState kind="key" title="Aucune facture" description="Aucune facture ne correspond à ce filtre." />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
      <InvoiceDrawer id={openId} onClose={() => set({ open: null })} />
      {creating && !hotel && (
        <Modal open onOpenChange={(o) => !o && setCreating(false)} title="Créer une facture" description="Choisissez d'abord l'établissement à facturer." footer={<Button variant="secondary" onClick={() => setCreating(false)}>Annuler</Button>}>
          <HotelPicker value={hotel} onChange={setHotel} />
        </Modal>
      )}
      {creating && hotel && <CreateInvoiceModal hotelId={hotel.id} hotelName={hotel.name} onClose={() => { setCreating(false); setHotel(null); }} onCreated={(id) => set({ open: id })} />}
    </>
  );
}

