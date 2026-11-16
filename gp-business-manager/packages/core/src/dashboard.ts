import { stockValuation, expiringLots } from './stock';
import { cashflow, listAccounts } from './finance';
import { receivables } from './parties';
import { businessDate, can, type Ctx } from './util';

export interface DashQuery { from?: string; to?: string; registerId?: string; userId?: string }

const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Tous les indicateurs proviennent de requêtes sur les données réelles. Aucun chiffre n'est simulé. */
export function dashboard(ctx: Ctx, q: DashQuery) {
  const tz = ctx.company().timezone;
  const today = businessDate(tz);
  const monthStart = today.slice(0, 8) + '01';
  const from = q.from ?? monthStart;
  const to = q.to ?? today;
  const scopedUser = can(ctx, 'cash.view_all') ? (q.userId ?? null) : ctx.user.id;
  const reg = q.registerId ?? null;

  const salesAgg = (a: string, b: string) =>
    ctx.db.get<{ n: number; total: number; net: number; tax: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(net_total),0) AS net, COALESCE(SUM(tax_total),0) AS tax FROM sales
       WHERE business_date BETWEEN ? AND ? AND (? IS NULL OR user_id = ?) AND (? IS NULL OR register_id = ?)`, a, b, scopedUser, scopedUser, reg, reg)!;
  const returnsAgg = (a: string, b: string) =>
    ctx.db.get<{ net: number; total: number; cost: number }>(
      `SELECT COALESCE(SUM(r.net_total),0) AS net, COALESCE(SUM(r.total),0) AS total, COALESCE(SUM(r.cost_total),0) AS cost FROM sale_returns r JOIN sales s ON s.id = r.sale_id
       WHERE r.business_date BETWEEN ? AND ? AND r.restock = 1 AND (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?)`, a, b, scopedUser, scopedUser, reg, reg)!;
  const returnsAll = (a: string, b: string) =>
    ctx.db.get<{ net: number; total: number }>(
      `SELECT COALESCE(SUM(r.net_total),0) AS net, COALESCE(SUM(r.total),0) AS total FROM sale_returns r JOIN sales s ON s.id = r.sale_id
       WHERE r.business_date BETWEEN ? AND ? AND (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?)`, a, b, scopedUser, scopedUser, reg, reg)!;
  const cogs = (a: string, b: string) =>
    ctx.db.value<number>(
      `SELECT COALESCE(SUM(CAST(ROUND(i.unit_cost * i.qty_milli / 1000.0) AS INTEGER)),0) FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE s.business_date BETWEEN ? AND ? AND (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?)`, a, b, scopedUser, scopedUser, reg, reg)!;

  const period = salesAgg(from, to);
  const pReturnsAll = returnsAll(from, to);
  const pReturnsStock = returnsAgg(from, to);
  const revenue = period.net - pReturnsAll.net; // CA HT net des retours
  const cost = cogs(from, to) - pReturnsStock.cost;
  const grossProfit = revenue - cost;
  const expenses = ctx.db.value<number>('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE business_date BETWEEN ? AND ?', from, to)!;
  const todayAgg = salesAgg(today, today);
  const monthAgg = salesAgg(monthStart, today);
  const showFinance = can(ctx, 'finance.view');

  // série journalière (CA HT net des retours, dépenses)
  const daily = new Map<string, { date: string; revenue: number; sales: number; expenses: number }>();
  for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n++) daily.set(d, { date: d, revenue: 0, sales: 0, expenses: 0 });
  for (const r of ctx.db.all<{ d: string; net: number; n: number }>(
    `SELECT business_date AS d, SUM(net_total) AS net, COUNT(*) AS n FROM sales WHERE business_date BETWEEN ? AND ? AND (? IS NULL OR user_id = ?) AND (? IS NULL OR register_id = ?) GROUP BY d`, from, to, scopedUser, scopedUser, reg, reg)) {
    const e = daily.get(r.d); if (e) { e.revenue += r.net; e.sales = r.n; }
  }
  for (const r of ctx.db.all<{ d: string; net: number }>(
    `SELECT r.business_date AS d, SUM(r.net_total) AS net FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE r.business_date BETWEEN ? AND ? AND (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?) GROUP BY d`, from, to, scopedUser, scopedUser, reg, reg)) {
    const e = daily.get(r.d); if (e) e.revenue -= r.net;
  }
  if (showFinance) for (const r of ctx.db.all<{ d: string; t: number }>('SELECT business_date AS d, SUM(amount) AS t FROM expenses WHERE business_date BETWEEN ? AND ? GROUP BY d', from, to)) {
    const e = daily.get(r.d); if (e) e.expenses = r.t;
  }

  const topProducts = ctx.db.all(
    `SELECT i.variant_id AS variantId, i.name, SUM(i.qty_milli - i.returned_milli) AS qtyMilli, SUM(i.net) AS revenue
     FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.business_date BETWEEN ? AND ? AND (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?)
     GROUP BY i.variant_id ORDER BY revenue DESC LIMIT 8`, from, to, scopedUser, scopedUser, reg, reg);
  const byMethod = ctx.db.all(
    `SELECT m.name, SUM(CASE WHEN p.direction='IN' THEN p.amount ELSE -p.amount END) AS total FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE p.business_date BETWEEN ? AND ? AND p.sale_id IS NOT NULL AND (? IS NULL OR p.user_id = ?) GROUP BY m.id HAVING total <> 0 ORDER BY total DESC`, from, to, scopedUser, scopedUser);

  const stockAlerts = ctx.db.all(
    `SELECT v.id AS variantId, p.name || COALESCE(' — ' || v.name,'') AS name, v.sku, COALESCE(SUM(s.qty_milli),0) AS qtyMilli, v.alert_qty_milli AS alertQtyMilli
     FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN stock s ON s.variant_id = v.id
     WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.active = 1 AND p.track_stock = 1
     GROUP BY v.id HAVING COALESCE(SUM(s.qty_milli),0) <= v.alert_qty_milli ORDER BY COALESCE(SUM(s.qty_milli),0) LIMIT 20`);

  const base = {
    period: { from, to, today },
    sales: {
      today: { count: todayAgg.n, total: todayAgg.total }, month: { count: monthAgg.n, total: monthAgg.total },
      period: { count: period.n, total: period.total, avgBasket: period.n ? Math.round(period.total / period.n) : 0 },
    },
    revenue, grossProfit, marginBp: revenue > 0 ? Math.round((grossProfit * 10000) / revenue) : 0, cost,
    returns: pReturnsAll.total,
    series: [...daily.values()],
    topProducts, byMethod, stockAlerts,
    expiring: expiringLots(ctx, 30).slice(0, 10),
    stockValue: stockValuation(ctx).value,
  };
  if (!showFinance) return { ...base, finance: null };

  const accounts = listAccounts(ctx) as any[];
  const rec = receivables(ctx) as any[];
  const customerDebt = ctx.db.value<number>('SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) AS b FROM customer_ledger GROUP BY customer_id HAVING SUM(amount) > 0)')!;
  const supplierDebt = ctx.db.value<number>('SELECT COALESCE(SUM(b),0) FROM (SELECT SUM(amount) AS b FROM supplier_ledger GROUP BY supplier_id HAVING SUM(amount) > 0)')!;
  return {
    ...base,
    finance: {
      expenses, netResult: grossProfit - expenses,
      treasury: accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0),
      accounts, customerDebt, supplierDebt,
      unpaidInvoices: { count: rec.length, amount: rec.reduce((s, r) => s + r.due, 0) },
      cashflow: cashflow(ctx, from, to),
    },
  };
}
