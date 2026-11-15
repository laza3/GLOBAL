import { useState } from 'react';
import { ArrowLeftRight, ClipboardList, PackageMinus, PackagePlus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Modal, MoneyInput, PageHeader, QtyInput, SearchInput, Select, StatusBadge, Tabs, Checkbox, Money, useToast } from '../components/ui';
import { VariantPicker, type PickedVariant } from '../components/VariantPicker';
import { useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateOnly, dateTime, money, parseQty, qty, qtyToInput } from '../lib/format';

const MV: Record<string, [string, 'green' | 'red' | 'blue' | 'gold' | 'neutral']> = {
  IN: ['Entrée', 'green'], OUT: ['Sortie', 'red'], SALE: ['Vente', 'blue'], RETURN_IN: ['Retour client', 'green'], PURCHASE: ['Achat', 'green'], PURCHASE_RETURN: ['Retour fournisseur', 'red'],
  TRANSFER_IN: ['Transfert +', 'gold'], TRANSFER_OUT: ['Transfert −', 'gold'], ADJUSTMENT: ['Ajustement', 'neutral'], INVENTORY: ['Inventaire', 'neutral'], LOSS: ['Perte', 'red'], DAMAGED: ['Endommagé', 'red'], OPENING: ['Stock initial', 'neutral'],
};

export function StockPage() {
  const { t } = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<'levels' | 'movements' | 'transfers' | 'inventory' | 'expiry'>('levels');
  const wh = (useQ('org.warehouses').data ?? []) as any[];
  const [warehouseId, setWarehouse] = useState('');
  const [adjust, setAdjust] = useState<null | 'IN' | 'OUT' | 'LOSS' | 'DAMAGED' | 'ADJUSTMENT'>(null);
  const [transfer, setTransfer] = useState(false);
  const val = useQ('stock.valuation', { warehouseId: warehouseId || undefined });
  const low = useQ('stock.levels', { warehouseId: warehouseId || undefined, lowOnly: true, limit: 1000 });
  return (
    <>
      <PageHeader title="Stocks" subtitle="Niveaux, mouvements, transferts, inventaires et lots"
        actions={<>
          <Select value={warehouseId} onChange={(e) => setWarehouse(e.target.value)} className="w-52"><option value="">{t('Tous les entrepôts')}</option>{wh.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          {can('stock.adjust') && <><Button onClick={() => setAdjust('IN')} icon={<PackagePlus className="size-4" />}>{t('Entrée')}</Button><Button onClick={() => setAdjust('OUT')} icon={<PackageMinus className="size-4" />}>{t('Sortie / perte')}</Button></>}
          {can('stock.transfer') && <Button variant="gold" onClick={() => setTransfer(true)} icon={<ArrowLeftRight className="size-4" />}>{t('Transfert')}</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi label="Valeur du stock (coût moyen)" value={money(val.data?.value ?? 0)} tone="gold" /><Kpi label="Quantité totale" value={qty(val.data?.qty ?? 0)} /><Kpi label="Articles en alerte / rupture" value={(low.data as any[] | undefined)?.length ?? 0} tone={(low.data as any[] | undefined)?.length ? 'red' : 'green'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'levels', label: 'Niveaux de stock' }, { id: 'movements', label: 'Mouvements' }, { id: 'transfers', label: 'Transferts' }, ...(can('inventory.manage') ? [{ id: 'inventory' as const, label: 'Inventaires' }] : []), { id: 'expiry', label: 'Péremptions' }]} />
      {tab === 'levels' && <Levels warehouseId={warehouseId} />}
      {tab === 'movements' && <Movements warehouseId={warehouseId} />}
      {tab === 'transfers' && <Transfers />}
      {tab === 'inventory' && <Inventories />}
      {tab === 'expiry' && <Expiry />}
      {adjust && <AdjustModal initial={adjust} warehouses={wh} warehouseId={warehouseId} onClose={() => setAdjust(null)} />}
      {transfer && <TransferModal warehouses={wh} onClose={() => setTransfer(false)} />}
    </>
  );
}

function Levels({ warehouseId }: { warehouseId: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [lowOnly, setLow] = useState(false);
  const { data } = useQ('stock.levels', { warehouseId: warehouseId || undefined, q: q || undefined, lowOnly, limit: 1000 }, { placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 p-4"><SearchInput className="w-72" value={q} onChange={setQ} placeholder="Article, SKU, code-barres…" /><Checkbox checked={lowOnly} onChange={setLow} label="Alertes uniquement" /></div>
      <DataTable rowKey={(r: any) => r.variantId + r.warehouseId} rows={(data ?? []) as any[]} columns={[
        { key: 'n', header: 'Article', render: (r: any) => <><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-400">{r.sku}{r.categoryName ? ` · ${r.categoryName}` : ''}</span></> },
        { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName },
        { key: 'q', header: 'Quantité', align: 'right', render: (r: any) => <span className={r.qtyMilli <= 0 ? 'font-semibold text-red-500' : r.qtyMilli <= r.alertQtyMilli ? 'font-semibold text-gold-600' : ''}>{qty(r.qtyMilli)} {r.unit ?? ''}</span> },
        { key: 'a', header: 'Seuil', align: 'right', render: (r: any) => <span className="text-ink-400">{qty(r.alertQtyMilli)}</span> },
        { key: 'c', header: 'Coût moyen', align: 'right', render: (r: any) => money(r.avgCost) },
        { key: 'v', header: 'Valeur', align: 'right', render: (r: any) => <b>{money(r.value)}</b> },
      ]} />
    </Card>
  );
}

function Movements({ warehouseId }: { warehouseId: string }) {
  const { t } = useT();
  const [type, setType] = useState('');
  const { data } = useQ('stock.movements', { warehouseId: warehouseId || undefined, type: type || undefined, limit: 500 });
  return (
    <Card>
      <div className="p-4"><Select className="w-56" value={type} onChange={(e) => setType(e.target.value)}><option value="">{t('Tous les types')}</option>{Object.entries(MV).map(([k, [l]]) => <option key={k} value={k}>{t(l)}</option>)}</Select></div>
      <DataTable dense rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[
        { key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) },
        { key: 't', header: 'Type', render: (r: any) => <Badge tone={MV[r.type]?.[1]}>{t(MV[r.type]?.[0] ?? r.type)}</Badge> },
        { key: 'n', header: 'Article', render: (r: any) => <>{r.name}<span className="block text-xs text-ink-400">{r.sku}{r.lotNo ? ` · ${t('lot')} ${r.lotNo}` : ''}</span></> },
        { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName },
        { key: 'q', header: 'Quantité', align: 'right', render: (r: any) => <b className={r.qtyMilli > 0 ? 'text-emerald-600' : 'text-red-600'}>{r.qtyMilli > 0 ? '+' : ''}{qty(r.qtyMilli)}</b> },
        { key: 'r', header: 'Motif', render: (r: any) => <span className="text-ink-500">{r.reason ?? ''}</span> },
        { key: 'u', header: 'Par', render: (r: any) => <span className="text-ink-400">{r.userName}</span> },
      ]} />
    </Card>
  );
}

function Transfers() {
  const { data } = useQ('stock.transfers');
  return <Card><DataTable rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[
    { key: 'n', header: 'N°', render: (r: any) => <b>{r.number}</b> }, { key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'f', header: 'De', render: (r: any) => r.fromName }, { key: 't', header: 'Vers', render: (r: any) => r.toName },
    { key: 'l', header: 'Lignes', align: 'right', render: (r: any) => r.lines }, { key: 'u', header: 'Par', render: (r: any) => r.userName }]} /></Card>;
}

function Expiry() {
  const { t } = useT();
  const { data } = useQ('stock.expiring', { days: 90 });
  const today = new Date().toISOString().slice(0, 10);
  return <Card><DataTable rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} empty={<div className="p-10 text-center text-sm text-ink-400">{t('Aucun lot n’expire dans les 90 prochains jours.')}</div>} columns={[
    { key: 'n', header: 'Article', render: (r: any) => <>{r.name}<span className="block text-xs text-ink-400">{r.sku}</span></> }, { key: 'l', header: 'Lot', render: (r: any) => r.lotNo }, { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName },
    { key: 'q', header: 'Quantité', align: 'right', render: (r: any) => qty(r.qtyMilli) }, { key: 'e', header: 'Expiration', align: 'right', render: (r: any) => <Badge tone={r.expiryDate < today ? 'red' : 'gold'}>{dateOnly(r.expiryDate)}</Badge> }]} /></Card>;
}

function AdjustModal({ initial, warehouses, warehouseId, onClose }: { initial: string; warehouses: any[]; warehouseId: string; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const [type, setType] = useState(initial);
  const [wh, setWh] = useState(warehouseId || warehouses[0]?.id);
  const [v, setV] = useState<PickedVariant | null>(null);
  const [q, setQ] = useState(0);
  const [cost, setCost] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [lot, setLot] = useState('');
  const [exp, setExp] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('stock.adjust', { onSuccess: () => { push('success', t('Mouvement enregistré')); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Mouvement de stock" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!v || q === 0} onClick={() => m.mutate({ warehouseId: wh, variantId: v!.variantId, type: type as any, qtyMilli: q, reason: reason || undefined, unitCost: type === 'IN' && cost ? cost : undefined, lotNo: lot || undefined, expiryDate: exp || undefined }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="IN">{t('Entrée de stock')}</option><option value="OUT">{t('Sortie de stock')}</option><option value="LOSS">{t('Perte / vol / casse')}</option><option value="DAMAGED">{t('Produit endommagé')}</option><option value="ADJUSTMENT">{t('Ajustement (+/−)')}</option></Select></Field>
        <Field label="Entrepôt"><Select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Article" className="md:col-span-2">{v ? <div className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2 text-sm dark:bg-white/5"><span><b>{v.name}</b> <span className="text-ink-400">{v.sku}</span></span><button className="text-xs underline" onClick={() => setV(null)}>{t('Changer')}</button></div> : <VariantPicker autoFocus warehouseId={wh} onPick={setV} />}</Field>
        <Field label={type === 'ADJUSTMENT' ? 'Quantité (négative pour retirer)' : 'Quantité'}><Input inputMode="decimal" value={q ? qtyToInput(q) : ''} onChange={(e) => setQ(parseQty(e.target.value))} /></Field>
        {type === 'IN' && <Field label="Coût unitaire" hint="Met à jour le coût moyen pondéré"><MoneyInput value={cost} onChange={setCost} /></Field>}
        {type === 'IN' && <Field label="N° de lot"><Input value={lot} onChange={(e) => setLot(e.target.value)} /></Field>}
        {type === 'IN' && <Field label="Date d’expiration"><Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>}
        <Field label={['OUT', 'LOSS', 'DAMAGED'].includes(type) ? 'Motif (obligatoire)' : 'Motif'} className="md:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function TransferModal({ warehouses, onClose }: { warehouses: any[]; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const [from, setFrom] = useState(warehouses[0]?.id ?? '');
  const [to, setTo] = useState(warehouses[1]?.id ?? '');
  const [items, setItems] = useState<{ v: PickedVariant; q: number }[]>([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('stock.transfer', { onSuccess: (r) => { push('success', `${t('Transfert')} ${r.number}`); onClose(); } });
  return (
    <Modal open onClose={onClose} size="lg" title="Transfert entre entrepôts" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!items.length || from === to || items.some((i) => i.q <= 0)} onClick={() => m.mutate({ fromWarehouseId: from, toWarehouseId: to, note: note || undefined, items: items.map((i) => ({ variantId: i.v.variantId, qtyMilli: i.q })) }, { onError: setErr })}>{t('Transférer')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Depuis"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field><Field label="Vers"><Select value={to} onChange={(e) => setTo(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field></div>
      {warehouses.length < 2 && <p className="mt-2 text-sm text-gold-600">{t('Créez un second entrepôt dans Administration → Organisation.')}</p>}
      <div className="mt-4"><VariantPicker warehouseId={from} placeholder="Ajouter un article…" onPick={(v) => setItems((c) => (c.some((x) => x.v.variantId === v.variantId) ? c : [...c, { v, q: 1000 }]))} /></div>
      <ul className="mt-3 space-y-2">{items.map((it, i) => <li key={it.v.variantId} className="flex items-center gap-3 rounded-xl bg-ink-50 p-2 dark:bg-white/5"><span className="min-w-0 flex-1 truncate text-sm">{it.v.name}<span className="ml-2 text-xs text-ink-400">{t('dispo')} {qty(it.v.stockMilli)}</span></span><QtyInput className="w-28" value={it.q} onChange={(q) => setItems((c) => c.map((x, k) => (k === i ? { ...x, q } : x)))} /><button onClick={() => setItems((c) => c.filter((_, k) => k !== i))} className="text-ink-400 hover:text-red-500"><Trash2 className="size-4" /></button></li>)}</ul>
      <Field label="Note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Inventories() {
  const { t } = useT();
  const { data } = useQ('inventory.list');
  const wh = (useQ('org.warehouses').data ?? []) as any[];
  const cats = (useQ('catalog.categories').data ?? []) as any[];
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ warehouseId: '', categoryId: '' });
  const [err, setErr] = useState<unknown>(null);
  const m = useM('inventory.create', { onSuccess: (r) => { setCreate(false); setOpen(r.id); } });
  return (
    <Card>
      <div className="flex justify-end p-4"><Button variant="gold" icon={<ClipboardList className="size-4" />} onClick={() => { setF({ warehouseId: wh[0]?.id ?? '', categoryId: '' }); setCreate(true); }}>{t('Nouvel inventaire')}</Button></div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setOpen(r.id)} rows={(data ?? []) as any[]} columns={[
        { key: 'n', header: 'N°', render: (r: any) => <b>{r.number}</b> }, { key: 'd', header: 'Créé le', render: (r: any) => dateTime(r.createdAt) }, { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName },
        { key: 'p', header: 'Progression', align: 'right', render: (r: any) => `${r.counted} / ${r.lines}` }, { key: 's', header: 'Statut', render: (r: any) => <StatusBadge status={r.status} /> }]} />
      <Modal open={create} onClose={() => setCreate(false)} title="Nouvel inventaire" size="sm" footer={<><Button onClick={() => setCreate(false)}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate({ warehouseId: f.warehouseId, categoryId: f.categoryId || undefined }, { onError: setErr })}>{t('Créer')}</Button></>}>
        <div className="space-y-3"><Field label="Entrepôt"><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{wh.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field><Field label="Catégorie (optionnel)"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">{t('Toutes')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><ErrorBox error={err} /></div>
      </Modal>
      {open && <InventoryView id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function InventoryView({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const { data: inv } = useQ('inventory.get', { id });
  const count = useM('inventory.count');
  const validate = useM('inventory.validate', { onSuccess: (r) => { push('success', t('{n} écart(s) régularisé(s)', { n: r.adjusted })); onClose(); } });
  if (!inv) return null;
  const locked = inv.status !== 'OPEN';
  return (
    <Modal open onClose={onClose} size="xl" title={`${t('Inventaire')} ${inv.number} — ${inv.warehouseName}`} footer={!locked && <><Button onClick={onClose}>{t('Fermer')}</Button><Button variant="gold" loading={validate.isPending} onClick={() => validate.mutate({ id })}>{t('Valider et régulariser les écarts')}</Button></>}>
      <p className="mb-3 text-sm text-ink-500">{t('Saisissez la quantité comptée. Les lignes laissées vides ne sont pas modifiées.')}</p>
      <DataTable dense rowKey={(r: any) => r.variantId} rows={inv.lines as any[]} columns={[
        { key: 'n', header: 'Article', render: (r: any) => <>{r.name}<span className="block text-xs text-ink-400">{r.sku}</span></> },
        { key: 'e', header: 'Théorique', align: 'right', render: (r: any) => qty(r.expectedMilli) },
        { key: 'c', header: 'Compté', align: 'right', width: '8rem', render: (r: any) => <Input className="h-8 text-right" disabled={locked} defaultValue={r.countedMilli == null ? '' : qtyToInput(r.countedMilli)} inputMode="decimal" onBlur={(e) => count.mutate({ inventoryId: id, variantId: r.variantId, countedMilli: e.target.value.trim() === '' ? null : parseQty(e.target.value) })} /> },
        { key: 'd', header: 'Écart', align: 'right', render: (r: any) => (r.countedMilli == null ? '' : <b className={r.countedMilli - r.expectedMilli === 0 ? 'text-ink-400' : r.countedMilli > r.expectedMilli ? 'text-emerald-600' : 'text-red-600'}>{r.countedMilli - r.expectedMilli > 0 ? '+' : ''}{qty(r.countedMilli - r.expectedMilli)}</b>) },
      ]} />
    </Modal>
  );
}
void Money;
