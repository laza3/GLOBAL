import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from 'recharts';
import { AlertTriangle, Banknote, Boxes, CircleDollarSign, HandCoins, Landmark, PackageX, Receipt, TrendingUp, Wallet, Percent, ShoppingBag } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, Field, Input, Kpi, PageHeader, Select, Spinner, Money, cx } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useQ } from '../lib/api';
import { useT } from '../lib/i18n';
import { dateOnly, money, monthStartStr, pct, qty, todayStr } from '../lib/format';
import { useTheme } from '../lib/theme';

const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };

export function Dashboard() {
  const { t } = useT();
  const { can, company } = useAuth();
  const { mode } = useTheme();
  const today = todayStr(company?.timezone);
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ from: monthStartStr(), to: today });
  const [registerId, setRegister] = useState('');
  const [userId, setUser] = useState('');
  const range = useMemo(() => {
    switch (preset) {
      case 'today': return { from: today, to: today };
      case '7d': return { from: addDays(today, -6), to: today };
      case '30d': return { from: addDays(today, -29), to: today };
      case 'custom': return custom;
      default: return { from: today.slice(0, 8) + '01', to: today };
    }
  }, [preset, custom, today]);
  const registers = useQ('org.registers');
  const users = useQ('users.list', undefined, { enabled: can('cash.view_all') });
  const { data: d, isLoading, error } = useQ('dashboard.get', { ...range, registerId: registerId || undefined, userId: userId || undefined });

  const grid = mode === 'dark' ? '#ffffff14' : '#0b0f2210';
  const axis = mode === 'dark' ? '#9a97a0' : '#6f6d7a';
  const compact = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : String(v));

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`${dateOnly(range.from)} → ${dateOnly(range.to)}`}
        actions={<>
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-44" aria-label={t('Période')}>
            <option value="today">{t("Aujourd'hui")}</option><option value="7d">{t('7 derniers jours')}</option><option value="month">{t('Ce mois')}</option><option value="30d">{t('30 derniers jours')}</option><option value="custom">{t('Personnalisée')}</option>
          </Select>
          {preset === 'custom' && <><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-40" /><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-40" /></>}
          {(registers.data?.length ?? 0) > 1 && <Select value={registerId} onChange={(e) => setRegister(e.target.value)} className="w-40"><option value="">{t('Toutes les caisses')}</option>{registers.data?.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
          {can('cash.view_all') && <Select value={userId} onChange={(e) => setUser(e.target.value)} className="w-44"><option value="">{t('Tous les utilisateurs')}</option>{users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select>}
        </>} />

      {isLoading && <div className="grid h-64 place-items-center"><Spinner className="size-7" /></div>}
      {error && <Card className="p-6 text-red-600">{error.message}</Card>}
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Chiffre d'affaires (HT)" value={money(d.revenue)} icon={<TrendingUp className="size-4" />} tone="gold" hint={`${d.sales.period.count} ${t('ventes')} · ${t('panier moyen')} ${money(d.sales.period.avgBasket)}`} />
            <Kpi label="Marge brute" value={money(d.grossProfit)} icon={<Percent className="size-4" />} tone={d.grossProfit >= 0 ? 'green' : 'red'} hint={`${t('Taux de marge')} ${pct(d.marginBp)}`} />
            <Kpi label="Ventes du jour" value={money(d.sales.today.total)} icon={<ShoppingBag className="size-4" />} hint={`${d.sales.today.count} ${t('ticket(s)')}`} />
            <Kpi label="Ventes du mois" value={money(d.sales.month.total)} icon={<Receipt className="size-4" />} hint={`${d.sales.month.count} ${t('ticket(s)')}`} />
          </div>
          {d.finance && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi label="Dépenses" value={money(d.finance.expenses)} icon={<HandCoins className="size-4" />} tone="red" hint={`${t('Résultat')} ${money(d.finance.netResult)}`} />
              <Kpi label="Trésorerie" value={money(d.finance.treasury)} icon={<Landmark className="size-4" />} tone="green" hint={`${d.finance.accounts.filter((a: any) => a.active).length} ${t('comptes')}`} />
              <Kpi label="Dettes clients" value={money(d.finance.customerDebt)} icon={<Wallet className="size-4" />} tone={d.finance.customerDebt > 0 ? 'gold' : 'neutral'} hint={`${d.finance.unpaidInvoices.count} ${t('impayé(s)')}`} />
              <Kpi label="Dettes fournisseurs" value={money(d.finance.supplierDebt)} icon={<CircleDollarSign className="size-4" />} tone={d.finance.supplierDebt > 0 ? 'red' : 'neutral'} hint={`${t('Valeur du stock')} ${money(d.stockValue)}`} />
            </div>
          )}
          {!d.finance && <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><Kpi label="Valeur du stock" value={money(d.stockValue)} icon={<Boxes className="size-4" />} /></div>}

          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{t('Performance')}</h3><div className="flex gap-3 text-xs text-ink-400"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-gold-400" />{t("Chiffre d'affaires")}</span>{d.finance && <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-ink-400" />{t('Dépenses')}</span>}</div></div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.series} margin={{ left: -10, right: 8, top: 8 }}>
                    <defs><linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d3a33a" stopOpacity={0.35} /><stop offset="1" stopColor="#d3a33a" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke={grid} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fill: axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tickFormatter={compact} tick={{ fill: axis, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                    <Tooltip formatter={(v: any, n: any) => [money(v), n === 'revenue' ? t("Chiffre d'affaires") : t('Dépenses')]} labelFormatter={(l: any) => dateOnly(String(l))} contentStyle={{ borderRadius: 12, border: '1px solid #e0ddd2', background: mode === 'dark' ? '#1b2038' : '#fff', color: mode === 'dark' ? '#fff' : '#1b2038' }} />
                    <Area type="monotone" dataKey="revenue" stroke="#c08f26" strokeWidth={2.4} fill="url(#gRev)" />
                    {d.finance && <Area type="monotone" dataKey="expenses" stroke={mode === 'dark' ? '#9a97a0' : '#6f6d7a'} strokeWidth={1.6} strokeDasharray="4 3" fill="none" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">{t('Produits les plus vendus')}</h3>
              {d.topProducts.length === 0 ? <EmptyState title="Aucune vente sur la période" /> : (
                <ul className="space-y-3">
                  {d.topProducts.map((p: any, i: number) => {
                    const max = d.topProducts[0].revenue || 1;
                    return (
                      <li key={p.variantId}>
                        <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium"><span className="mr-2 text-ink-400">{i + 1}</span>{p.name}</span><span className="tabular text-ink-500">{money(p.revenue)}</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-gold-300 to-gold-500" style={{ width: `${(p.revenue / max) * 100}%` }} /></div>
                        <p className="mt-0.5 text-xs text-ink-400">{qty(p.qtyMilli)} {t('vendus')}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            {d.finance && (
              <Card className="p-5">
                <h3 className="mb-3 font-semibold">{t('Soldes des comptes et caisses')}</h3>
                <ul className="divide-y divide-ink-50 dark:divide-white/5">
                  {d.finance.accounts.filter((a: any) => a.active).map((a: any) => (
                    <li key={a.id} className="flex items-center justify-between py-2.5 text-sm"><span className="flex items-center gap-2">{a.type === 'CASH' ? <Banknote className="size-4 text-gold-500" /> : <Landmark className="size-4 text-ink-400" />}{a.name}</span><Money v={a.balance} className="font-medium" /></li>
                  ))}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-3 text-xs dark:border-white/10">
                  <div><p className="text-ink-400">{t('Encaissements ventes')}</p><Money v={d.finance.cashflow.saleReceipts} className="font-semibold" /></div>
                  <div><p className="text-ink-400">{t('Apports')}</p><Money v={d.finance.cashflow.capitalContributions} className="font-semibold" /></div>
                  <div><p className="text-ink-400">{t('Remboursements')}</p><Money v={d.finance.cashflow.refunds} className="font-semibold" /></div>
                  <div><p className="text-ink-400">{t('Paiements fournisseurs')}</p><Money v={d.finance.cashflow.supplierPayments} className="font-semibold" /></div>
                </div>
              </Card>
            )}
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">{t('Répartition des encaissements')}</h3>
              {d.byMethod.length === 0 ? <EmptyState title="Aucun encaissement" /> : (
                <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.byMethod} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={96} tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: any) => money(v)} cursor={{ fill: grid }} contentStyle={{ borderRadius: 12 }} />
                  <Bar dataKey="total" radius={[0, 8, 8, 0]} barSize={18}>{d.byMethod.map((_: any, i: number) => <Cell key={i} fill={['#c08f26', '#2c2f45', '#d3a33a', '#6f6d7a', '#a0721d'][i % 5]} />)}</Bar>
                </BarChart></ResponsiveContainer></div>
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{t('Alertes de stock')}</h3>{d.stockAlerts.length > 0 && <Badge tone="red">{d.stockAlerts.length}</Badge>}</div>
              {d.stockAlerts.length === 0 ? <EmptyState icon={<Boxes className="size-5" />} title="Aucune alerte" hint="Tous les articles sont au-dessus de leur seuil." /> : (
                <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {d.stockAlerts.map((a: any) => (
                    <li key={a.variantId} className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm dark:bg-white/5">
                      <span className="flex min-w-0 items-center gap-2">{a.qtyMilli <= 0 ? <PackageX className="size-4 shrink-0 text-red-500" /> : <AlertTriangle className="size-4 shrink-0 text-gold-500" />}<span className="truncate">{a.name}</span></span>
                      <span className={cx('tabular text-xs font-semibold', a.qtyMilli <= 0 ? 'text-red-600' : 'text-gold-600')}>{qty(a.qtyMilli)} / {qty(a.alertQtyMilli)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {d.expiring.length > 0 && <div className="mt-3 border-t border-ink-100 pt-3 dark:border-white/10"><p className="mb-1 text-xs font-semibold text-ink-400">{t('Péremption sous 30 jours')}</p>{d.expiring.slice(0, 3).map((e: any) => <p key={e.id} className="truncate text-xs">{e.name} · {e.lotNo} · {dateOnly(e.expiryDate)}</p>)}</div>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
void DataTable;
