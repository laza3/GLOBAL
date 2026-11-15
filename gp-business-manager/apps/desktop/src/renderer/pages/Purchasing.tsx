import { useState } from 'react';
import { PackageCheck, Plus, Trash2, Wallet } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorBox, Field, Input, Kpi, Modal, MoneyInput, PageHeader, QtyInput, SearchInput, Select, StatusBadge, Tabs, Textarea, Money, useToast } from '../components/ui';
import { VariantPicker, type PickedVariant } from '../components/VariantPicker';
import { useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateOnly, dateTime, money, qty } from '../lib/format';

export function PurchasingPage() {
  const { t } = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<'purchases' | 'suppliers' | 'debts'>('purchases');
  return (
    <>
      <PageHeader title="Achats & fournisseurs" subtitle="Bons de commande, réceptions, dettes et paiements" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'purchases', label: 'Bons de commande' }, { id: 'suppliers', label: 'Fournisseurs' }, ...(can('finance.view') || can('purchase.view') ? [{ id: 'debts' as const, label: 'Dettes & échéances' }] : [])]} />
      {tab === 'purchases' && <Purchases canEdit={can('purchase.manage')} />}
      {tab === 'suppliers' && <Suppliers canEdit={can('supplier.manage')} />}
      {tab === 'debts' && <Debts />}
    </>
  );
}

function Purchases({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const [status, setStatus] = useState('');
  const [create, setCreate] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const { data } = useQ('purchases.list', { status: status || undefined });
  return (
    <Card>
      <div className="flex items-center gap-3 p-4"><Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('Tous les statuts')}</option><option value="ORDERED">{t('Commandée')}</option><option value="PARTIAL">{t('Partielle')}</option><option value="RECEIVED">{t('Reçue')}</option><option value="CANCELLED">{t('Annulée')}</option></Select>
        {canEdit && <Button className="ml-auto" variant="gold" icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>{t('Nouvelle commande')}</Button>}</div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setView(r.id)} rows={(data ?? []) as any[]} columns={[
        { key: 'n', header: 'N°', render: (r: any) => <b>{r.number}</b> }, { key: 'd', header: 'Date', render: (r: any) => dateTime(r.createdAt) }, { key: 's', header: 'Fournisseur', render: (r: any) => r.supplierName },
        { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName }, { key: 't', header: 'Total', align: 'right', render: (r: any) => money(r.total) },
        { key: 'r', header: 'Reçu', align: 'right', render: (r: any) => money(r.receivedTotal) }, { key: 'p', header: 'Payé', align: 'right', render: (r: any) => money(r.paidTotal) }, { key: 'st', header: 'Statut', render: (r: any) => <StatusBadge status={r.status} /> }]} />
      {create && <PurchaseForm onClose={() => setCreate(false)} />}
      {view && <PurchaseView id={view} canEdit={canEdit} onClose={() => setView(null)} />}
    </Card>
  );
}

function PurchaseForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const suppliers = (useQ('suppliers.list').data ?? []) as any[];
  const wh = (useQ('org.warehouses').data ?? []) as any[];
  const [f, setF] = useState({ supplierId: '', warehouseId: wh[0]?.id ?? '', supplierRef: '', dueDate: '', shippingCost: 0, note: '' });
  const [items, setItems] = useState<{ v: PickedVariant; q: number; cost: number }[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const m = useM('purchases.create', { onSuccess: (r) => { push('success', `${t('Commande')} ${r.number}`); onClose(); } });
  const total = items.reduce((a, i) => a + Math.round((i.q * i.cost) / 1000), 0);
  return (
    <Modal open onClose={onClose} size="xl" title="Nouvelle commande fournisseur" footer={<><span className="mr-auto self-center text-sm text-ink-500">{t('Total HT')} : <b className="tabular">{money(total)}</b></span><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!f.supplierId || !items.length || items.some((i) => i.q <= 0)} onClick={() => m.mutate({ supplierId: f.supplierId, warehouseId: f.warehouseId || wh[0]?.id, supplierRef: f.supplierRef || undefined, dueDate: f.dueDate || undefined, shippingCost: f.shippingCost || undefined, note: f.note || undefined, items: items.map((i) => ({ variantId: i.v.variantId, qtyMilli: i.q, unitCost: i.cost })) }, { onError: setErr })}>{t('Créer la commande')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Fournisseur"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Entrepôt de réception"><Select value={f.warehouseId || wh[0]?.id} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{wh.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Réf. fournisseur"><Input value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} /></Field>
        <Field label="Échéance de paiement"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div>
      <div className="mt-4"><VariantPicker placeholder="Ajouter un article à commander…" onPick={(v) => setItems((c) => (c.some((x) => x.v.variantId === v.variantId) ? c : [...c, { v, q: 1000, cost: 0 }]))} /></div>
      <DataTable dense rowKey={(r: any) => r.v.variantId} rows={items} empty={<p className="py-8 text-center text-sm text-ink-400">{t('Aucun article')}</p>} columns={[
        { key: 'n', header: 'Article', render: (r: any) => <>{r.v.name}<span className="block text-xs text-ink-400">{r.v.sku}</span></> },
        { key: 'q', header: 'Quantité', align: 'right', width: '9rem', render: (r: any) => <QtyInput value={r.q} onChange={(q) => setItems((c) => c.map((x) => (x.v.variantId === r.v.variantId ? { ...x, q } : x)))} /> },
        { key: 'c', header: 'Coût unitaire HT', align: 'right', width: '11rem', render: (r: any) => <MoneyInput value={r.cost} onChange={(cost) => setItems((c) => c.map((x) => (x.v.variantId === r.v.variantId ? { ...x, cost } : x)))} /> },
        { key: 't', header: 'Total', align: 'right', render: (r: any) => money(Math.round((r.q * r.cost) / 1000)) },
        { key: 'x', header: '', render: (r: any) => <button onClick={() => setItems((c) => c.filter((x) => x.v.variantId !== r.v.variantId))} className="text-ink-400 hover:text-red-500"><Trash2 className="size-4" /></button> }]} />
      <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Frais d’approche (transport, douane)" hint="Répartis dans le coût de revient à la réception"><MoneyInput value={f.shippingCost} onChange={(v) => setF({ ...f, shippingCost: v })} /></Field><Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function PurchaseView({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const { data: p } = useQ('purchases.get', { id });
  const [recv, setRecv] = useState<Record<string, { q: number; lot: string; exp: string }>>({});
  const upd = (id: string, patch: Partial<{ q: number; lot: string; exp: string }>) => setRecv((c) => ({ ...c, [id]: Object.assign({ q: 0, lot: '', exp: '' }, c[id], patch) }));
  const [err, setErr] = useState<unknown>(null);
  const [cancel, setCancel] = useState(false);
  const receive = useM('purchases.receive', { onSuccess: (r) => { push('success', `${t('Réception')} ${r.number}`); setRecv({}); } });
  const cancelM = useM('purchases.cancel', { onSuccess: onClose });
  if (!p) return null;
  const open = p.status === 'ORDERED' || p.status === 'PARTIAL';
  return (
    <Modal open onClose={onClose} size="xl" title={`${p.number} — ${p.supplierName}`} footer={canEdit && open && <>
      {p.status === 'ORDERED' && <Button variant="ghost" className="mr-auto" onClick={() => setCancel(true)}>{t('Annuler la commande')}</Button>}
      <Button variant="gold" icon={<PackageCheck className="size-4" />} loading={receive.isPending} disabled={!Object.values(recv).some((r) => r.q > 0)} onClick={() => receive.mutate({ purchaseId: id, items: Object.entries(recv).filter(([, r]) => r.q > 0).map(([purchaseItemId, r]) => ({ purchaseItemId, qtyMilli: r.q, lotNo: r.lot || undefined, expiryDate: r.exp || undefined })) }, { onError: setErr })}>{t('Réceptionner')}</Button></>}>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-500"><StatusBadge status={p.status} /><span>{dateTime(p.createdAt)}</span><span>{t('Entrepôt')} : {p.warehouseName}</span>{p.dueDate && <span>{t('Échéance')} : {dateOnly(p.dueDate)}</span>}<span>{t('Total')} : <b>{money(p.total)}</b></span><span>{t('Reçu')} : {money(p.receivedTotal)}</span><span>{t('Payé')} : {money(p.paidTotal)}</span></div>
      <DataTable dense rowKey={(r: any) => r.id} rows={p.items as any[]} columns={[
        { key: 'n', header: 'Article', render: (r: any) => <>{r.name}<span className="block text-xs text-ink-400">{r.sku}</span></> },
        { key: 'c', header: 'Coût', align: 'right', render: (r: any) => money(r.unitCost) }, { key: 'q', header: 'Commandé', align: 'right', render: (r: any) => qty(r.qtyMilli) }, { key: 'r', header: 'Reçu', align: 'right', render: (r: any) => qty(r.receivedMilli) },
        ...(open && canEdit ? [
          { key: 'a', header: 'Réceptionner', align: 'right' as const, width: '9rem', render: (r: any) => (r.qtyMilli - r.receivedMilli > 0 ? <QtyInput value={recv[r.id]?.q ?? 0} onChange={(q) => upd(r.id, { q: Math.min(q, r.qtyMilli - r.receivedMilli) })} /> : <Badge tone="green">{t('Complet')}</Badge>) },
          ...(p.items.some((i: any) => i.trackLots) ? [{ key: 'l', header: 'Lot / expiration', width: '14rem', render: (r: any) => (r.trackLots ? <div className="flex gap-1"><Input className="h-9" placeholder={t('Lot')} onChange={(e) => upd(r.id, { lot: e.target.value })} /><Input className="h-9" type="date" onChange={(e) => upd(r.id, { exp: e.target.value })} /></div> : null) }] : [])] : []),
      ]} />
      {p.receipts.length > 0 && <p className="mt-3 text-xs text-ink-400">{t('Réceptions')} : {p.receipts.map((r: any) => `${r.number} (${money(r.total)})`).join(' · ')}</p>}
      <div className="mt-3"><ErrorBox error={err} /></div>
      <ConfirmDialog open={cancel} danger title="Annuler la commande" message="Cette commande n'a reçu aucune marchandise ; elle sera annulée." confirmLabel="Annuler la commande" onClose={() => setCancel(false)} onConfirm={() => cancelM.mutate({ id })} />
    </Modal>
  );
}

function Suppliers({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(null);
  const { data } = useQ('suppliers.list', { q });
  return (
    <Card>
      <div className="flex items-center gap-3 p-4"><SearchInput className="w-72" value={q} onChange={setQ} />{canEdit && <Button className="ml-auto" variant="gold" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>{t('Nouveau fournisseur')}</Button>}</div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setView(r.id)} rows={(data ?? []) as any[]} columns={[
        { key: 'n', header: 'Fournisseur', render: (r: any) => <><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-400">{r.contact} {r.phone}</span></> },
        { key: 't', header: 'Délai de paiement', align: 'right', render: (r: any) => (r.paymentTermsDays ? `${r.paymentTermsDays} ${t('jours')}` : '—') },
        { key: 'b', header: 'Dette', align: 'right', render: (r: any) => (r.balance > 0 ? <b className="text-red-600">{money(r.balance)}</b> : <span className="text-ink-300">—</span>) }]} />
      {edit && <SupplierForm initial={edit} onClose={() => setEdit(null)} />}
      {view && <SupplierView id={view} canEdit={canEdit} onClose={() => setView(null)} onEdit={(s) => { setView(null); setEdit(s); }} />}
    </Card>
  );
}

function SupplierForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const { t } = useT();
  const [f, setF] = useState<any>({ name: '', contact: '', phone: '', email: '', address: '', taxId: '', paymentTermsDays: 0, notes: '', ...initial });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const m = useM('suppliers.save', { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={f.id ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!f.name.trim()} onClick={() => m.mutate({ id: f.id, name: f.name, contact: f.contact, phone: f.phone, email: f.email, address: f.address, taxId: f.taxId, paymentTermsDays: Number(f.paymentTermsDays) || 0, notes: f.notes }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Raison sociale" className="md:col-span-2"><Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Contact"><Input value={f.contact ?? ''} onChange={(e) => set('contact', e.target.value)} /></Field><Field label="Téléphone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="E-mail"><Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field><Field label="NIF"><Input value={f.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} /></Field>
        <Field label="Adresse" className="md:col-span-2"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Délai de paiement (jours)"><Input type="number" min={0} value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} /></Field>
        <Field label="Notes" className="md:col-span-2"><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div><div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function SupplierView({ id, canEdit, onClose, onEdit }: { id: string; canEdit: boolean; onClose: () => void; onEdit: (s: any) => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const { data: s } = useQ('suppliers.get', { id });
  const [pay, setPay] = useState(false);
  if (!s) return null;
  return (
    <Modal open onClose={onClose} size="xl" title={s.name} footer={<>{canEdit && <Button onClick={() => onEdit(s)}>{t('Modifier')}</Button>}{can(['finance.manage', 'purchase.manage']) && s.balance > 0 && <Button variant="gold" icon={<Wallet className="size-4" />} onClick={() => setPay(true)}>{t('Payer le fournisseur')}</Button>}</>}>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Dette" value={money(s.balance)} tone={s.balance > 0 ? 'red' : 'neutral'} /><Kpi label="Délai de paiement" value={s.paymentTermsDays ? `${s.paymentTermsDays} j` : '—'} /><Kpi label="Contact" value={<span className="text-base">{s.contact || s.phone || '—'}</span>} /></div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div><h4 className="mb-2 text-sm font-semibold">{t('Commandes')}</h4><DataTable dense rowKey={(r: any) => r.id} rows={s.purchases as any[]} columns={[{ key: 'n', header: 'N°', render: (r: any) => r.number }, { key: 's', header: 'Statut', render: (r: any) => <StatusBadge status={r.status} /> }, { key: 't', header: 'Reçu', align: 'right', render: (r: any) => money(r.receivedTotal) }, { key: 'p', header: 'Payé', align: 'right', render: (r: any) => money(r.paidTotal) }]} /></div>
        <div><h4 className="mb-2 text-sm font-semibold">{t('Compte fournisseur')}</h4><DataTable dense rowKey={(r: any) => r.id} rows={s.ledger as any[]} columns={[{ key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'k', header: 'Opération', render: (r: any) => <Badge>{({ PURCHASE: t('Achat'), PAYMENT: t('Paiement'), RETURN: t('Retour'), ADJUSTMENT: t('Ajustement') } as any)[r.kind]}</Badge> }, { key: 'a', header: 'Montant', align: 'right', render: (r: any) => <span className={r.amount > 0 ? 'text-red-600' : 'text-emerald-600'}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</span> }]} /></div>
      </div>
      {pay && <SupplierPay supplier={s} onClose={() => setPay(false)} />}
    </Modal>
  );
}

function SupplierPay({ supplier, onClose }: { supplier: any; onClose: () => void }) {
  const { t } = useT();
  const methods = (useQ('ref.paymentMethods').data ?? []) as any[];
  const [amount, setAmount] = useState(supplier.balance);
  const [methodId, setMethodId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('suppliers.pay', { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Paiement fournisseur" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={amount <= 0 || !methodId} onClick={() => m.mutate({ supplierId: supplier.id, methodId, amount, note: note || undefined }, { onError: setErr })}>{t('Payer')}</Button></>}>
      <div className="space-y-3"><p className="text-sm text-ink-500">{t('Dette actuelle')} : <b className="text-red-600">{money(supplier.balance)}</b></p>
        <Field label="Montant (partiel possible)"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Payé depuis"><Select value={methodId} onChange={(e) => setMethodId(e.target.value)}><option value="">—</option>{methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Debts() {
  const { t } = useT();
  const { data } = useQ('finance.payables');
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []) as any[];
  return (
    <Card>
      <div className="grid grid-cols-2 gap-4 p-4"><Kpi label="Total dû aux fournisseurs" value={money(rows.reduce((a, r) => a + r.due, 0))} tone="red" /><Kpi label="En retard" value={money(rows.filter((r) => r.dueDate && r.dueDate < today).reduce((a, r) => a + r.due, 0))} tone="gold" /></div>
      <DataTable rowKey={(r: any) => r.id} rows={rows} columns={[{ key: 'n', header: 'Achat', render: (r: any) => r.number }, { key: 's', header: 'Fournisseur', render: (r: any) => r.supplierName }, { key: 'e', header: 'Échéance', render: (r: any) => (r.dueDate ? <Badge tone={r.dueDate < today ? 'red' : 'neutral'}>{dateOnly(r.dueDate)}</Badge> : '—') }, { key: 't', header: 'Total', align: 'right', render: (r: any) => money(r.total) }, { key: 'p', header: 'Payé', align: 'right', render: (r: any) => money(r.paidTotal) }, { key: 'd', header: 'Reste dû', align: 'right', render: (r: any) => <b>{money(r.due)}</b> }]} />
    </Card>
  );
}
void Money;
