import { useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Modal, MoneyInput, PageHeader, Select, SearchInput, Textarea, Money, ConfirmDialog, Checkbox, useToast } from '../components/ui';
import { useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateTime, money } from '../lib/format';
import { SaleDetail } from './Sales';

export function CustomersPage() {
  const { t } = useT();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(null);
  const { data } = useQ('customers.list', { q, withDebt: debtOnly });
  const rows = (data ?? []) as any[];
  return (
    <>
      <PageHeader title="Clients" subtitle="Fiches, comptes clients, crédit et avances" actions={can('customer.manage') && <Button variant="gold" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>{t('Nouveau client')}</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Clients" value={rows.length} />
        <Kpi label="Créances clients" value={money(rows.reduce((a, r) => a + Math.max(r.balance, 0), 0))} tone="gold" />
        <Kpi label="Avances détenues" value={money(rows.reduce((a, r) => a + Math.max(-r.balance, 0), 0))} tone="green" />
        <Kpi label="Clients endettés" value={rows.filter((r) => r.balance > 0).length} tone="red" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4"><SearchInput className="w-72" value={q} onChange={setQ} placeholder="Nom, téléphone, code…" /><Checkbox checked={debtOnly} onChange={setDebtOnly} label="Uniquement les débiteurs" /></div>
        <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setView(r.id)} rows={rows} columns={[
          { key: 'n', header: 'Nom', render: (r: any) => <><span className="font-medium">{r.name}</span>{r.priceTier === 'WHOLESALE' && <Badge tone="gold">{t('Gros')}</Badge>}<span className="block text-xs text-ink-400">{r.phone}</span></> },
          { key: 's', header: 'Achats', align: 'right', render: (r: any) => <span className="text-ink-500">{r.salesCount} · {money(r.totalSpent)}</span> },
          { key: 'l', header: 'Plafond crédit', align: 'right', render: (r: any) => money(r.creditLimit) },
          { key: 'b', header: 'Solde', align: 'right', render: (r: any) => (r.balance > 0 ? <span className="font-semibold text-red-600">{t('Doit')} {money(r.balance)}</span> : r.balance < 0 ? <span className="font-semibold text-emerald-600">{t('Avance')} {money(-r.balance)}</span> : <span className="text-ink-300">—</span>) },
        ]} />
      </Card>
      {edit && <CustomerForm initial={edit} onClose={() => setEdit(null)} />}
      {view && <CustomerView id={view} onClose={() => setView(null)} onEdit={(c) => { setView(null); setEdit(c); }} />}
    </>
  );
}

function CustomerForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', taxId: '', priceTier: 'RETAIL', creditLimit: 0, notes: '', active: true, ...initial });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const m = useM('customers.save', { onSuccess: onClose });
  const save = () => m.mutate({ id: f.id, name: f.name, code: f.code, phone: f.phone, email: f.email, address: f.address, taxId: f.taxId, priceTier: f.priceTier, creditLimit: f.creditLimit, notes: f.notes, active: f.active }, { onError: setErr });
  return (
    <Modal open onClose={onClose} title={f.id ? 'Modifier le client' : 'Nouveau client'} footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!f.name.trim()} onClick={save}>{t('Enregistrer')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nom / Raison sociale" className="md:col-span-2"><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Téléphone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Adresse" className="md:col-span-2"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="NIF / N° fiscal"><Input value={f.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} /></Field>
        <Field label="Tarif appliqué"><Select value={f.priceTier} onChange={(e) => set('priceTier', e.target.value)}><option value="RETAIL">{t('Détail')}</option><option value="WHOLESALE">{t('Gros')}</option></Select></Field>
        <Field label="Plafond de crédit" hint="0 = vente à crédit interdite"><MoneyInput value={f.creditLimit} onChange={(v) => set('creditLimit', v)} /></Field>
        <Field label="Notes" className="md:col-span-2"><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {f.id && <Checkbox checked={f.active} onChange={(v) => set('active', v)} label="Client actif" />}
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function CustomerView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (c: any) => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const { push } = useToast();
  const { data: c } = useQ('customers.get', { id });
  const methods = (useQ('ref.paymentMethods').data ?? []) as any[];
  const [pay, setPay] = useState(false);
  const [sale, setSale] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const rm = useM('customers.delete', { onSuccess: onClose });
  if (!c) return null;
  return (
    <Modal open onClose={onClose} title={c.name} size="xl" footer={<>
      {can('customer.manage') && <><Button variant="ghost" onClick={() => setDel(true)}>{t('Supprimer')}</Button><Button onClick={() => onEdit(c)}>{t('Modifier')}</Button><Button variant="gold" icon={<Wallet className="size-4" />} onClick={() => setPay(true)}>{c.balance > 0 ? t('Encaisser un règlement') : t('Enregistrer une avance')}</Button></>}</>}>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Solde" value={c.balance > 0 ? `${t('Doit')} ${money(c.balance)}` : c.balance < 0 ? `${t('Avance')} ${money(-c.balance)}` : money(0)} tone={c.balance > 0 ? 'red' : c.balance < 0 ? 'green' : 'neutral'} />
        <Kpi label="Plafond de crédit" value={money(c.creditLimit)} /><Kpi label="Tarif" value={c.priceTier === 'WHOLESALE' ? t('Gros') : t('Détail')} /><Kpi label="Contact" value={<span className="text-base">{c.phone || '—'}</span>} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div><h4 className="mb-2 text-sm font-semibold">{t('Dernières ventes')}</h4>
          <DataTable dense rowKey={(r: any) => r.id} onRowClick={(r: any) => setSale(r.id)} rows={c.sales as any[]} columns={[{ key: 'n', header: 'N°', render: (r: any) => r.number }, { key: 'd', header: 'Date', render: (r: any) => dateTime(r.createdAt) }, { key: 't', header: 'Total', align: 'right', render: (r: any) => money(r.total - r.returnedTotal) }, { key: 'p', header: 'Payé', align: 'right', render: (r: any) => money(r.paidTotal) }]} /></div>
        <div><h4 className="mb-2 text-sm font-semibold">{t('Compte client')}</h4>
          <DataTable dense rowKey={(r: any) => r.id} rows={c.ledger as any[]} columns={[{ key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'k', header: 'Opération', render: (r: any) => <><Badge>{LEDGER[r.kind] ? t(LEDGER[r.kind]) : r.kind}</Badge> <span className="text-xs text-ink-400">{r.note}</span></> }, { key: 'a', header: 'Montant', align: 'right', render: (r: any) => <span className={r.amount > 0 ? 'text-red-600' : 'text-emerald-600'}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</span> }]} /></div>
      </div>
      {pay && <PayModal customer={c} methods={methods} onClose={() => setPay(false)} onDone={(r: any) => push('success', r.advance > 0 ? t('Règlement enregistré (avance : {a})', { a: money(r.advance) }) : t('Règlement enregistré'))} />}
      {sale && <SaleDetail id={sale} onClose={() => setSale(null)} canReturn={can('sale.return')} />}
      <ConfirmDialog open={del} danger title="Supprimer le client" message="Le client sera archivé (son historique est conservé)." confirmLabel="Supprimer" onClose={() => setDel(false)} onConfirm={() => rm.mutate({ id })} />
    </Modal>
  );
}
const LEDGER: Record<string, string> = { SALE_CREDIT: 'Vente à crédit', PAYMENT: 'Règlement', ADVANCE: 'Avance', RETURN: 'Retour', ADJUSTMENT: 'Ajustement', ADVANCE_USED: 'Avance utilisée' };

function PayModal({ customer, methods, onClose, onDone }: { customer: any; methods: any[]; onClose: () => void; onDone: (r: any) => void }) {
  const { t } = useT();
  const [amount, setAmount] = useState(Math.max(customer.balance, 0));
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('customers.receivePayment', { onSuccess: (r) => { onDone(r); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Règlement client" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="gold" loading={m.isPending} disabled={amount <= 0 || !methodId} onClick={() => m.mutate({ customerId: customer.id, methodId, amount, note: note || undefined }, { onError: setErr })}>{t('Encaisser')}</Button></>}>
      <div className="space-y-3">
        {customer.balance > 0 && <p className="text-sm text-ink-500">{t('Dette actuelle')} : <b className="text-red-600">{money(customer.balance)}</b>. {t('Le règlement est affecté aux ventes les plus anciennes ; l’excédent devient une avance.')}</p>}
        <Field label="Montant"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Mode de paiement"><Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>{methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><ErrorBox error={err} />
      </div>
    </Modal>
  );
}
void Money;
