import { useState } from 'react';
import { FileText, Printer, Undo2 } from 'lucide-react';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, PageHeader, Select, SearchInput, StatusBadge, Money, useToast, Checkbox, Textarea } from '../components/ui';
import { call, system, useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateTime, money, monthStartStr, parseQty, qty, qtyToInput, todayStr } from '../lib/format';
import { invoiceHtml, receiptHtml } from '../print/templates';

export function SalesPage() {
  const { t } = useT();
  const { can } = useAuth();
  const [f, setF] = useState({ from: monthStartStr(), to: todayStr(), status: '', q: '' });
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQ('sales.list', { from: f.from, to: f.to, status: (f.status || undefined) as any, q: f.q || undefined, limit: 300 });
  return (
    <>
      <PageHeader title="Historique des ventes" subtitle="Tickets, factures, retours et remboursements" />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <SearchInput className="w-64" value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="N° de ticket ou client…" />
        <Field label="Du"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Au"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Statut"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">{t('Tous')}</option><option value="PAID">{t('Payée')}</option><option value="PARTIAL">{t('Partielle')}</option><option value="UNPAID">{t('Impayée')}</option></Select></Field>
        <p className="ml-auto text-sm text-ink-400">{data?.total ?? 0} {t('vente(s)')}</p>
      </Card>
      <Card>
        <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setOpen(r.id)} rows={(data?.rows ?? []) as any[]} columns={[
          { key: 'n', header: 'N°', render: (r: any) => <span className="font-medium">{r.number}</span> },
          { key: 'd', header: 'Date', render: (r: any) => dateTime(r.createdAt) },
          { key: 'c', header: 'Client', render: (r: any) => r.customerName ?? <span className="text-ink-400">{t('Comptoir')}</span> },
          { key: 'u', header: 'Vendeur', render: (r: any) => r.userName },
          { key: 't', header: 'Total', align: 'right', render: (r: any) => <Money v={r.total} className="font-semibold" /> },
          { key: 'r', header: 'Retours', align: 'right', render: (r: any) => (r.returnedTotal > 0 ? <span className="text-red-500">−{money(r.returnedTotal)}</span> : '') },
          { key: 's', header: 'Statut', render: (r: any) => <StatusBadge status={r.paymentStatus} /> },
          { key: 'i', header: 'Facture', render: (r: any) => (r.invoiceNumber ? <Badge tone="blue">{r.invoiceNumber}</Badge> : '') },
        ]} />
      </Card>
      {open && <SaleDetail id={open} onClose={() => setOpen(null)} canReturn={can('sale.return')} />}
    </>
  );
}

export function SaleDetail({ id, onClose, canReturn }: { id: string; onClose: () => void; canReturn: boolean }) {
  const { t } = useT();
  const { push } = useToast();
  const { data: s } = useQ('sales.get', { id });
  const co = useQ('company.get');
  const [ret, setRet] = useState(false);
  if (!s) return null;
  const print = async (kind: 'ticket' | 'invoice') => {
    try {
      if (kind === 'ticket') await system('print', { html: receiptHtml(co.data!, s, t) });
      else { const inv: any = await call('sales.invoice', { saleId: s.id }); await system('print', { html: invoiceHtml(co.data!, s, { number: inv.number, issuedAt: s.invoice?.issuedAt ?? new Date().toISOString() }, t) }); }
    } catch (e) { push('error', (e as Error).message); }
  };
  const pdf = async () => {
    try { const inv: any = await call('sales.invoice', { saleId: s.id }); const p = await system('savePdf', { html: invoiceHtml(co.data!, s, { number: inv.number, issuedAt: s.invoice?.issuedAt ?? new Date().toISOString() }, t), filename: `${inv.number}.pdf` }); if (p) push('success', t('Facture enregistrée')); } catch (e) { push('error', (e as Error).message); }
  };
  const due = s.total - s.returnedTotal - s.paidTotal;
  return (
    <Modal open onClose={onClose} title={`${t('Vente')} ${s.number}`} size="lg" footer={<>
      <Button onClick={() => print('ticket')} icon={<Printer className="size-4" />}>{t('Ticket')}</Button>
      <Button onClick={() => print('invoice')} icon={<FileText className="size-4" />}>{t('Imprimer la facture')}</Button>
      <Button onClick={pdf} icon={<FileText className="size-4" />}>PDF</Button>
      {canReturn && <Button variant="primary" onClick={() => setRet(true)} icon={<Undo2 className="size-4" />}>{t('Retour / remboursement')}</Button>}
    </>}>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-500">
        <span>{dateTime(s.createdAt)}</span><span>{t('Vendeur')} : {s.userName}</span><span>{t('Client')} : {s.customerName ?? t('Comptoir')}</span><StatusBadge status={s.paymentStatus} />{s.invoice && <Badge tone="blue">{s.invoice.number}</Badge>}
      </div>
      <DataTable dense rowKey={(r: any) => r.id} rows={s.items as any[]} columns={[
        { key: 'n', header: 'Article', render: (r: any) => <><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-400">{r.sku}</span></> },
        { key: 'q', header: 'Qté', align: 'right', render: (r: any) => <>{qty(r.qtyMilli)}{r.returnedMilli > 0 && <span className="ml-1 text-xs text-red-500">(−{qty(r.returnedMilli)})</span>}</> },
        { key: 'p', header: 'P.U.', align: 'right', render: (r: any) => money(r.unitPrice) },
        { key: 'd', header: 'Remise', align: 'right', render: (r: any) => (r.discount + r.cartDiscountShare ? money(r.discount + r.cartDiscountShare) : '') },
        { key: 't', header: 'Total', align: 'right', render: (r: any) => <b>{money(r.total)}</b> },
      ]} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-400">{t('Paiements')}</p>
          {s.payments.map((p: any) => <div key={p.id} className="flex justify-between"><span>{p.methodName} {p.direction === 'OUT' && <Badge tone="red">{t('remboursement')}</Badge>}</span><span className="tabular">{p.direction === 'OUT' ? '−' : ''}{money(p.amount)}</span></div>)}
          {s.allocations.map((a: any, i: number) => <div key={i} className="flex justify-between text-ink-500"><span>{t('Règlement ultérieur')} ({a.methodName})</span><span className="tabular">{money(a.amount)}</span></div>)}
          {s.returns.map((r: any) => <div key={r.id} className="flex justify-between text-red-600"><span>{t('Retour')} {r.number}</span><span className="tabular">−{money(r.total)}</span></div>)}
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>{t('Total HT')}</span><span className="tabular">{money(s.netTotal)}</span></div>
          <div className="flex justify-between"><span>{t('Taxe')}</span><span className="tabular">{money(s.taxTotal)}</span></div>
          <div className="flex justify-between border-t border-ink-100 pt-1 text-base font-bold dark:border-white/10"><span>{t('Total TTC')}</span><span className="tabular">{money(s.total)}</span></div>
          {due > 0 && <div className="flex justify-between font-semibold text-red-600"><span>{t('Reste dû')}</span><span className="tabular">{money(due)}</span></div>}
        </div>
      </div>
      {ret && <ReturnModal sale={s} onClose={() => setRet(false)} />}
    </Modal>
  );
}

function ReturnModal({ sale, onClose }: { sale: any; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const methods = (useQ('ref.paymentMethods').data ?? []) as any[];
  const [q, setQ] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'METHOD' | 'STORE_CREDIT'>('METHOD');
  const [methodId, setMethodId] = useState('');
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('sales.return', { onSuccess: (r) => { push('success', t('Retour enregistré : {n}', { n: r.number })); onClose(); } });
  const items = Object.entries(q).filter(([, v]) => v > 0).map(([saleItemId, qtyMilli]) => ({ saleItemId, qtyMilli }));
  const est = sale.items.reduce((a: number, i: any) => a + Math.round(((q[i.id] ?? 0) * i.total) / i.qtyMilli), 0);
  return (
    <Modal open onClose={onClose} title={`${t('Retour')} — ${sale.number}`} size="lg" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!items.length || (mode === 'METHOD' && !methodId && est > 0 && sale.paidTotal > 0)} onClick={() => m.mutate({ saleId: sale.id, items, refundMode: mode, refundMethodId: mode === 'METHOD' && methodId ? methodId : undefined, restock, reason: reason || undefined }, { onError: setErr })}>{t('Valider le retour')}</Button></>}>
      <DataTable dense rowKey={(r: any) => r.id} rows={sale.items as any[]} columns={[
        { key: 'n', header: 'Article', render: (r: any) => r.name },
        { key: 's', header: 'Vendu', align: 'right', render: (r: any) => `${qty(r.qtyMilli)}${r.returnedMilli ? ` (−${qty(r.returnedMilli)})` : ''}` },
        { key: 'r', header: 'Quantité à retourner', align: 'right', width: '10rem', render: (r: any) => <Input className="h-8 text-right" inputMode="decimal" disabled={r.qtyMilli - r.returnedMilli <= 0} placeholder={`0 – ${qtyToInput(r.qtyMilli - r.returnedMilli)}`} onChange={(e) => setQ((c) => ({ ...c, [r.id]: Math.min(parseQty(e.target.value), r.qtyMilli - r.returnedMilli) }))} /> },
      ]} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Remboursement"><Select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="METHOD">{t('Rembourser (mode de paiement)')}</option><option value="STORE_CREDIT" disabled={!sale.customerId}>{t('Avoir client (avance)')}</option></Select></Field>
        {mode === 'METHOD' && <Field label="Mode de remboursement"><Select value={methodId} onChange={(e) => setMethodId(e.target.value)}><option value="">—</option>{methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>}
        <Field label="Motif" className="md:col-span-2"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div className="mt-2 flex items-center justify-between"><Checkbox checked={restock} onChange={setRestock} label="Remettre les articles en stock" /><p className="text-sm">{t('Montant du retour')} : <b className="tabular">{money(est)}</b></p></div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
