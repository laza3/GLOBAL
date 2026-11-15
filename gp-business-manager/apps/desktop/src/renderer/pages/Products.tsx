import { useEffect, useState } from 'react';
import { ImagePlus, Plus, Tag, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, QtyInput, SearchInput, Select, Tabs, Textarea, Checkbox, Money, useToast } from '../components/ui';
import { call, system, useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateTime, money, pct, qty } from '../lib/format';

export function ProductsPage() {
  const { t } = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<'products' | 'categories' | 'brands'>('products');
  return (
    <>
      <PageHeader title="Produits" subtitle="Catalogue, variantes, prix, codes-barres et marges" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'products', label: 'Produits' }, { id: 'categories', label: 'Catégories' }, { id: 'brands', label: 'Marques' }]} />
      {tab === 'products' && <ProductList canEdit={can('product.manage')} />}
      {tab === 'categories' && <Categories canEdit={can('product.manage')} />}
      {tab === 'brands' && <Brands canEdit={can('product.manage')} />}
    </>
  );
}

function ProductList({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [categoryId, setCat] = useState('');
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const cats = (useQ('catalog.categories').data ?? []) as any[];
  const { data } = useQ('products.list', { q, categoryId: categoryId || undefined, limit: 500 }, { placeholderData: (p) => p });
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchInput className="w-80" value={q} onChange={setQ} placeholder="Nom, SKU, code-barres…" />
          <Select className="w-52" value={categoryId} onChange={(e) => setCat(e.target.value)}><option value="">{t('Toutes les catégories')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentName ? `${c.parentName} › ` : ''}{c.name}</option>)}</Select>
          <span className="text-sm text-ink-400">{data?.total ?? 0} {t('produit(s)')}</span>
          {canEdit && <Button className="ml-auto" variant="gold" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>{t('Nouveau produit')}</Button>}
        </div>
        <DataTable rowKey={(r: any) => r.id} onRowClick={canEdit ? (r: any) => setEdit(r.id) : undefined} rows={(data?.rows ?? []) as any[]} columns={[
          { key: 'i', header: '', width: '3rem', render: (r: any) => <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-ink-50 text-ink-300 dark:bg-white/5">{r.image ? <img src={r.image} alt="" className="size-full object-cover" /> : <Tag className="size-4" />}</span> },
          { key: 'n', header: 'Produit', render: (r: any) => <><span className="font-medium">{r.name}</span> {!r.active && <Badge>{t('Inactif')}</Badge>}<span className="block text-xs text-ink-400">{r.sku}{r.variantCount > 1 ? ` · ${r.variantCount} ${t('variantes')}` : ''}</span></> },
          { key: 'c', header: 'Catégorie', render: (r: any) => <span className="text-ink-500">{r.categoryName ?? '—'}{r.brandName ? ` · ${r.brandName}` : ''}</span> },
          { key: 'p', header: 'Prix', align: 'right', render: (r: any) => (r.minPrice === r.maxPrice ? money(r.minPrice) : `${money(r.minPrice)} – ${money(r.maxPrice)}`) },
          { key: 'm', header: 'Marge', align: 'right', render: (r: any) => <span className={r.marginBp < 0 ? 'text-red-500' : 'text-ink-500'}>{pct(r.marginBp)}</span> },
          { key: 's', header: 'Stock', align: 'right', render: (r: any) => (r.trackStock ? <span className={r.stockMilli <= 0 ? 'font-semibold text-red-500' : ''}>{qty(r.stockMilli)} {r.unit ?? ''}</span> : <span className="text-ink-300">—</span>) },
        ]} />
      </Card>
      {edit && <ProductForm id={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

interface V { id?: string; sku: string; name: string; size: string; color: string; costPrice: number; price: number; wholesalePrice: number | null; promoPrice: number | null; promoStart: string; promoEnd: string; alertQtyMilli: number; barcodes: string; active: boolean; openingQtyMilli: number; priceHistory?: any[]; stock?: any[] }
const emptyV = (): V => ({ sku: '', name: '', size: '', color: '', costPrice: 0, price: 0, wholesalePrice: null, promoPrice: null, promoStart: '', promoEnd: '', alertQtyMilli: 0, barcodes: '', active: true, openingQtyMilli: 0 });

function ProductForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const { data: loaded } = useQ('products.get', id ? { id } : (undefined as any), { enabled: !!id });
  const cats = (useQ('catalog.categories').data ?? []) as any[];
  const brands = (useQ('catalog.brands').data ?? []) as any[];
  const units = (useQ('ref.units').data ?? []) as any[];
  const taxes = (useQ('ref.taxRates').data ?? []) as any[];
  const [p, setP] = useState<any>({ name: '', description: '', categoryId: '', brandId: '', unitId: '', taxRateId: '', trackStock: true, trackLots: false, image: null, active: true });
  const [vs, setVs] = useState<V[]>([emptyV()]);
  const [err, setErr] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const [hist, setHist] = useState<V | null>(null);
  useEffect(() => {
    if (!loaded) return;
    setP({ name: loaded.name, description: loaded.description ?? '', categoryId: loaded.categoryId ?? '', brandId: loaded.brandId ?? '', unitId: loaded.unitId ?? '', taxRateId: loaded.taxRateId ?? '', trackStock: loaded.trackStock, trackLots: loaded.trackLots, image: loaded.image, active: loaded.active });
    setVs(loaded.variants.map((v: any) => ({ ...v, sku: v.sku ?? '', name: v.name ?? '', size: v.size ?? '', color: v.color ?? '', promoStart: v.promoStart ?? '', promoEnd: v.promoEnd ?? '', barcodes: v.barcodes.join(', '), openingQtyMilli: 0 })));
  }, [loaded]);
  const setV = (i: number, patch: Partial<V>) => setVs((c) => c.map((v, k) => (k === i ? { ...v, ...patch } : v)));
  const m = useM('products.save', { onSuccess: () => { push('success', t('Produit enregistré')); onClose(); } });
  const rm = useM('products.delete', { onSuccess: onClose });
  const save = () => m.mutate({
    id, name: p.name, description: p.description || undefined, categoryId: p.categoryId || undefined, brandId: p.brandId || undefined, unitId: p.unitId || undefined, taxRateId: p.taxRateId || undefined,
    trackStock: p.trackStock, trackLots: p.trackLots, image: p.image, active: p.active,
    variants: vs.map((v) => ({ id: v.id, sku: v.sku || undefined, name: v.name || undefined, size: v.size || undefined, color: v.color || undefined, costPrice: v.costPrice, price: v.price, wholesalePrice: v.wholesalePrice ?? undefined, promoPrice: v.promoPrice ?? undefined, promoStart: v.promoStart || undefined, promoEnd: v.promoEnd || undefined, alertQtyMilli: v.alertQtyMilli, active: v.active, barcodes: v.barcodes.split(/[,;\s]+/).filter(Boolean), openingQtyMilli: !v.id && v.openingQtyMilli > 0 ? v.openingQtyMilli : undefined })),
  }, { onError: setErr });
  const pickImage = async () => { try { const d = await system('pickImage'); if (d) setP((x: any) => ({ ...x, image: d })); } catch (e) { push('error', (e as Error).message); } };
  const unit = units.find((u) => u.id === p.unitId);
  return (
    <Modal open onClose={onClose} size="xl" title={id ? 'Modifier le produit' : 'Nouveau produit'} footer={<>
      {id && <Button variant="ghost" className="mr-auto" onClick={() => setDel(true)} icon={<Trash2 className="size-4" />}>{t('Supprimer')}</Button>}
      <Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={!p.name.trim() || vs.some((v) => v.price <= 0 && false)} onClick={save}>{t('Enregistrer')}</Button></>}>
      <div className="grid gap-4 lg:grid-cols-[11rem_1fr]">
        <button onClick={pickImage} className="group relative grid aspect-square place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50 text-ink-400 hover:border-gold-400 dark:border-white/10 dark:bg-white/5">
          {p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus className="size-6" />{t('Image')}</span>}
          {p.image && <span onClick={(e) => { e.stopPropagation(); setP({ ...p, image: null }); }} className="absolute right-1 top-1 rounded-md bg-black/60 px-1.5 text-xs text-white">✕</span>}
        </button>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nom du produit" className="md:col-span-3"><Input autoFocus value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Catégorie"><Select value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentName ? `${c.parentName} › ` : ''}{c.name}</option>)}</Select></Field>
          <Field label="Marque"><Select value={p.brandId} onChange={(e) => setP({ ...p, brandId: e.target.value })}><option value="">—</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Unité"><Select value={p.unitId} onChange={(e) => setP({ ...p, unitId: e.target.value })}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Taxe"><Select value={p.taxRateId} onChange={(e) => setP({ ...p, taxRateId: e.target.value })}><option value="">{t('Par défaut')}</option>{taxes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <div className="flex flex-col justify-end gap-2"><Checkbox checked={p.trackStock} onChange={(v) => setP({ ...p, trackStock: v })} label="Suivre le stock" />{p.trackStock && <Checkbox checked={p.trackLots} onChange={(v) => setP({ ...p, trackLots: v })} label="Lots et dates d’expiration" />}</div>
          <div className="flex flex-col justify-end"><Checkbox checked={p.active} onChange={(v) => setP({ ...p, active: v })} label="Produit actif (vendable)" /></div>
          <Field label="Description" className="md:col-span-3"><Textarea rows={2} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('Variantes & prix')}</h3><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setVs((c) => [...c, emptyV()])}>{t('Ajouter une variante')}</Button></div>
      <div className="mt-2 space-y-3">
        {vs.map((v, i) => {
          const margin = v.price > 0 ? Math.round(((v.price - v.costPrice) * 10000) / v.price) : 0;
          return (
            <div key={v.id ?? i} className="rounded-2xl border border-ink-100 p-3 dark:border-white/10">
              <div className="grid gap-3 md:grid-cols-6">
                <Field label="Libellé variante" className="md:col-span-2"><Input value={v.name} placeholder={t('ex. Grand modèle')} onChange={(e) => setV(i, { name: e.target.value })} /></Field>
                <Field label="Taille"><Input value={v.size} onChange={(e) => setV(i, { size: e.target.value })} /></Field>
                <Field label="Couleur"><Input value={v.color} onChange={(e) => setV(i, { color: e.target.value })} /></Field>
                <Field label="SKU" hint="Auto si vide"><Input value={v.sku} onChange={(e) => setV(i, { sku: e.target.value })} /></Field>
                <Field label="Codes-barres" hint="Séparés par une virgule"><Input value={v.barcodes} onChange={(e) => setV(i, { barcodes: e.target.value })} /></Field>
                <Field label="Prix d’achat"><MoneyInput value={v.costPrice} onChange={(x) => setV(i, { costPrice: x })} /></Field>
                <Field label={`Prix de vente ${loaded ? '' : ''}`} hint={`${t('Marge')} ${pct(margin)}`}><MoneyInput value={v.price} onChange={(x) => setV(i, { price: x })} /></Field>
                <Field label="Prix de gros"><MoneyInput value={v.wholesalePrice} onChange={(x) => setV(i, { wholesalePrice: x || null })} /></Field>
                <Field label="Prix promo"><MoneyInput value={v.promoPrice} onChange={(x) => setV(i, { promoPrice: x || null })} /></Field>
                <Field label="Promo du"><Input type="date" value={v.promoStart} onChange={(e) => setV(i, { promoStart: e.target.value })} /></Field>
                <Field label="Promo au"><Input type="date" value={v.promoEnd} onChange={(e) => setV(i, { promoEnd: e.target.value })} /></Field>
                {p.trackStock && <Field label={`Seuil d’alerte ${unit ? `(${unit.code})` : ''}`}><QtyInput value={v.alertQtyMilli} onChange={(x) => setV(i, { alertQtyMilli: x })} /></Field>}
                {p.trackStock && !v.id && <Field label="Stock initial"><QtyInput value={v.openingQtyMilli} onChange={(x) => setV(i, { openingQtyMilli: x })} /></Field>}
                {v.id && <div className="flex items-end gap-2 md:col-span-2">{v.stock && <span className="pb-2 text-xs text-ink-400">{t('Stock')} : {qty(v.stock.reduce((a: number, s: any) => a + s.qtyMilli, 0))}</span>}<Button size="sm" variant="ghost" onClick={() => setHist(v)}>{t('Historique des prix')}</Button></div>}
                {vs.length > 1 && <div className="flex items-end justify-end md:col-span-6"><Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setVs((c) => c.filter((_, k) => k !== i))}>{t('Retirer cette variante')}</Button></div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
      <ConfirmDialog open={del} danger title="Supprimer le produit" message="Le produit sera archivé : son historique de ventes est conservé, il ne sera plus vendable." confirmLabel="Supprimer" onClose={() => setDel(false)} onConfirm={() => id && rm.mutate({ id })} />
      {hist && <Modal open onClose={() => setHist(null)} title="Historique des prix" size="md"><DataTable dense rowKey={(r: any) => r.at + r.field} rows={hist.priceHistory ?? []} columns={[{ key: 'a', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'f', header: 'Champ', render: (r: any) => ({ cost_price: t("Prix d'achat"), price: t('Prix de vente'), wholesale_price: t('Prix de gros'), promo_price: t('Prix promo') } as any)[r.field] ?? r.field }, { key: 'o', header: 'Avant', align: 'right', render: (r: any) => money(r.oldValue) }, { key: 'n', header: 'Après', align: 'right', render: (r: any) => money(r.newValue) }, { key: 'u', header: 'Par', render: (r: any) => r.userName }]} /></Modal>}
    </Modal>
  );
}

function Categories({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const { data } = useQ('catalog.categories');
  const [edit, setEdit] = useState<any | null>(null);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const save = useM('catalog.saveCategory', { onSuccess: () => setEdit(null) });
  const del = useM('catalog.deleteCategory');
  const { push } = useToast();
  const rows = (data ?? []) as any[];
  return (
    <Card>
      <div className="flex justify-end p-4">{canEdit && <Button variant="gold" icon={<Plus className="size-4" />} onClick={() => { setEdit({}); setName(''); setParent(''); }}>{t('Nouvelle catégorie')}</Button>}</div>
      <DataTable rowKey={(r: any) => r.id} rows={rows} columns={[
        { key: 'n', header: 'Catégorie', render: (r: any) => <span className={r.parentId ? 'pl-6 text-ink-600' : 'font-medium'}>{r.parentId ? '↳ ' : ''}{r.name}</span> },
        { key: 'c', header: 'Produits', align: 'right', render: (r: any) => r.productCount },
        { key: 'a', header: '', align: 'right', render: (r: any) => canEdit && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => { setEdit(r); setName(r.name); setParent(r.parentId ?? ''); }}>{t('Modifier')}</Button><Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id }, { onError: (e) => push('error', e.message) })}><Trash2 className="size-4" /></Button></div> },
      ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'} size="sm" footer={<><Button onClick={() => setEdit(null)}>{t('Annuler')}</Button><Button variant="primary" disabled={!name.trim()} onClick={() => save.mutate({ id: edit.id, name, parentId: parent || undefined }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
        <div className="space-y-3"><Field label="Nom"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Catégorie parente (sous-catégorie)"><Select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">—</option>{rows.filter((c) => !c.parentId && c.id !== edit?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><ErrorBox error={err} /></div>
      </Modal>
    </Card>
  );
}

function Brands({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const { push } = useToast();
  const { data } = useQ('catalog.brands');
  const [name, setName] = useState('');
  const save = useM('catalog.saveBrand', { onSuccess: () => setName('') });
  const del = useM('catalog.deleteBrand');
  return (
    <Card className="max-w-xl">
      {canEdit && <div className="flex gap-2 p-4"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nouvelle marque')} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save.mutate({ name })} /><Button variant="gold" disabled={!name.trim()} onClick={() => save.mutate({ name })} icon={<Plus className="size-4" />}>{t('Ajouter')}</Button></div>}
      <DataTable rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[{ key: 'n', header: 'Marque', render: (r: any) => r.name }, { key: 'a', header: '', align: 'right', render: (r: any) => canEdit && <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: r.id }, { onError: (e) => push('error', e.message) })}><Trash2 className="size-4" /></Button> }]} />
    </Card>
  );
}
void call; void Money;
