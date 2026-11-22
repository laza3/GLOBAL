import { formatMoney } from '@hmp/shared';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { usePaymentMethods } from '../../api/billing';
import { isApiError } from '../../api/client';
import { useDeleteExpense, useExpenseCategories, useExpenses, useSaveExpense, useSaveExpenseCategory, type Expense } from '../../api/finances';
import { useCan, useMe } from '../../auth/session';
import { formatDay } from '../../lib/format';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button, buttonVariants } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';

function ExpenseModal({ expense, today, onClose }: { expense: Expense | null; today: string; onClose: () => void }) {
  const currency = useCurrency();
  const cats = useExpenseCategories();
  const methods = usePaymentMethods();
  const save = useSaveExpense();
  const addCat = useSaveExpenseCategory();
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [supplier, setSupplier] = useState(expense?.supplier ?? '');
  const [amount, setAmount] = useState(expense ? moneyInputValue(expense.amount, currency) : '');
  const [incurredOn, setIncurredOn] = useState(expense?.incurredOn ?? today);
  const [paid, setPaid] = useState(expense?.paidOn != null);
  const [paidOn, setPaidOn] = useState(expense?.paidOn ?? today);
  const [methodCode, setMethodCode] = useState(expense?.methodCode ?? 'cash');
  const [newCat, setNewCat] = useState('');
  const active = (cats.data ?? []).filter((c) => c.isActive || c.id === expense?.categoryId);
  return (
    <ActionModal title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'} confirmLabel="Enregistrer" width="40rem" onClose={onClose}
      onSubmit={async () => {
        if (description.trim().length < 2) return 'Décrivez la dépense.';
        const value = parseMoneyInput(amount, currency);
        if (value === null || value < 1) return 'Montant invalide.';
        let category = categoryId;
        if (!category && newCat.trim().length >= 2) category = (await addCat.mutateAsync({ body: { name: newCat.trim() } }) as { id: string }).id;
        if (!category) return 'Choisissez une catégorie (ou créez-en une).';
        if (paid && paidOn < incurredOn) return 'Le paiement ne peut pas précéder la dépense.';
        return save.mutateAsync({ id: expense?.id, body: { categoryId: category, description: description.trim(), supplier: supplier.trim() || null, amount: value, incurredOn, paidOn: paid ? paidOn : null, methodCode: paid ? methodCode : null } }).then(() => void toast.success('Dépense enregistrée.'));
      }}>
      <Field label="Description" required>{(c) => <Input {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} autoFocus />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Montant (${currency})`} required>{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Date de la dépense" required>{(c) => <Input {...c} type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />}</Field>
        <Field label="Catégorie" required>{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} placeholder="Choisir" options={active.map((x) => ({ value: x.id, label: x.name }))} />}</Field>
        <Field label="Ou nouvelle catégorie" hint="Créée à l'enregistrement.">{(c) => <Input {...c} value={newCat} disabled={!!categoryId} onChange={(e) => setNewCat(e.target.value)} maxLength={60} />}</Field>
        <Field label="Fournisseur (facultatif)">{(c) => <Input {...c} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} />}</Field>
        <Field label="État">{(c) => <Select {...c} value={paid ? 'paid' : 'due'} onValueChange={(v) => setPaid(v === 'paid')} options={[{ value: 'due', label: 'À payer' }, { value: 'paid', label: 'Payée' }]} />}</Field>
        {paid && <Field label="Payée le">{(c) => <Input {...c} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>}
        {paid && <Field label="Payée par">{(c) => <Select {...c} value={methodCode} onValueChange={setMethodCode} options={(methods.data ?? []).map((m) => ({ value: m.code, label: m.label }))} />}</Field>}
      </div>
    </ActionModal>
  );
}

export default function ExpensesPage() {
  useDocumentTitle('Dépenses');
  const can = useCan();
  const me = useMe();
  const currency = useCurrency();
  const [params, setParams] = useSearchParams();
  const cats = useExpenseCategories();
  const del = useDeleteExpense();
  const status = params.get('status') ?? 'all';
  const category = params.get('category') ?? 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const query = { from: from || undefined, to: to || undefined, categoryId: category === 'all' ? undefined : category, unpaid: status === 'due' ? 'true' : undefined };
  const list = useExpenses({ ...query, page, pageSize: 25 });
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const manage = can('finances:manage');
  const today = new Date().toISOString().slice(0, 10);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const csv = `/api/v1/finances/expenses.csv?${new URLSearchParams(Object.entries(query).filter(([, v]) => v) as string[][]).toString()}`;
  return (
    <>
      <Panel title="Dépenses" actions={<>{can('finances:read') && me.entitlements.features.exports && <a href={csv} download className={buttonVariants({ variant: 'secondary' })}><Download aria-hidden className="size-4" />Exporter (CSV)</a>}{manage && <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouvelle dépense</Button>}</>}>
        <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Du">{(c) => <Input {...c} type="date" value={from} onChange={(e) => set({ from: e.target.value || null })} />}</Field>
          <Field label="Au">{(c) => <Input {...c} type="date" value={to} onChange={(e) => set({ to: e.target.value || null })} />}</Field>
          <Field label="Catégorie">{(c) => <Select {...c} value={category} onValueChange={(v) => set({ category: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Toutes' }, ...(cats.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />}</Field>
          <Field label="État">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Toutes' }, { value: 'due', label: 'À payer' }]} />}</Field>
        </div>
        {list.data && <p className="text-[14px] text-ink-2">Sélection : <strong className="num-col text-ink">{formatMoney(list.data.sum, currency)}</strong>{list.data.unpaidSum > 0 && <> dont <strong className="num-col text-ink">{formatMoney(list.data.unpaidSum, currency)}</strong> à payer</>}</p>}
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les dépenses.</p> : (
          <>
            <DataTable<Expense>
              caption="Dépenses"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'd', header: 'Date', cell: (r) => formatDay(r.incurredOn) },
                { key: 'x', header: 'Dépense', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.description}</span>{r.supplier && <span className="text-[13px] text-ink-2">{r.supplier}</span>}</span> },
                { key: 'c', header: 'Catégorie', cell: (r) => <Badge>{r.categoryName}</Badge> },
                { key: 'm', header: 'Montant', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.amount, r.currency)}</span> },
                { key: 's', header: 'État', cell: (r) => (r.paidOn ? <StateBadge tone="success">Payée le {formatDay(r.paidOn)}</StateBadge> : <StateBadge tone="warning">À payer</StateBadge>) },
                { key: 'a', header: 'Actions', cell: (r) => (manage ? <span className="flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier ${r.description}`}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`Supprimer ${r.description}`}>Supprimer</Button></span> : null) },
              ]}
              mobileCard={(r) => <div className="flex flex-col gap-1"><span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.description}</span><span className="num-col text-[14px]">{formatMoney(r.amount, r.currency)}</span></span><span className="text-[13px] text-ink-2">{formatDay(r.incurredOn)} · {r.categoryName} · {r.paidOn ? 'payée' : 'à payer'}</span>{manage && <span className="flex gap-2 pt-1"><Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Modifier</Button></span>}</div>}
              empty={<EmptyState kind="key" title="Aucune dépense" description="Saisissez vos dépenses (électricité, fournitures, salaires…) pour connaître votre résultat." action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Saisir une dépense</Button> : undefined} />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
      {editing && <ExpenseModal expense={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Supprimer cette dépense ?" description={removing ? `« ${removing.description} » sera supprimée. La suppression est tracée dans le journal.` : ''} confirmLabel="Supprimer" loading={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id, { onSuccess: () => { setRemoving(null); toast.success('Dépense supprimée.'); }, onError: (e) => { setRemoving(null); toast.error(isApiError(e) ? e.message : 'La suppression a échoué.'); } })} />
    </>
  );
}
