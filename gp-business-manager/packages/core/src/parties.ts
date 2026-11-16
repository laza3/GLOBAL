import { audit, businessDate, fail, like, nowIso, outbox, uuid, type Ctx } from './util';
import { recordFT, recordPayment } from './finance';

// ---------- clients ----------
export const customerBalance = (ctx: Ctx, id: string) => ctx.db.value<number>('SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id = ?', id) ?? 0;

export function listCustomers(ctx: Ctx, q: { q?: string; withDebt?: boolean; limit?: number }) {
  const s = q.q?.trim() ? like(q.q.trim()) : null;
  const rows = ctx.db.all<any>(
    `SELECT c.id, c.code, c.name, c.phone, c.email, c.address, c.price_tier AS priceTier, c.credit_limit AS creditLimit, c.loyalty_points AS loyaltyPoints, c.active,
            COALESCE((SELECT SUM(amount) FROM customer_ledger l WHERE l.customer_id = c.id),0) AS balance,
            (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS salesCount,
            (SELECT COALESCE(SUM(total - returned_total),0) FROM sales s WHERE s.customer_id = c.id) AS totalSpent
     FROM customers c WHERE c.deleted_at IS NULL AND (? IS NULL OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\')
     ORDER BY c.name LIMIT ?`, s, s, s, s, q.limit ?? 500);
  return q.withDebt ? rows.filter((r) => r.balance > 0) : rows;
}

export function getCustomer(ctx: Ctx, id: string) {
  const c = ctx.db.get<any>('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL', id);
  if (!c) fail('NOT_FOUND', 'Client introuvable');
  return {
    id: c.id, code: c.code, name: c.name, phone: c.phone, email: c.email, address: c.address, taxId: c.tax_id, priceTier: c.price_tier,
    creditLimit: c.credit_limit, loyaltyPoints: c.loyalty_points, notes: c.notes, active: !!c.active, balance: customerBalance(ctx, id),
    ledger: ctx.db.all('SELECT id, at, kind, amount, note, ref_type AS refType, ref_id AS refId FROM customer_ledger WHERE customer_id = ? ORDER BY at DESC, rowid DESC LIMIT 200', id),
    sales: ctx.db.all('SELECT id, number, created_at AS createdAt, total, paid_total AS paidTotal, returned_total AS returnedTotal, payment_status AS paymentStatus FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100', id),
  };
}

export function saveCustomer(ctx: Ctx, i: { id?: string; name: string; code?: string; phone?: string; email?: string; address?: string; taxId?: string; priceTier?: 'RETAIL' | 'WHOLESALE'; creditLimit?: number; notes?: string; active?: boolean }) {
  if (!i.name.trim()) fail('INVALID', 'Le nom est obligatoire');
  if ((i.creditLimit ?? 0) < 0) fail('INVALID', 'Le plafond de crédit ne peut pas être négatif');
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) {
    ctx.db.run('UPDATE customers SET name=?, code=?, phone=?, email=?, address=?, tax_id=?, price_tier=?, credit_limit=?, notes=?, active=?, version=version+1, updated_at=? WHERE id=?',
      i.name.trim(), i.code ?? null, i.phone ?? null, i.email ?? null, i.address ?? null, i.taxId ?? null, i.priceTier ?? 'RETAIL', i.creditLimit ?? 0, i.notes ?? null, i.active === false ? 0 : 1, t, id);
  } else {
    ctx.db.run('INSERT INTO customers (id, name, code, phone, email, address, tax_id, price_tier, credit_limit, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, i.name.trim(), i.code ?? null, i.phone ?? null, i.email ?? null, i.address ?? null, i.taxId ?? null, i.priceTier ?? 'RETAIL', i.creditLimit ?? 0, i.notes ?? null, t, t);
  }
  outbox(ctx.db, 'customer', id, i.id ? 'UPDATE' : 'INSERT', { name: i.name });
  audit(ctx, 'customer.save', 'customer', id);
  return { id };
}
export function deleteCustomer(ctx: Ctx, id: string) {
  if (customerBalance(ctx, id) !== 0) fail('HAS_BALANCE', 'Le compte client doit être soldé avant suppression');
  ctx.db.run('UPDATE customers SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  outbox(ctx.db, 'customer', id, 'DELETE');
  audit(ctx, 'customer.delete', 'customer', id);
}

export function ledgerCustomer(ctx: Ctx, customerId: string, kind: string, amount: number, ref?: { refType?: string; refId?: string; note?: string }) {
  ctx.db.run('INSERT INTO customer_ledger (id, customer_id, kind, amount, ref_type, ref_id, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?)', uuid(), customerId, kind, amount, ref?.refType ?? null, ref?.refId ?? null, ref?.note ?? null, ctx.user.id, nowIso());
}

/**
 * Encaissement d'une dette client : le paiement est affecté aux ventes impayées les plus anciennes (FIFO) ;
 * l'éventuel excédent devient une avance (solde créditeur).
 */
export function receiveCustomerPayment(ctx: Ctx, i: { customerId: string; methodId: string; amount: number; sessionId?: string | null; note?: string }) {
  if (!Number.isInteger(i.amount) || i.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  return ctx.db.tx(() => {
    const bal = customerBalance(ctx, i.customerId);
    const owed = Math.max(bal, 0);
    const toDebt = Math.min(i.amount, owed);
    const advance = i.amount - toDebt;
    const pay = recordPayment(ctx, {
      direction: 'IN', methodId: i.methodId, amount: i.amount, customerId: i.customerId, sessionId: i.sessionId ?? currentSessionOfUser(ctx),
      ftKind: advance > 0 && toDebt === 0 ? 'CUSTOMER_ADVANCE' : 'CUSTOMER_PAYMENT', cashType: 'CUSTOMER_PAYMENT', note: i.note,
    });
    if (toDebt > 0) {
      ledgerCustomer(ctx, i.customerId, 'PAYMENT', -toDebt, { refType: 'payment', refId: pay.id, note: i.note });
      let left = toDebt;
      const open = ctx.db.all<any>(
        `SELECT id, total - returned_total - paid_total AS due FROM sales WHERE customer_id = ? AND payment_status <> 'PAID' AND total - returned_total - paid_total > 0 ORDER BY created_at`, i.customerId);
      for (const s of open) {
        if (left <= 0) break;
        const a = Math.min(left, s.due);
        ctx.db.run('INSERT INTO payment_allocations (payment_id, sale_id, amount) VALUES (?,?,?)', pay.id, s.id, a);
        const paid = ctx.db.value<number>('SELECT paid_total FROM sales WHERE id = ?', s.id)! + a;
        ctx.db.run(`UPDATE sales SET paid_total = ?, payment_status = CASE WHEN total - returned_total - ? <= 0 THEN 'PAID' ELSE 'PARTIAL' END, updated_at = ? WHERE id = ?`, paid, paid, nowIso(), s.id);
        left -= a;
      }
    }
    if (advance > 0) ledgerCustomer(ctx, i.customerId, 'ADVANCE', -advance, { refType: 'payment', refId: pay.id, note: 'Avance client' });
    audit(ctx, 'customer.payment', 'customer', i.customerId, { amount: i.amount, advance });
    return { paymentId: pay.id, appliedToDebt: toDebt, advance };
  });
}
export function currentSessionOfUser(ctx: Ctx): string | null {
  return ctx.db.value<string>("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", ctx.user.id) ?? null;
}

// ---------- fournisseurs ----------
export const supplierBalance = (ctx: Ctx, id: string) => ctx.db.value<number>('SELECT COALESCE(SUM(amount),0) FROM supplier_ledger WHERE supplier_id = ?', id) ?? 0;
export function listSuppliers(ctx: Ctx, q: { q?: string; limit?: number }) {
  const s = q.q?.trim() ? like(q.q.trim()) : null;
  return ctx.db.all(
    `SELECT s.id, s.code, s.name, s.contact, s.phone, s.email, s.address, s.payment_terms_days AS paymentTermsDays, s.active,
            COALESCE((SELECT SUM(amount) FROM supplier_ledger l WHERE l.supplier_id = s.id),0) AS balance
     FROM suppliers s WHERE s.deleted_at IS NULL AND (? IS NULL OR s.name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\') ORDER BY s.name LIMIT ?`, s, s, s, q.limit ?? 500);
}
export function getSupplier(ctx: Ctx, id: string) {
  const s = ctx.db.get<any>('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', id);
  if (!s) fail('NOT_FOUND', 'Fournisseur introuvable');
  return {
    id: s.id, code: s.code, name: s.name, contact: s.contact, phone: s.phone, email: s.email, address: s.address, taxId: s.tax_id, paymentTermsDays: s.payment_terms_days, notes: s.notes, active: !!s.active,
    balance: supplierBalance(ctx, id),
    ledger: ctx.db.all('SELECT id, at, kind, amount, due_date AS dueDate, note, ref_type AS refType, ref_id AS refId FROM supplier_ledger WHERE supplier_id = ? ORDER BY at DESC, rowid DESC LIMIT 200', id),
    purchases: ctx.db.all('SELECT id, number, status, total, received_total AS receivedTotal, paid_total AS paidTotal, created_at AS createdAt, due_date AS dueDate FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 100', id),
  };
}
export function saveSupplier(ctx: Ctx, i: { id?: string; name: string; code?: string; contact?: string; phone?: string; email?: string; address?: string; taxId?: string; paymentTermsDays?: number; notes?: string; active?: boolean }) {
  if (!i.name.trim()) fail('INVALID', 'Le nom est obligatoire');
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE suppliers SET name=?, code=?, contact=?, phone=?, email=?, address=?, tax_id=?, payment_terms_days=?, notes=?, active=?, version=version+1, updated_at=? WHERE id=?',
    i.name.trim(), i.code ?? null, i.contact ?? null, i.phone ?? null, i.email ?? null, i.address ?? null, i.taxId ?? null, i.paymentTermsDays ?? 0, i.notes ?? null, i.active === false ? 0 : 1, t, id);
  else ctx.db.run('INSERT INTO suppliers (id, name, code, contact, phone, email, address, tax_id, payment_terms_days, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, i.name.trim(), i.code ?? null, i.contact ?? null, i.phone ?? null, i.email ?? null, i.address ?? null, i.taxId ?? null, i.paymentTermsDays ?? 0, i.notes ?? null, t, t);
  outbox(ctx.db, 'supplier', id, i.id ? 'UPDATE' : 'INSERT', { name: i.name });
  audit(ctx, 'supplier.save', 'supplier', id);
  return { id };
}
export function deleteSupplier(ctx: Ctx, id: string) {
  if (supplierBalance(ctx, id) !== 0) fail('HAS_BALANCE', 'Le compte fournisseur doit être soldé avant suppression');
  ctx.db.run('UPDATE suppliers SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  outbox(ctx.db, 'supplier', id, 'DELETE');
}
export function ledgerSupplier(ctx: Ctx, supplierId: string, kind: string, amount: number, ref?: { refType?: string; refId?: string; dueDate?: string | null; note?: string }) {
  ctx.db.run('INSERT INTO supplier_ledger (id, supplier_id, kind, amount, ref_type, ref_id, due_date, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)', uuid(), supplierId, kind, amount, ref?.refType ?? null, ref?.refId ?? null, ref?.dueDate ?? null, ref?.note ?? null, ctx.user.id, nowIso());
}

/** Paiement fournisseur (total ou partiel) : affecté aux achats réceptionnés les plus anciens. */
export function paySupplier(ctx: Ctx, i: { supplierId: string; methodId: string; amount: number; purchaseId?: string; note?: string }) {
  if (!Number.isInteger(i.amount) || i.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  return ctx.db.tx(() => {
    const bal = supplierBalance(ctx, i.supplierId);
    if (i.amount > bal) fail('OVERPAYMENT', `Le paiement dépasse la dette (${bal})`);
    const pay = recordPayment(ctx, { direction: 'OUT', methodId: i.methodId, amount: i.amount, supplierId: i.supplierId, purchaseId: i.purchaseId, sessionId: currentSessionOfUser(ctx), ftKind: 'SUPPLIER_PAYMENT', cashType: 'SUPPLIER_PAYMENT', note: i.note });
    ledgerSupplier(ctx, i.supplierId, 'PAYMENT', -i.amount, { refType: 'payment', refId: pay.id, note: i.note });
    let left = i.amount;
    const open = i.purchaseId
      ? ctx.db.all<any>('SELECT id, received_total - paid_total AS due FROM purchases WHERE id = ?', i.purchaseId)
      : ctx.db.all<any>("SELECT id, received_total - paid_total AS due FROM purchases WHERE supplier_id = ? AND received_total > paid_total AND status <> 'CANCELLED' ORDER BY created_at", i.supplierId);
    for (const p of open) {
      if (left <= 0) break;
      const a = Math.min(left, p.due);
      if (a > 0) { ctx.db.run('UPDATE purchases SET paid_total = paid_total + ?, updated_at = ? WHERE id = ?', a, nowIso(), p.id); left -= a; }
    }
    audit(ctx, 'supplier.payment', 'supplier', i.supplierId, { amount: i.amount });
    return { paymentId: pay.id };
  });
}

export function receivables(ctx: Ctx) {
  return ctx.db.all(
    `SELECT s.id, s.number, s.created_at AS createdAt, s.due_date AS dueDate, c.name AS customerName, c.phone, s.total - s.returned_total AS total, s.paid_total AS paidTotal,
            s.total - s.returned_total - s.paid_total AS due
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.payment_status <> 'PAID' AND s.total - s.returned_total - s.paid_total > 0 ORDER BY s.created_at`);
}
export function payables(ctx: Ctx) {
  return ctx.db.all(
    `SELECT p.id, p.number, p.created_at AS createdAt, p.due_date AS dueDate, s.name AS supplierName, p.received_total AS total, p.paid_total AS paidTotal, p.received_total - p.paid_total AS due
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.received_total > p.paid_total AND p.status <> 'CANCELLED' ORDER BY COALESCE(p.due_date, p.created_at)`);
}
void businessDate; void recordFT;
