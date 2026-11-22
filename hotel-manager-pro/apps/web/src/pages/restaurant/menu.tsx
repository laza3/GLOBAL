import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTaxRules } from '../../api/billing';
import { useMenu, useSaveCategory, useSaveProduct, type MenuCategory, type Product } from '../../api/restaurant';
import { useCan } from '../../auth/session';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select, Switch } from '../../ui/form';
import { Panel } from '../../ui/page';

function CategoryModal({ category, onClose }: { category: MenuCategory | null; onClose: () => void }) {
  const save = useSaveCategory();
  const [name, setName] = useState(category?.name ?? '');
  const [active, setActive] = useState(category?.isActive ?? true);
  return (
    <ActionModal title={category ? `Modifier « ${category.name} »` : 'Nouvelle catégorie'} confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => (name.trim().length < 2 ? 'Donnez un nom à la catégorie.' : save.mutateAsync({ id: category?.id, body: category ? { name: name.trim(), isActive: active } : { name: name.trim() } }).then(() => void toast.success('Catégorie enregistrée.')))}>
      <Field label="Nom" required>{(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Entrées, plats, boissons…" autoFocus />}</Field>
      {category && <Switch label="Visible à la carte" checked={active} onCheckedChange={setActive} />}
    </ActionModal>
  );
}

function ProductModal({ product, categories, onClose }: { product: Product | null; categories: MenuCategory[]; onClose: () => void }) {
  const currency = useCurrency();
  const taxes = useTaxRules();
  const save = useSaveProduct();
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? moneyInputValue(product.price, currency) : '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? 'none');
  const [taxRuleId, setTaxRuleId] = useState(product?.taxRuleId ?? 'none');
  const [active, setActive] = useState(product?.isActive ?? true);
  const usable = (taxes.data ?? []).filter((t) => t.isActive && t.kind === 'percentage');
  return (
    <ActionModal title={product ? `Modifier « ${product.name} »` : 'Nouveau plat'} description="Les additions déjà saisies gardent l'ancien prix et l'ancien nom." confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return 'Donnez un nom au plat.';
        const p = parseMoneyInput(price, currency);
        if (p === null) return 'Prix invalide.';
        return save.mutateAsync({ id: product?.id, body: { name: name.trim(), description: description.trim() || null, price: p, categoryId: categoryId === 'none' ? null : categoryId, taxRuleId: taxRuleId === 'none' ? null : taxRuleId, isActive: active } }).then(() => void toast.success('Plat enregistré.'));
      }}>
      <Field label="Nom" required>{(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Prix (${currency})`} required>{(c) => <Input {...c} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Catégorie">{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} options={[{ value: 'none', label: 'Sans catégorie' }, ...categories.map((x) => ({ value: x.id, label: x.name }))]} />}</Field>
      </div>
      {usable.length > 0 && <Field label="Taxe" hint="Définie dans Facturation › Taxes et paiements.">{(c) => <Select {...c} value={taxRuleId} onValueChange={setTaxRuleId} options={[{ value: 'none', label: 'Sans taxe' }, ...usable.map((t) => ({ value: t.id, label: `${t.name} (${((t.rateBps ?? 0) / 100).toLocaleString('fr-FR')} %${t.isInclusive ? ', incluse' : ''})` }))]} />}</Field>}
      <Field label="Description (facultatif)">{(c) => <Input {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}</Field>
      <Switch label="À la carte" description="Désactivé : le plat n'est plus proposé pour les nouvelles commandes." checked={active} onCheckedChange={setActive} />
    </ActionModal>
  );
}

export default function MenuPage() {
  useDocumentTitle('Carte du restaurant');
  const can = useCan();
  const currency = useCurrency();
  const menu = useMenu(true);
  const [cat, setCat] = useState<MenuCategory | 'new' | null>(null);
  const [prod, setProd] = useState<Product | 'new' | null>(null);
  const manage = can('restaurant:manage');
  const categories = menu.data?.categories ?? [];
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';
  return (
    <>
      <Panel title="Catégories" actions={manage ? <Button variant="secondary" onClick={() => setCat('new')}><Plus aria-hidden className="size-4" />Nouvelle catégorie</Button> : undefined}>
        {categories.length === 0 ? <p className="text-[14px] text-ink-2">Aucune catégorie. Regroupez vos plats (entrées, plats, boissons…) pour les retrouver plus vite.</p> : (
          <ul className="flex flex-wrap gap-2" aria-label="Catégories">
            {categories.map((c) => <li key={c.id}><button type="button" disabled={!manage} onClick={() => setCat(c)} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full bg-silver-soft px-4 text-[14px] text-ink disabled:cursor-default" aria-label={`Modifier la catégorie ${c.name}`}>{c.name}{!c.isActive && <Badge>Masquée</Badge>}</button></li>)}
          </ul>
        )}
      </Panel>
      <Panel title="Plats et boissons" actions={manage ? <Button variant="primary" onClick={() => setProd('new')}><Plus aria-hidden className="size-4" />Nouveau plat</Button> : undefined}>
        <DataTable<Product>
          caption="Plats et boissons"
          loading={menu.isPending}
          rows={menu.data?.products ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Plat', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.name}</span>{r.description && <span className="text-[13px] text-ink-2">{r.description}</span>}</span>, sortValue: (r) => r.name },
            { key: 'c', header: 'Catégorie', cell: (r) => catName(r.categoryId) },
            { key: 'p', header: 'Prix', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.price, currency)}</span>, sortValue: (r) => r.price },
            { key: 't', header: 'Taxe', cell: (r) => r.taxName ?? '—' },
            { key: 's', header: 'État', cell: (r) => (r.isActive ? <StateBadge tone="success">À la carte</StateBadge> : <Badge>Retiré</Badge>) },
            { key: 'a', header: 'Actions', cell: (r) => (manage ? <Button size="sm" variant="secondary" onClick={() => setProd(r)} aria-label={`Modifier ${r.name}`}>Modifier</Button> : null) },
          ]}
          mobileCard={(r) => <div className="flex items-center justify-between gap-3"><span className="flex flex-col"><span className="font-medium text-ink">{r.name}</span><span className="num-col text-[13px] text-ink-2">{formatMoney(r.price, currency)}</span></span>{manage && <Button size="sm" variant="secondary" onClick={() => setProd(r)}>Modifier</Button>}</div>}
          empty={<EmptyState kind="key" title="La carte est vide" description="Ajoutez vos plats et boissons avec leur prix : ils seront proposés à la prise de commande." action={manage ? <Button variant="primary" onClick={() => setProd('new')}>Ajouter un plat</Button> : undefined} />}
        />
      </Panel>
      {cat && <CategoryModal category={cat === 'new' ? null : cat} onClose={() => setCat(null)} />}
      {prod && <ProductModal product={prod === 'new' ? null : prod} categories={categories.filter((c) => c.isActive)} onClose={() => setProd(null)} />}
    </>
  );
}
