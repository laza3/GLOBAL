import { useState } from 'react';
import { ArrowLeftRight, HandCoins, Landmark, PiggyBank, Plus } from 'lucide-react';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Modal, MoneyInput, PageHeader, Select, Tabs, Textarea, Money, useToast } from '../components/ui';
import { useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { dateOnly, dateTime, money, monthStartStr, todayStr } from '../lib/format';

/** Compte à présélectionner : espèces approvisionné, sinon le plus approvisionné. */
const bestAccount = (accounts: any[]) => accounts.filter((a) => a.active).sort((a, b) => Number(b.type === 'CASH' && b.balance > 0) - Number(a.type === 'CASH' && a.balance > 0) || b.balance - a.balance)[0]?.id ?? '';

const KIND: Record<string, [string, 'green' | 'red' | 'blue' | 'gold' | 'neutral']> = {
  SALE_RECEIPT: ['Encaissement vente', 'green'], CUSTOMER_PAYMENT: ['Règlement client', 'green'], CUSTOMER_ADVANCE: ['Avance client', 'green'], REFUND: ['Remboursement', 'red'], EXPENSE: ['Dépense', 'red'], SUPPLIER_PAYMENT: ['Paiement fournisseur', 'red'],
  CAPITAL_CONTRIBUTION: ['Apport', 'blue'], OWNER_WITHDRAWAL: ['Prélèvement', 'gold'], TRANSFER_IN: ['Virement reçu', 'neutral'], TRANSFER_OUT: ['Virement émis', 'neutral'], ADJUSTMENT: ['Ajustement', 'neutral'],
};

export function FinancePage() {
  const { t } = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'tx' | 'expenses' | 'receivables'>('overview');
  const [range, setRange] = useState({ from: monthStartStr(), to: todayStr() });
  return (
    <>
      <PageHeader title="Finances" subtitle="Comptes, trésorerie, dépenses, créances et dettes" actions={<><Input type="date" className="w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><Input type="date" className="w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Comptes & flux' }, { id: 'tx', label: 'Écritures' }, { id: 'expenses', label: 'Dépenses' }, { id: 'receivables', label: 'Créances clients' }]} />
      {tab === 'overview' && <Overview range={range} canEdit={can('finance.manage')} />}
      {tab === 'tx' && <Transactions range={range} />}
      {tab === 'expenses' && <Expenses range={range} canEdit={can('expense.manage')} />}
      {tab === 'receivables' && <Receivables />}
    </>
  );
}

function Overview({ range, canEdit }: { range: { from: string; to: string }; canEdit: boolean }) {
  const { t } = useT();
  const accounts = (useQ('finance.accounts').data ?? []) as any[];
  const cf = useQ('finance.cashflow', range).data;
  const [modal, setModal] = useState<null | 'transfer' | 'in' | 'out' | 'account'>(null);
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  const Line = ({ label, v, sign }: { label: string; v: number; sign?: '+' | '−' }) => <div className="flex justify-between py-1.5 text-sm"><span className="text-ink-500">{t(label)}</span><span className={`tabular font-medium ${sign === '−' ? 'text-red-600' : ''}`}>{sign === '−' && v ? '−' : ''}{money(v)}</span></div>;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4"><Kpi label="Trésorerie totale" value={money(total)} icon={<Landmark className="size-4" />} tone="gold" /><Kpi label="Variation sur la période" value={money(cf?.netChange ?? 0)} tone={(cf?.netChange ?? 0) >= 0 ? 'green' : 'red'} /></div>
        <Card>
          <div className="flex flex-wrap items-center gap-2 p-4"><h3 className="mr-auto font-semibold">{t('Comptes financiers')}</h3>
            {canEdit && <><Button size="sm" onClick={() => setModal('in')} icon={<PiggyBank className="size-4" />}>{t('Apport')}</Button><Button size="sm" onClick={() => setModal('out')} icon={<HandCoins className="size-4" />}>{t('Prélèvement')}</Button><Button size="sm" onClick={() => setModal('transfer')} icon={<ArrowLeftRight className="size-4" />}>{t('Virement interne')}</Button><Button size="sm" variant="gold" onClick={() => setModal('account')} icon={<Plus className="size-4" />}>{t('Compte')}</Button></>}</div>
          <DataTable rowKey={(r: any) => r.id} rows={accounts} columns={[{ key: 'n', header: 'Compte', render: (r: any) => <>{r.name} {!r.active && <Badge>{t('Inactif')}</Badge>}</> }, { key: 't', header: 'Type', render: (r: any) => ({ CASH: t('Espèces'), BANK: t('Banque'), MOBILE: t('Mobile money') } as any)[r.type] }, { key: 'b', header: 'Solde', align: 'right', render: (r: any) => <b className={r.balance < 0 ? 'text-red-600' : ''}>{money(r.balance)}</b> }]} />
        </Card>
      </div>
      <Card className="p-5">
        <h3 className="mb-1 font-semibold">{t('Flux de trésorerie')}</h3><p className="mb-3 text-xs text-ink-400">{dateOnly(range.from)} → {dateOnly(range.to)}</p>
        {cf && <><p className="mt-2 text-xs font-semibold uppercase tracking-wider text-gold-600">{t('Exploitation')}</p>
          <Line label="Encaissements des ventes" v={cf.saleReceipts} /><Line label="Règlements clients" v={cf.customerPayments + cf.customerAdvances} /><Line label="Remboursements clients" v={cf.refunds} sign="−" /><Line label="Dépenses" v={cf.expenses} sign="−" /><Line label="Paiements fournisseurs" v={cf.supplierPayments} sign="−" />
          <div className="flex justify-between border-t border-ink-100 py-2 font-semibold dark:border-white/10"><span>{t('Flux d’exploitation net')}</span><span className="tabular">{money(cf.operatingNet)}</span></div>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-gold-600">{t('Hors exploitation')}</p>
          <Line label="Apports de l’exploitant" v={cf.capitalContributions} /><Line label="Prélèvements" v={cf.ownerWithdrawals} sign="−" /><Line label="Virements internes (net)" v={cf.transfersNet} />
          <div className="mt-1 flex justify-between border-t border-ink-100 pt-2 text-base font-bold dark:border-white/10"><span>{t('Variation de trésorerie')}</span><span className="tabular">{money(cf.netChange)}</span></div></>}
      </Card>
      {modal === 'account' && <AccountForm onClose={() => setModal(null)} />}
      {modal === 'transfer' && <TransferForm accounts={accounts} onClose={() => setModal(null)} />}
      {(modal === 'in' || modal === 'out') && <OwnerForm kind={modal === 'in' ? 'CAPITAL_CONTRIBUTION' : 'OWNER_WITHDRAWAL'} accounts={accounts} onClose={() => setModal(null)} />}
    </div>
  );
}

function AccountForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: '', type: 'BANK' as 'CASH' | 'BANK' | 'MOBILE', openingBalance: 0 });
  const [err, setErr] = useState<unknown>(null);
  const m = useM('finance.saveAccount', { onSuccess: onClose });
  return (<Modal open onClose={onClose} title="Nouveau compte" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" disabled={!f.name.trim()} loading={m.isPending} onClick={() => m.mutate(f, { onError: setErr })}>{t('Créer')}</Button></>}>
    <div className="space-y-3"><Field label="Nom"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as any })}><option value="BANK">{t('Banque')}</option><option value="MOBILE">{t('Mobile money')}</option><option value="CASH">{t('Espèces')}</option></Select></Field><Field label="Solde d’ouverture"><MoneyInput value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} /></Field><ErrorBox error={err} /></div></Modal>);
}
function TransferForm({ accounts, onClose }: { accounts: any[]; onClose: () => void }) {
  const { t } = useT();
  const [f0, setF] = useState({ fromAccountId: '', toAccountId: '', amount: 0, note: '' });
  const best = bestAccount(accounts);
  const f = { ...f0, fromAccountId: f0.fromAccountId || best, toAccountId: f0.toAccountId || (accounts.find((a) => a.id !== (f0.fromAccountId || best))?.id ?? '') };
  const [err, setErr] = useState<unknown>(null);
  const m = useM('finance.transfer', { onSuccess: onClose });
  return (<Modal open onClose={onClose} title="Virement interne" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={f.amount <= 0 || f.fromAccountId === f.toAccountId} onClick={() => m.mutate({ ...f, note: f.note || undefined }, { onError: setErr })}>{t('Transférer')}</Button></>}>
    <div className="space-y-3"><Field label="Depuis"><Select value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</Select></Field><Field label="Vers"><Select value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Montant"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field><Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field><ErrorBox error={err} /></div></Modal>);
}
function OwnerForm({ kind, accounts, onClose }: { kind: 'CAPITAL_CONTRIBUTION' | 'OWNER_WITHDRAWAL'; accounts: any[]; onClose: () => void }) {
  const { t } = useT();
  const [f0, setF] = useState({ accountId: '', amount: 0, note: '' });
  const f = { ...f0, accountId: f0.accountId || (kind === 'OWNER_WITHDRAWAL' ? bestAccount(accounts) : accounts.find((a) => a.type === 'CASH')?.id ?? accounts[0]?.id ?? '') };
  const [err, setErr] = useState<unknown>(null);
  const m = useM('finance.ownerMovement', { onSuccess: onClose });
  return (<Modal open onClose={onClose} title={kind === 'CAPITAL_CONTRIBUTION' ? 'Apport de l’exploitant' : 'Prélèvement de l’exploitant'} size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={f.amount <= 0} onClick={() => m.mutate({ kind, ...f, note: f.note || undefined }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
    <div className="space-y-3"><Field label="Compte"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Montant"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field><Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field><ErrorBox error={err} /></div></Modal>);
}

function Transactions({ range }: { range: { from: string; to: string } }) {
  const { t } = useT();
  const accounts = (useQ('finance.accounts').data ?? []) as any[];
  const [accountId, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const { data } = useQ('finance.transactions', { ...range, accountId: accountId || undefined, kind: kind || undefined, limit: 1000 });
  return (
    <Card>
      <div className="flex flex-wrap gap-3 p-4"><Select className="w-52" value={accountId} onChange={(e) => setAccount(e.target.value)}><option value="">{t('Tous les comptes')}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <Select className="w-56" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t('Tous les types')}</option>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{t(l)}</option>)}</Select></div>
      <DataTable dense rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[{ key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'k', header: 'Type', render: (r: any) => <Badge tone={KIND[r.kind]?.[1]}>{t(KIND[r.kind]?.[0] ?? r.kind)}</Badge> }, { key: 'a', header: 'Compte', render: (r: any) => r.accountName }, { key: 'n', header: 'Libellé', render: (r: any) => <span className="text-ink-500">{r.note ?? ''}</span> }, { key: 'm', header: 'Montant', align: 'right', render: (r: any) => <b className={r.amount < 0 ? 'text-red-600' : 'text-emerald-600'}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</b> }]} />
      <p className="p-3 text-xs text-ink-400">{t('Les écritures de trésorerie sont immuables : toute correction passe par une écriture inverse.')}</p>
    </Card>
  );
}

function Expenses({ range, canEdit }: { range: { from: string; to: string }; canEdit: boolean }) {
  const { t } = useT();
  const { data } = useQ('finance.expenses', range);
  const [open, setOpen] = useState(false);
  const rows = (data ?? []) as any[];
  return (
    <Card>
      <div className="flex items-center gap-3 p-4"><Kpi label="Total des dépenses" value={money(rows.reduce((a, r) => a + r.amount, 0))} tone="red" />{canEdit && <Button className="ml-auto" variant="gold" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>{t('Nouvelle dépense')}</Button>}</div>
      <DataTable rowKey={(r: any) => r.id} rows={rows} columns={[{ key: 'n', header: 'N°', render: (r: any) => r.number }, { key: 'd', header: 'Date', render: (r: any) => dateOnly(r.businessDate) }, { key: 'c', header: 'Catégorie', render: (r: any) => <Badge>{r.categoryName ?? '—'}</Badge> }, { key: 'l', header: 'Libellé', render: (r: any) => <>{r.description}{r.beneficiary && <span className="block text-xs text-ink-400">{r.beneficiary}</span>}</> }, { key: 'a', header: 'Compte', render: (r: any) => r.accountName }, { key: 'm', header: 'Montant', align: 'right', render: (r: any) => <b>{money(r.amount)}</b> }]} />
      {open && <ExpenseForm onClose={() => setOpen(false)} />}
    </Card>
  );
}
function ExpenseForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const accounts = (useQ('finance.accounts').data ?? []) as any[];
  const cats = (useQ('ref.expenseCategories').data ?? []) as any[];
  const [f0, setF] = useState({ categoryId: '', accountId: '', amount: 0, description: '', beneficiary: '', date: todayStr() });
  const f = { ...f0, accountId: f0.accountId || bestAccount(accounts) };
  const [err, setErr] = useState<unknown>(null);
  const m = useM('finance.createExpense', { onSuccess: (r) => { push('success', `${t('Dépense')} ${r.number}`); onClose(); } });
  return (<Modal open onClose={onClose} title="Nouvelle dépense" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={f.amount <= 0 || !f.description.trim()} onClick={() => m.mutate({ categoryId: f.categoryId || undefined, accountId: f.accountId, amount: f.amount, description: f.description, beneficiary: f.beneficiary || undefined, date: f.date }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
    <div className="grid gap-3 md:grid-cols-2"><Field label="Libellé" className="md:col-span-2"><Input autoFocus value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Catégorie"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><Field label="Montant"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
      <Field label="Payée depuis"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}</Select></Field><Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Bénéficiaire" className="md:col-span-2"><Input value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} /></Field></div><div className="mt-3"><ErrorBox error={err} /></div></Modal>);
}

function Receivables() {
  const { t } = useT();
  const { data } = useQ('finance.receivables');
  const rows = (data ?? []) as any[];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <div className="grid grid-cols-2 gap-4 p-4"><Kpi label="Total à encaisser" value={money(rows.reduce((a, r) => a + r.due, 0))} tone="gold" /><Kpi label="Factures impayées" value={rows.length} tone="red" /></div>
      <DataTable rowKey={(r: any) => r.id} rows={rows} columns={[{ key: 'n', header: 'Vente', render: (r: any) => r.number }, { key: 'c', header: 'Client', render: (r: any) => <>{r.customerName ?? '—'}<span className="block text-xs text-ink-400">{r.phone}</span></> }, { key: 'd', header: 'Date', render: (r: any) => dateTime(r.createdAt) }, { key: 'e', header: 'Échéance', render: (r: any) => (r.dueDate ? <Badge tone={r.dueDate < today ? 'red' : 'neutral'}>{dateOnly(r.dueDate)}</Badge> : '—') }, { key: 't', header: 'Total', align: 'right', render: (r: any) => money(r.total) }, { key: 'p', header: 'Payé', align: 'right', render: (r: any) => money(r.paidTotal) }, { key: 'r', header: 'Reste dû', align: 'right', render: (r: any) => <b className="text-red-600">{money(r.due)}</b> }]} />
    </Card>
  );
}
void Money; void Textarea;
