import type { Ctx } from './util';
import { audit, branchScope, fail, nowIso, outbox, uuid } from './util';

// ---------- entreprise / paramètres ----------
export function getCompany(ctx: Ctx) {
  const c = ctx.company();
  return {
    id: c.id, name: c.name, legalName: c.legal_name, taxId: c.tax_id, statNo: c.stat_no, address: c.address, phone: c.phone, email: c.email,
    logo: c.logo, currency: c.currency, locale: c.locale, timezone: c.timezone, pricesIncludeTax: !!c.prices_include_tax,
    allowNegativeStock: !!c.allow_negative_stock, maxCashierDiscountBp: c.max_cashier_discount_bp,
    receiptFooter: c.receipt_footer, invoiceNotes: c.invoice_notes, numbering: JSON.parse(c.numbering_json || '{}') as Record<string, string>,
  };
}

export interface CompanyInput {
  name?: string; legalName?: string | null; taxId?: string | null; statNo?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  logo?: string | null; currency?: string; locale?: 'fr' | 'en'; timezone?: string; pricesIncludeTax?: boolean; allowNegativeStock?: boolean;
  maxCashierDiscountBp?: number; receiptFooter?: string | null; invoiceNotes?: string | null; numbering?: Record<string, string>;
}
export function updateCompany(ctx: Ctx, i: CompanyInput) {
  const c = ctx.company();
  const hasSales = !!ctx.db.get('SELECT 1 FROM sales LIMIT 1');
  if (hasSales && ((i.currency && i.currency !== c.currency) || (i.pricesIncludeTax !== undefined && i.pricesIncludeTax !== !!c.prices_include_tax))) {
    fail('LOCKED', "La devise et le mode de taxation ne peuvent plus être modifiés après la première vente");
  }
  const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
  ctx.db.run(
    `UPDATE company SET name=?, legal_name=?, tax_id=?, stat_no=?, address=?, phone=?, email=?, logo=?, currency=?, locale=?, timezone=?,
     prices_include_tax=?, allow_negative_stock=?, max_cashier_discount_bp=?, receipt_footer=?, invoice_notes=?, numbering_json=?`,
    pick(i.name, c.name), pick(i.legalName, c.legal_name), pick(i.taxId, c.tax_id), pick(i.statNo, c.stat_no), pick(i.address, c.address),
    pick(i.phone, c.phone), pick(i.email, c.email), pick(i.logo, c.logo), pick(i.currency, c.currency), pick(i.locale, c.locale), pick(i.timezone, c.timezone),
    i.pricesIncludeTax === undefined ? c.prices_include_tax : i.pricesIncludeTax ? 1 : 0,
    i.allowNegativeStock === undefined ? c.allow_negative_stock : i.allowNegativeStock ? 1 : 0,
    pick(i.maxCashierDiscountBp, c.max_cashier_discount_bp), pick(i.receiptFooter, c.receipt_footer), pick(i.invoiceNotes, c.invoice_notes),
    i.numbering ? JSON.stringify(i.numbering) : c.numbering_json,
  );
  audit(ctx, 'company.update', 'company', c.id, { ...i, logo: i.logo ? '[image]' : i.logo });
}

// ---------- organisation : établissements, entrepôts, caisses ----------
export const listBranches = (ctx: Ctx) => ctx.db.all('SELECT id, name, code, address, phone, active FROM branches WHERE deleted_at IS NULL AND (? IS NULL OR id = ?) ORDER BY name', branchScope(ctx), branchScope(ctx));
export function saveBranch(ctx: Ctx, i: { id?: string; name: string; code?: string; address?: string; phone?: string; active?: boolean }) {
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE branches SET name=?, code=?, address=?, phone=?, active=?, updated_at=? WHERE id=?', i.name, i.code ?? null, i.address ?? null, i.phone ?? null, i.active === false ? 0 : 1, t, id);
  else ctx.db.run('INSERT INTO branches (id, name, code, address, phone, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, i.name, i.code ?? null, i.address ?? null, i.phone ?? null, t, t);
  outbox(ctx.db, 'branch', id, i.id ? 'UPDATE' : 'INSERT', i);
  audit(ctx, 'branch.save', 'branch', id);
  return { id };
}
export const listWarehouses = (ctx: Ctx) =>
  ctx.db.all('SELECT w.id, w.name, w.branch_id AS branchId, b.name AS branchName, w.is_default AS isDefault, w.active FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE w.deleted_at IS NULL AND (? IS NULL OR w.branch_id = ?) ORDER BY w.name', branchScope(ctx), branchScope(ctx));
export function saveWarehouse(ctx: Ctx, i: { id?: string; branchId: string; name: string; active?: boolean }) {
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE warehouses SET branch_id=?, name=?, active=?, updated_at=? WHERE id=?', i.branchId, i.name, i.active === false ? 0 : 1, t, id);
  else ctx.db.run('INSERT INTO warehouses (id, branch_id, name, created_at, updated_at) VALUES (?,?,?,?,?)', id, i.branchId, i.name, t, t);
  outbox(ctx.db, 'warehouse', id, i.id ? 'UPDATE' : 'INSERT', i);
  audit(ctx, 'warehouse.save', 'warehouse', id);
  return { id };
}
export const listRegisters = (ctx: Ctx) =>
  ctx.db.all(
    `SELECT r.id, r.name, r.branch_id AS branchId, b.name AS branchName, r.warehouse_id AS warehouseId, w.name AS warehouseName, r.account_id AS accountId, r.active,
            (SELECT id FROM cash_sessions s WHERE s.register_id = r.id AND s.status = 'OPEN') AS openSessionId
     FROM cash_registers r JOIN branches b ON b.id = r.branch_id JOIN warehouses w ON w.id = r.warehouse_id WHERE (? IS NULL OR r.branch_id = ?) ORDER BY r.name`,
    branchScope(ctx), branchScope(ctx),
  );
export function saveRegister(ctx: Ctx, i: { id?: string; branchId: string; warehouseId: string; name: string; active?: boolean }) {
  const t = nowIso();
  return ctx.db.tx(() => {
    const id = i.id ?? uuid();
    if (i.id) ctx.db.run('UPDATE cash_registers SET branch_id=?, warehouse_id=?, name=?, active=?, updated_at=? WHERE id=?', i.branchId, i.warehouseId, i.name, i.active === false ? 0 : 1, t, id);
    else {
      const acc = uuid();
      ctx.db.run("INSERT INTO financial_accounts (id, name, type, created_at, updated_at) VALUES (?,?,'CASH',?,?)", acc, `Caisse — ${i.name}`, t, t);
      ctx.db.run('INSERT INTO cash_registers (id, branch_id, warehouse_id, account_id, name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, i.branchId, i.warehouseId, acc, i.name, t, t);
    }
    audit(ctx, 'register.save', 'register', id);
    return { id };
  });
}

// ---------- référentiels ----------
export const listPaymentMethods = (ctx: Ctx, all = false) =>
  ctx.db.all(`SELECT id, code, name, kind, account_id AS accountId, active FROM payment_methods ${all ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
export function savePaymentMethod(ctx: Ctx, i: { id?: string; code: string; name: string; kind: string; accountId?: string | null; active?: boolean }) {
  const id = i.id ?? uuid();
  if (i.id) {
    const cur = ctx.db.get<any>('SELECT kind FROM payment_methods WHERE id = ?', id);
    if (cur?.kind === 'CASH' && i.kind !== 'CASH') fail('PROTECTED', 'Le mode Espèces ne peut pas changer de type');
    ctx.db.run('UPDATE payment_methods SET name=?, account_id=?, active=? WHERE id=?', i.name, i.accountId ?? null, i.active === false ? 0 : 1, id);
  } else {
    ctx.db.run('INSERT INTO payment_methods (id, code, name, kind, account_id, sort) VALUES (?,?,?,?,?,99)', id, i.code.toUpperCase(), i.name, i.kind, i.accountId ?? null);
  }
  audit(ctx, 'payment_method.save', 'payment_method', id);
  return { id };
}
export const listTaxRates = (ctx: Ctx) => ctx.db.all('SELECT id, name, rate_bp AS rateBp, is_default AS isDefault, active FROM tax_rates WHERE active = 1 ORDER BY rate_bp');
export function saveTaxRate(ctx: Ctx, i: { id?: string; name: string; rateBp: number; isDefault?: boolean }) {
  return ctx.db.tx(() => {
    const id = i.id ?? uuid();
    if (i.isDefault) ctx.db.run('UPDATE tax_rates SET is_default = 0');
    if (i.id) ctx.db.run('UPDATE tax_rates SET name=?, rate_bp=?, is_default=? WHERE id=?', i.name, i.rateBp, i.isDefault ? 1 : 0, id);
    else ctx.db.run('INSERT INTO tax_rates (id, name, rate_bp, is_default) VALUES (?,?,?,?)', id, i.name, i.rateBp, i.isDefault ? 1 : 0);
    audit(ctx, 'tax.save', 'tax_rate', id);
    return { id };
  });
}
export const listUnits = (ctx: Ctx) => ctx.db.all('SELECT id, code, name, allow_decimal AS allowDecimal FROM units ORDER BY name');
export function saveUnit(ctx: Ctx, i: { code: string; name: string; allowDecimal?: boolean }) {
  const id = uuid();
  ctx.db.run('INSERT INTO units (id, code, name, allow_decimal) VALUES (?,?,?,?)', id, i.code, i.name, i.allowDecimal ? 1 : 0);
  return { id };
}
export const listExpenseCategories = (ctx: Ctx) => ctx.db.all('SELECT id, name FROM expense_categories WHERE active = 1 ORDER BY name');
export function saveExpenseCategory(ctx: Ctx, i: { name: string }) {
  const id = uuid();
  ctx.db.run('INSERT INTO expense_categories (id, name) VALUES (?,?)', id, i.name);
  return { id };
}
