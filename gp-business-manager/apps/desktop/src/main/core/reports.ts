import ExcelJS from 'exceljs';
import { companyOf, requirePerm, type Ctx } from './util';
import { receivables, payables } from './parties';

export type ColType = 'text' | 'money' | 'qty' | 'date' | 'datetime' | 'percent' | 'int';
export interface Report {
  type: string;
  title: string;
  columns: { key: string; label: string; type: ColType }[];
  rows: Record<string, any>[];
  totals?: Record<string, number>;
  period?: { from: string; to: string };
}
export interface ReportQuery { type: string; from?: string; to?: string; userId?: string }

export const REPORT_TYPES = [
  { type: 'sales', title: 'Ventes', perm: 'report.view' },
  { type: 'sales_by_product', title: 'Ventes par produit', perm: 'report.view' },
  { type: 'sales_by_user', title: 'Performance des vendeurs', perm: 'report.view' },
  { type: 'profit', title: 'Bénéfices par jour', perm: 'finance.view' },
  { type: 'purchases', title: 'Achats', perm: 'report.view' },
  { type: 'expenses', title: 'Dépenses', perm: 'finance.view' },
  { type: 'stock', title: 'État et valorisation des stocks', perm: 'report.view' },
  { type: 'cash_sessions', title: 'Sessions de caisse', perm: 'report.view' },
  { type: 'customers', title: 'Clients (soldes)', perm: 'report.view' },
  { type: 'suppliers', title: 'Fournisseurs (soldes)', perm: 'report.view' },
  { type: 'receivables', title: 'Impayés clients', perm: 'report.view' },
  { type: 'payables', title: 'Dettes fournisseurs', perm: 'report.view' },
] as const;

const sum = (rows: Record<string, any>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)]));

export function runReport(ctx: Ctx, q: ReportQuery): Report {
  const def = REPORT_TYPES.find((r) => r.type === q.type);
  if (!def) throw new Error('Rapport inconnu');
  requirePerm(ctx, def.perm);
  const from = q.from ?? '0000-01-01';
  const to = q.to ?? '9999-12-31';
  const db = ctx.db;
  const mk = (columns: Report['columns'], rows: any[], totalKeys: string[] = []): Report => ({ type: def.type, title: def.title, columns, rows, totals: totalKeys.length ? sum(rows, totalKeys) : undefined, period: q.from ? { from, to } : undefined });

  switch (q.type) {
    case 'sales':
      return mk(
        [{ key: 'number', label: 'N°', type: 'text' }, { key: 'at', label: 'Date', type: 'datetime' }, { key: 'customer', label: 'Client', type: 'text' }, { key: 'user', label: 'Vendeur', type: 'text' },
         { key: 'net', label: 'HT', type: 'money' }, { key: 'tax', label: 'Taxe', type: 'money' }, { key: 'total', label: 'Total TTC', type: 'money' }, { key: 'returned', label: 'Retours', type: 'money' }, { key: 'paid', label: 'Payé', type: 'money' }, { key: 'status', label: 'Statut', type: 'text' }],
        db.all(`SELECT s.number, s.created_at AS at, COALESCE(c.name,'—') AS customer, u.display_name AS user, s.net_total AS net, s.tax_total AS tax, s.total, s.returned_total AS returned, s.paid_total AS paid, s.payment_status AS status
                FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.user_id WHERE s.business_date BETWEEN ? AND ? AND (? IS NULL OR s.user_id = ?) ORDER BY s.created_at`, from, to, q.userId ?? null, q.userId ?? null),
        ['net', 'tax', 'total', 'returned', 'paid']);
    case 'sales_by_product':
      return mk(
        [{ key: 'name', label: 'Produit', type: 'text' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'qty', label: 'Qté vendue (net)', type: 'qty' }, { key: 'revenue', label: 'CA HT', type: 'money' }, { key: 'cost', label: 'Coût', type: 'money' }, { key: 'profit', label: 'Marge', type: 'money' }, { key: 'marginBp', label: 'Marge %', type: 'percent' }],
        db.all(`SELECT i.name, i.sku, SUM(i.qty_milli - i.returned_milli) AS qty, SUM(i.net) AS revenue, SUM(CAST(ROUND(i.unit_cost * i.qty_milli / 1000.0) AS INTEGER)) AS cost,
                SUM(i.net) - SUM(CAST(ROUND(i.unit_cost * i.qty_milli / 1000.0) AS INTEGER)) AS profit,
                CASE WHEN SUM(i.net) > 0 THEN (SUM(i.net) - SUM(CAST(ROUND(i.unit_cost * i.qty_milli / 1000.0) AS INTEGER))) * 10000 / SUM(i.net) ELSE 0 END AS marginBp
                FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.business_date BETWEEN ? AND ? GROUP BY i.variant_id ORDER BY revenue DESC`, from, to),
        ['qty', 'revenue', 'cost', 'profit']);
    case 'sales_by_user':
      return mk(
        [{ key: 'user', label: 'Vendeur', type: 'text' }, { key: 'count', label: 'Ventes', type: 'int' }, { key: 'total', label: 'Total TTC', type: 'money' }, { key: 'avg', label: 'Panier moyen', type: 'money' }, { key: 'discounts', label: 'Remises', type: 'money' }, { key: 'returned', label: 'Retours', type: 'money' }],
        db.all(`SELECT u.display_name AS user, COUNT(*) AS count, SUM(s.total) AS total, SUM(s.total) / COUNT(*) AS avg, SUM(s.line_discount_total + s.cart_discount_total) AS discounts, SUM(s.returned_total) AS returned
                FROM sales s JOIN users u ON u.id = s.user_id WHERE s.business_date BETWEEN ? AND ? GROUP BY s.user_id ORDER BY total DESC`, from, to),
        ['count', 'total', 'discounts', 'returned']);
    case 'profit': {
      const rows = db.all(
        `WITH d AS (SELECT business_date AS date FROM sales WHERE business_date BETWEEN ? AND ? UNION SELECT business_date FROM expenses WHERE business_date BETWEEN ? AND ? UNION SELECT business_date FROM sale_returns WHERE business_date BETWEEN ? AND ?)
         SELECT d.date,
           COALESCE((SELECT SUM(net_total) FROM sales WHERE business_date = d.date),0) - COALESCE((SELECT SUM(net_total) FROM sale_returns WHERE business_date = d.date),0) AS revenue,
           COALESCE((SELECT SUM(CAST(ROUND(i.unit_cost * i.qty_milli / 1000.0) AS INTEGER)) FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.business_date = d.date),0)
             - COALESCE((SELECT SUM(cost_total) FROM sale_returns WHERE business_date = d.date AND restock = 1),0) AS cost,
           COALESCE((SELECT SUM(amount) FROM expenses WHERE business_date = d.date),0) AS expenses
         FROM d ORDER BY d.date`, from, to, from, to, from, to).map((r: any) => ({ ...r, gross: r.revenue - r.cost, net: r.revenue - r.cost - r.expenses }));
      return mk([{ key: 'date', label: 'Date', type: 'date' }, { key: 'revenue', label: 'CA HT net', type: 'money' }, { key: 'cost', label: 'Coût des ventes', type: 'money' }, { key: 'gross', label: 'Marge brute', type: 'money' }, { key: 'expenses', label: 'Dépenses', type: 'money' }, { key: 'net', label: 'Résultat', type: 'money' }], rows, ['revenue', 'cost', 'gross', 'expenses', 'net']);
    }
    case 'purchases':
      return mk(
        [{ key: 'number', label: 'N°', type: 'text' }, { key: 'at', label: 'Date', type: 'datetime' }, { key: 'supplier', label: 'Fournisseur', type: 'text' }, { key: 'status', label: 'Statut', type: 'text' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'received', label: 'Reçu', type: 'money' }, { key: 'paid', label: 'Payé', type: 'money' }],
        db.all(`SELECT p.number, p.created_at AS at, s.name AS supplier, p.status, p.total, p.received_total AS received, p.paid_total AS paid FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE substr(p.created_at,1,10) BETWEEN ? AND ? ORDER BY p.created_at`, from, to), ['total', 'received', 'paid']);
    case 'expenses':
      return mk(
        [{ key: 'number', label: 'N°', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'category', label: 'Catégorie', type: 'text' }, { key: 'description', label: 'Libellé', type: 'text' }, { key: 'account', label: 'Compte', type: 'text' }, { key: 'amount', label: 'Montant', type: 'money' }],
        db.all(`SELECT e.number, e.business_date AS date, COALESCE(c.name,'—') AS category, e.description, a.name AS account, e.amount FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id JOIN financial_accounts a ON a.id = e.account_id WHERE e.business_date BETWEEN ? AND ? ORDER BY e.at`, from, to), ['amount']);
    case 'stock':
      return mk(
        [{ key: 'name', label: 'Article', type: 'text' }, { key: 'sku', label: 'SKU', type: 'text' }, { key: 'warehouse', label: 'Entrepôt', type: 'text' }, { key: 'qty', label: 'Quantité', type: 'qty' }, { key: 'alert', label: 'Seuil', type: 'qty' }, { key: 'avgCost', label: 'Coût moyen', type: 'money' }, { key: 'value', label: 'Valeur', type: 'money' }],
        db.all(`SELECT p.name || COALESCE(' — ' || v.name,'') AS name, v.sku, w.name AS warehouse, s.qty_milli AS qty, v.alert_qty_milli AS alert, s.avg_cost AS avgCost, CAST(ROUND(s.qty_milli * s.avg_cost / 1000.0) AS INTEGER) AS value
                FROM stock s JOIN product_variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id JOIN warehouses w ON w.id = s.warehouse_id WHERE v.deleted_at IS NULL ORDER BY p.name`), ['value']);
    case 'cash_sessions':
      return mk(
        [{ key: 'register', label: 'Caisse', type: 'text' }, { key: 'user', label: 'Caissier', type: 'text' }, { key: 'openedAt', label: 'Ouverture', type: 'datetime' }, { key: 'closedAt', label: 'Clôture', type: 'datetime' }, { key: 'opening', label: 'Fond', type: 'money' }, { key: 'expected', label: 'Attendu', type: 'money' }, { key: 'counted', label: 'Compté', type: 'money' }, { key: 'difference', label: 'Écart', type: 'money' }],
        db.all(`SELECT r.name AS register, u.display_name AS user, s.opened_at AS openedAt, s.closed_at AS closedAt, s.opening_float AS opening, s.expected_cash AS expected, s.counted_cash AS counted, s.difference FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id JOIN users u ON u.id = s.user_id WHERE substr(s.opened_at,1,10) BETWEEN ? AND ? ORDER BY s.opened_at`, from, to), ['difference']);
    case 'customers':
      return mk(
        [{ key: 'name', label: 'Client', type: 'text' }, { key: 'phone', label: 'Téléphone', type: 'text' }, { key: 'sales', label: 'Achats', type: 'money' }, { key: 'balance', label: 'Solde (dû +)', type: 'money' }, { key: 'limit', label: 'Plafond', type: 'money' }],
        db.all(`SELECT c.name, c.phone, COALESCE((SELECT SUM(total - returned_total) FROM sales WHERE customer_id = c.id),0) AS sales, COALESCE((SELECT SUM(amount) FROM customer_ledger WHERE customer_id = c.id),0) AS balance, c.credit_limit AS "limit" FROM customers c WHERE c.deleted_at IS NULL ORDER BY balance DESC`), ['sales', 'balance']);
    case 'suppliers':
      return mk(
        [{ key: 'name', label: 'Fournisseur', type: 'text' }, { key: 'phone', label: 'Téléphone', type: 'text' }, { key: 'purchases', label: 'Achats reçus', type: 'money' }, { key: 'balance', label: 'Dette', type: 'money' }],
        db.all(`SELECT s.name, s.phone, COALESCE((SELECT SUM(received_total) FROM purchases WHERE supplier_id = s.id AND status <> 'CANCELLED'),0) AS purchases, COALESCE((SELECT SUM(amount) FROM supplier_ledger WHERE supplier_id = s.id),0) AS balance FROM suppliers s WHERE s.deleted_at IS NULL ORDER BY balance DESC`), ['purchases', 'balance']);
    case 'receivables':
      return mk(
        [{ key: 'number', label: 'Vente', type: 'text' }, { key: 'createdAt', label: 'Date', type: 'datetime' }, { key: 'dueDate', label: 'Échéance', type: 'date' }, { key: 'customerName', label: 'Client', type: 'text' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paidTotal', label: 'Payé', type: 'money' }, { key: 'due', label: 'Reste dû', type: 'money' }],
        receivables(ctx) as any[], ['total', 'paidTotal', 'due']);
    case 'payables':
      return mk(
        [{ key: 'number', label: 'Achat', type: 'text' }, { key: 'createdAt', label: 'Date', type: 'datetime' }, { key: 'dueDate', label: 'Échéance', type: 'date' }, { key: 'supplierName', label: 'Fournisseur', type: 'text' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paidTotal', label: 'Payé', type: 'money' }, { key: 'due', label: 'Reste dû', type: 'money' }],
        payables(ctx) as any[], ['total', 'paidTotal', 'due']);
  }
  throw new Error('Rapport inconnu');
}

// ---------- export ----------
const cell = (v: any, type: ColType, minorDecimals: number) => {
  if (v == null) return '';
  if (type === 'money') return v / 10 ** minorDecimals;
  if (type === 'qty') return v / 1000;
  if (type === 'percent') return v / 100;
  return v;
};

export function reportToCsv(ctx: Ctx, rep: Report): string {
  const dec = decimalsOf(ctx);
  const esc = (x: any) => {
    const s = String(x ?? '');
    return /[";\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s;
  };
  const lines = [rep.columns.map((c) => esc(c.label)).join(';')];
  for (const r of rep.rows) lines.push(rep.columns.map((c) => esc(cell(r[c.key], c.type, dec))).join(';'));
  if (rep.totals) lines.push(rep.columns.map((c, i) => (i === 0 ? 'TOTAL' : rep.totals![c.key] !== undefined ? String(cell(rep.totals![c.key], c.type, dec)) : '')).join(';'));
  return '﻿' + lines.join('\r\n');
}

export async function reportToXlsx(ctx: Ctx, rep: Report): Promise<Buffer> {
  const dec = decimalsOf(ctx);
  const wb = new ExcelJS.Workbook();
  wb.creator = companyOf(ctx.db).name;
  const ws = wb.addWorksheet(rep.title.slice(0, 31));
  ws.addRow([rep.title]).font = { bold: true, size: 14 };
  if (rep.period) ws.addRow([`Période : ${rep.period.from} → ${rep.period.to}`]);
  ws.addRow([]);
  const head = ws.addRow(rep.columns.map((c) => c.label));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2338' } }; });
  const fmt = (t: ColType) => (t === 'money' ? (dec === 0 ? '#,##0' : '#,##0.00') : t === 'qty' ? '#,##0.###' : t === 'percent' ? '0.00' : undefined);
  for (const r of rep.rows) ws.addRow(rep.columns.map((c) => cell(r[c.key], c.type, dec)));
  if (rep.totals) {
    const t = ws.addRow(rep.columns.map((c, i) => (i === 0 ? 'TOTAL' : rep.totals![c.key] !== undefined ? cell(rep.totals![c.key], c.type, dec) : '')));
    t.font = { bold: true };
  }
  rep.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, c.label.length + 4);
    if (fmt(c.type)) col.numFmt = fmt(c.type)!;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function decimalsOf(ctx: Ctx): number {
  const c = companyOf(ctx.db).currency;
  return ['MGA', 'KMF', 'XOF'].includes(c) ? 0 : 2;
}

/** HTML imprimable (converti en PDF par Electron). */
export function reportToHtml(ctx: Ctx, rep: Report): string {
  const co = companyOf(ctx.db);
  const dec = decimalsOf(ctx);
  const f = (v: any, t: ColType) => {
    if (v == null) return '';
    if (t === 'money') return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v / 10 ** dec);
    if (t === 'qty') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(v / 1000);
    if (t === 'percent') return (v / 100).toFixed(1) + ' %';
    if (t === 'datetime') return String(v).replace('T', ' ').slice(0, 16);
    return String(v).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);
  };
  const right = (t: ColType) => (['money', 'qty', 'percent', 'int'].includes(t) ? ' style="text-align:right"' : '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#1b2338;font-size:11px;margin:0}
    h1{font-size:18px;margin:0 0 2px} .sub{color:#6b7280;margin-bottom:14px}
    table{border-collapse:collapse;width:100%} th{background:#1b2338;color:#fff;text-align:left;padding:6px 8px;font-weight:600}
    td{padding:5px 8px;border-bottom:1px solid #e5e7eb} tr:nth-child(even) td{background:#f8f9fb} tfoot td{font-weight:700;border-top:2px solid #1b2338}
  </style></head><body><h1>${co.name}</h1><div class="sub">${rep.title}${rep.period ? ` — du ${rep.period.from} au ${rep.period.to}` : ''} · Édité le ${new Date().toLocaleString('fr-FR')}</div>
  <table><thead><tr>${rep.columns.map((c) => `<th${right(c.type)}>${c.label}</th>`).join('')}</tr></thead><tbody>
  ${rep.rows.map((r) => `<tr>${rep.columns.map((c) => `<td${right(c.type)}>${f(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
  ${rep.totals ? `<tfoot><tr>${rep.columns.map((c, i) => `<td${right(c.type)}>${i === 0 ? 'TOTAL' : rep.totals![c.key] !== undefined ? f(rep.totals![c.key], c.type) : ''}</td>`).join('')}</tr></tfoot>` : ''}
  </table></body></html>`;
}
