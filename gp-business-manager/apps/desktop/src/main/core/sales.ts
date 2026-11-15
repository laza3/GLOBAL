import { computeCart, proratedReturn, settlePayments, type CartDiscount, type PaymentKind } from '@gp/shared';
import { effectivePrice } from './catalog';
import { recordFT, recordPayment } from './finance';
import { customerBalance, ledgerCustomer } from './parties';
import { applyMovement } from './stock';
import { audit, businessDate, fail, nextNumber, nowIso, numberingOf, outbox, requirePerm, uuid, can, type Ctx } from './util';

export interface SaleItemInput {
  variantId: string;
  qtyMilli: number;
  /** remplace le prix du catalogue (nécessite sale.discount) */
  unitPrice?: number;
  discountBp?: number;
  discountAmount?: number;
}
export interface SaleInput {
  /** identifiant fourni par le client : garantit l'idempotence (rejeu hors ligne) */
  id?: string;
  registerId: string;
  customerId?: string | null;
  items: SaleItemInput[];
  cartDiscount?: CartDiscount;
  payments: { methodId: string; amount: number }[];
  /** utilisation d'une avance client existante */
  advanceUsed?: number;
  dueDate?: string | null;
  note?: string;
}

/** Vente validée : atomique (stock + vente + paiements + trésorerie + caisse + créance + outbox dans UNE transaction). */
export function createSale(ctx: Ctx, input: SaleInput) {
  requirePerm(ctx, 'sale.create');
  if (!input.items.length) fail('EMPTY_CART', 'Le panier est vide');
  const company = ctx.company();

  return ctx.db.tx(() => {
    if (input.id) {
      const existing = ctx.db.get<any>('SELECT id, number, total, paid_total, change_given FROM sales WHERE id = ?', input.id);
      if (existing) return { id: existing.id, number: existing.number, total: existing.total, paidTotal: existing.paid_total, change: existing.change_given, creditAmount: existing.total - existing.paid_total, duplicate: true };
    }
    const reg = ctx.db.get<any>('SELECT * FROM cash_registers WHERE id = ? AND active = 1', input.registerId);
    if (!reg) fail('NOT_FOUND', 'Caisse introuvable');
    const session = ctx.db.get<any>("SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'OPEN'", input.registerId);
    if (!session) fail('NO_SESSION', "La caisse n'est pas ouverte : ouvrez une session de caisse avant de vendre");

    const customer = input.customerId ? ctx.db.get<any>('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL AND active = 1', input.customerId) : undefined;
    if (input.customerId && !customer) fail('NOT_FOUND', 'Client introuvable');
    const tier: 'RETAIL' | 'WHOLESALE' = customer?.price_tier ?? 'RETAIL';
    const today = businessDate(company.timezone);

    // 1. lignes : le prix vient TOUJOURS de la base (sauf dérogation autorisée)
    const prepared = input.items.map((it) => {
      if (!Number.isInteger(it.qtyMilli) || it.qtyMilli <= 0) fail('INVALID_QTY', 'Quantité invalide');
      const v = ctx.db.get<any>(
        `SELECT v.*, p.name AS pname, p.track_stock, p.tax_rate_id, p.unit_id, COALESCE(t.rate_bp,0) AS rate_bp, u.allow_decimal
         FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN tax_rates t ON t.id = p.tax_rate_id LEFT JOIN units u ON u.id = p.unit_id
         WHERE v.id = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND v.active = 1 AND p.active = 1`, it.variantId);
      if (!v) fail('NOT_FOUND', 'Article introuvable ou inactif');
      if (!v.allow_decimal && it.qtyMilli % 1000 !== 0) fail('INVALID_QTY', `« ${v.pname} » se vend à l'unité (quantité entière)`);
      let unitPrice = effectivePrice(v, tier, today).price;
      if (it.unitPrice !== undefined && it.unitPrice !== unitPrice) {
        requirePerm(ctx, 'sale.discount');
        if (it.unitPrice < 0 || !Number.isInteger(it.unitPrice)) fail('INVALID_AMOUNT', 'Prix invalide');
        unitPrice = it.unitPrice;
      }
      const label = v.name || [v.size, v.color].filter(Boolean).join(' ');
      return { it, v, unitPrice, name: label ? `${v.pname} — ${label}` : v.pname };
    });

    const cart = computeCart(
      prepared.map((p) => ({ qtyMilli: p.it.qtyMilli, unitPrice: p.unitPrice, discountBp: p.it.discountBp, discountAmount: p.it.discountAmount, taxRateBp: p.v.rate_bp })),
      { pricesIncludeTax: !!company.prices_include_tax, cartDiscount: input.cartDiscount ?? null },
    );

    // 2. contrôle des remises
    const discountTotal = cart.lineDiscountTotal + cart.cartDiscountTotal;
    if (discountTotal > 0 && !can(ctx, 'sale.discount')) {
      const limit = Math.floor((cart.subtotal * company.max_cashier_discount_bp) / 10000);
      if (discountTotal > limit) fail('DISCOUNT_LIMIT', `Remise supérieure à la limite autorisée (${company.max_cashier_discount_bp / 100} %) : demandez l'accord d'un responsable`);
    }

    // 3. règlement
    const methods = new Map(ctx.db.all<any>('SELECT id, kind FROM payment_methods WHERE active = 1').map((m) => [m.id, m]));
    const pays = input.payments.map((p) => {
      const m = methods.get(p.methodId);
      if (!m) fail('NOT_FOUND', 'Mode de paiement invalide');
      return { methodId: p.methodId, kind: m.kind as PaymentKind, amount: p.amount };
    });
    const advance = input.advanceUsed ?? 0;
    if (advance > 0) {
      if (!customer) fail('CUSTOMER_REQUIRED', 'Un client est requis pour utiliser une avance');
      const available = Math.max(0, -customerBalance(ctx, customer.id));
      if (advance > available) fail('INSUFFICIENT_ADVANCE', `Avance disponible insuffisante (${available})`);
      if (advance > cart.total) fail('INVALID_AMOUNT', "L'avance dépasse le total de la vente");
    }
    const settlement = settlePayments(cart.total - advance, pays);
    const paidTotal = settlement.paidTotal + advance;
    const credit = settlement.creditAmount;
    if (credit > 0) {
      if (!customer) fail('CUSTOMER_REQUIRED', 'Un client est requis pour une vente à crédit ou un paiement partiel');
      requirePerm(ctx, 'sale.credit');
      const limit = customer.credit_limit;
      const after = Math.max(customerBalance(ctx, customer.id), 0) + credit;
      if (limit <= 0) fail('CREDIT_NOT_ALLOWED', "Ce client n'a pas de crédit autorisé");
      if (after > limit) fail('CREDIT_LIMIT', `Plafond de crédit dépassé (${after} > ${limit})`);
    }

    // 4. écriture de la vente
    const id = input.id ?? uuid();
    const number = nextNumber(ctx.db, 'SALE', numberingOf(company));
    const at = nowIso();
    const bd = businessDate(company.timezone);
    ctx.db.run(
      `INSERT INTO sales (id, number, branch_id, register_id, session_id, warehouse_id, customer_id, user_id, price_tier, subtotal, line_discount_total, cart_discount_total,
        net_total, tax_total, total, paid_total, change_given, payment_status, due_date, note, prices_include_tax, created_at, business_date, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, number, reg.branch_id, reg.id, session.id, reg.warehouse_id, customer?.id ?? null, ctx.user.id, tier, cart.subtotal, cart.lineDiscountTotal, cart.cartDiscountTotal,
      cart.netTotal, cart.taxTotal, cart.total, paidTotal, settlement.change, credit === 0 ? 'PAID' : paidTotal > 0 ? 'PARTIAL' : 'UNPAID',
      credit > 0 ? input.dueDate ?? null : null, input.note ?? null, company.prices_include_tax, at, bd, at,
    );

    prepared.forEach((p, i) => {
      const r = cart.lines[i];
      const mv = applyMovement(ctx, { variantId: p.v.id, warehouseId: reg.warehouse_id, type: 'SALE', qtyMilli: -p.it.qtyMilli, refType: 'sale', refId: id });
      const itemId = uuid();
      ctx.db.run(
        `INSERT INTO sale_items (id, sale_id, variant_id, name, sku, qty_milli, unit_price, discount, cart_discount_share, tax_rate_bp, net, tax, total, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        itemId, id, p.v.id, p.name, p.v.sku, p.it.qtyMilli, p.unitPrice, r.lineDiscount, r.cartDiscountShare, p.v.rate_bp, r.net, r.tax, r.total, p.v.track_stock ? mv.unitCost : p.v.cost_price,
      );
    });

    for (const p of settlement.payments) {
      recordPayment(ctx, { direction: 'IN', methodId: p.methodId, amount: p.applied, tendered: p.tendered, saleId: id, customerId: customer?.id, sessionId: session.id, cashAccountId: reg.account_id, ftKind: 'SALE_RECEIPT', cashType: 'SALE' });
    }
    if (advance > 0) ledgerCustomer(ctx, customer.id, 'ADVANCE_USED', advance, { refType: 'sale', refId: id, note: `Avance utilisée — ${number}` });
    if (credit > 0) ledgerCustomer(ctx, customer.id, 'SALE_CREDIT', credit, { refType: 'sale', refId: id, note: number });

    outbox(ctx.db, 'sale', id, 'INSERT', { number, total: cart.total, customerId: customer?.id ?? null });
    audit(ctx, 'sale.create', 'sale', id, { number, total: cart.total, credit });
    return { id, number, total: cart.total, paidTotal, change: settlement.change, creditAmount: credit, duplicate: false };
  });
}

// ---------- retours & remboursements ----------
export interface ReturnInput {
  saleId: string;
  items: { saleItemId: string; qtyMilli: number }[];
  /** METHOD : rembourser par un mode de paiement ; STORE_CREDIT : créditer le compte client (avance) */
  refundMode?: 'METHOD' | 'STORE_CREDIT';
  refundMethodId?: string;
  restock?: boolean;
  reason?: string;
}

export function createReturn(ctx: Ctx, input: ReturnInput) {
  requirePerm(ctx, 'sale.return');
  if (!input.items.length) fail('EMPTY_CART', 'Aucun article à retourner');
  return ctx.db.tx(() => {
    const sale = ctx.db.get<any>('SELECT * FROM sales WHERE id = ?', input.saleId);
    if (!sale) fail('NOT_FOUND', 'Vente introuvable');
    const restock = input.restock !== false;
    let net = 0, tax = 0, total = 0, cost = 0;
    const lines: any[] = [];
    for (const it of input.items) {
      const si = ctx.db.get<any>('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', it.saleItemId, input.saleId);
      if (!si) fail('NOT_FOUND', 'Ligne de vente introuvable');
      if (!Number.isInteger(it.qtyMilli) || it.qtyMilli <= 0) fail('INVALID_QTY', 'Quantité invalide');
      if (si.returned_milli + it.qtyMilli > si.qty_milli) fail('OVER_RETURN', `Quantité retournée supérieure à la quantité vendue pour « ${si.name} »`);
      const pr = (amount: number) => proratedReturn(amount, si.qty_milli, si.returned_milli, it.qtyMilli);
      const l = { si, qty: it.qtyMilli, net: pr(si.net), tax: pr(si.tax), total: pr(si.total), cost: Math.round((si.unit_cost * it.qtyMilli) / 1000) };
      lines.push(l);
      net += l.net; tax += l.tax; total += l.total; cost += l.cost;
    }
    const returnedAfter = sale.returned_total + total;
    const dueAfter = sale.total - returnedAfter;
    const refundable = Math.max(0, sale.paid_total - dueAfter);
    const receivableReduction = total - refundable;

    const rid = uuid();
    const number = nextNumber(ctx.db, 'RETURN', numberingOf(ctx.company()));
    const at = nowIso();
    const session = ctx.db.value<string>("SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'OPEN'", sale.register_id) ?? ctx.db.value<string>("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'OPEN'", ctx.user.id) ?? null;
    ctx.db.run(
      `INSERT INTO sale_returns (id, number, sale_id, session_id, net_total, tax_total, total, cost_total, refund_total, receivable_reduction, restock, reason, user_id, at, business_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      rid, number, sale.id, session, net, tax, total, cost, refundable, receivableReduction, restock ? 1 : 0, input.reason ?? null, ctx.user.id, at, businessDate(ctx.company().timezone),
    );
    for (const l of lines) {
      ctx.db.run('INSERT INTO sale_return_items (return_id, sale_item_id, qty_milli, net, tax, total, cost) VALUES (?,?,?,?,?,?,?)', rid, l.si.id, l.qty, l.net, l.tax, l.total, l.cost);
      ctx.db.run('UPDATE sale_items SET returned_milli = returned_milli + ? WHERE id = ?', l.qty, l.si.id);
      if (restock) applyMovement(ctx, { variantId: l.si.variant_id, warehouseId: sale.warehouse_id, type: 'RETURN_IN', qtyMilli: l.qty, unitCost: l.si.unit_cost, refType: 'return', refId: rid, reason: input.reason });
    }

    if (refundable > 0) {
      if (input.refundMode === 'STORE_CREDIT') {
        if (!sale.customer_id) fail('CUSTOMER_REQUIRED', 'Un client est requis pour un avoir client');
        ledgerCustomer(ctx, sale.customer_id, 'ADVANCE', -refundable, { refType: 'return', refId: rid, note: `Avoir ${number}` });
      } else {
        if (!input.refundMethodId) fail('REFUND_METHOD_REQUIRED', 'Choisissez le mode de remboursement');
        const kind = ctx.db.value<string>('SELECT kind FROM payment_methods WHERE id = ?', input.refundMethodId);
        if (kind === 'CASH' && !session) fail('NO_SESSION', 'Ouvrez une session de caisse pour rembourser en espèces');
        const cashAcc = kind === 'CASH' && session ? ctx.db.value<string>('SELECT r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = ?', session) : null;
        recordPayment(ctx, { direction: 'OUT', methodId: input.refundMethodId!, amount: refundable, saleId: sale.id, returnId: rid, customerId: sale.customer_id ?? undefined, sessionId: session, cashAccountId: cashAcc ?? undefined, ftKind: 'REFUND', cashType: 'REFUND', note: `Remboursement ${number}` });
      }
    }
    if (receivableReduction > 0 && sale.customer_id) ledgerCustomer(ctx, sale.customer_id, 'RETURN', -receivableReduction, { refType: 'return', refId: rid, note: `Retour ${number}` });

    const paidAfter = sale.paid_total - refundable;
    const status = sale.total - returnedAfter - paidAfter <= 0 ? 'PAID' : paidAfter > 0 ? 'PARTIAL' : 'UNPAID';
    ctx.db.run('UPDATE sales SET returned_total = ?, paid_total = ?, payment_status = ?, updated_at = ? WHERE id = ?', returnedAfter, paidAfter, status, at, sale.id);
    ctx.db.run('INSERT INTO credit_notes (id, number, return_id, customer_id, amount, at) VALUES (?,?,?,?,?,?)', uuid(), nextNumber(ctx.db, 'CREDIT_NOTE', numberingOf(ctx.company())), rid, sale.customer_id, total, at);
    outbox(ctx.db, 'sale_return', rid, 'INSERT', { saleId: sale.id, total });
    audit(ctx, 'sale.return', 'sale_return', rid, { number, total, refund: refundable });
    return { id: rid, number, total, refunded: refundable, receivableReduction };
  });
}

// ---------- factures ----------
export function issueInvoice(ctx: Ctx, saleId: string) {
  const ex = ctx.db.get<any>('SELECT id, number FROM invoices WHERE sale_id = ?', saleId);
  if (ex) return ex;
  return ctx.db.tx(() => {
    const sale = ctx.db.get<any>('SELECT * FROM sales WHERE id = ?', saleId);
    if (!sale) fail('NOT_FOUND', 'Vente introuvable');
    const id = uuid();
    const number = nextNumber(ctx.db, 'INVOICE', numberingOf(ctx.company()));
    ctx.db.run('INSERT INTO invoices (id, number, sale_id, customer_id, issued_at, due_date, user_id) VALUES (?,?,?,?,?,?,?)', id, number, saleId, sale.customer_id, nowIso(), sale.due_date, ctx.user.id);
    outbox(ctx.db, 'invoice', id, 'INSERT', { number });
    audit(ctx, 'invoice.issue', 'invoice', id, { number, saleId });
    return { id, number };
  });
}

// ---------- paniers en attente ----------
export function holdCart(ctx: Ctx, i: { label?: string; payload: unknown }) {
  const id = uuid();
  ctx.db.run('INSERT INTO held_carts (id, label, user_id, payload, created_at) VALUES (?,?,?,?,?)', id, i.label ?? null, ctx.user.id, JSON.stringify(i.payload), nowIso());
  return { id };
}
export const listHeld = (ctx: Ctx) => ctx.db.all('SELECT h.id, h.label, h.created_at AS createdAt, h.payload, u.display_name AS userName FROM held_carts h LEFT JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC').map((r: any) => ({ ...r, payload: JSON.parse(r.payload) }));
export function resumeHeld(ctx: Ctx, id: string) {
  const r = ctx.db.get<any>('SELECT payload FROM held_carts WHERE id = ?', id);
  if (!r) fail('NOT_FOUND', 'Panier introuvable');
  ctx.db.run('DELETE FROM held_carts WHERE id = ?', id);
  return JSON.parse(r.payload);
}
export const discardHeld = (ctx: Ctx, id: string) => void ctx.db.run('DELETE FROM held_carts WHERE id = ?', id);

// ---------- consultation ----------
export interface SaleQuery { from?: string; to?: string; customerId?: string; userId?: string; status?: string; q?: string; registerId?: string; limit?: number; offset?: number }
export function listSales(ctx: Ctx, q: SaleQuery) {
  const own = can(ctx, 'cash.view_all') ? (q.userId ?? null) : ctx.user.id;
  const s = q.q?.trim() ? `%${q.q.trim()}%` : null;
  const where = `(? IS NULL OR s.business_date >= ?) AND (? IS NULL OR s.business_date <= ?) AND (? IS NULL OR s.customer_id = ?) AND (? IS NULL OR s.user_id = ?)
    AND (? IS NULL OR s.payment_status = ?) AND (? IS NULL OR s.register_id = ?) AND (? IS NULL OR s.number LIKE ? OR c.name LIKE ?)`;
  const args = [q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.customerId ?? null, q.customerId ?? null, own, own, q.status ?? null, q.status ?? null, q.registerId ?? null, q.registerId ?? null, s, s, s];
  return {
    rows: ctx.db.all(
      `SELECT s.id, s.number, s.created_at AS createdAt, s.total, s.paid_total AS paidTotal, s.returned_total AS returnedTotal, s.payment_status AS paymentStatus, s.change_given AS changeGiven,
              c.name AS customerName, u.display_name AS userName, r.name AS registerName,
              (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS lines, (SELECT number FROM invoices WHERE sale_id = s.id) AS invoiceNumber
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.user_id LEFT JOIN cash_registers r ON r.id = s.register_id
       WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`, ...args, Math.min(q.limit ?? 100, 1000), q.offset ?? 0),
    total: ctx.db.value<number>(`SELECT COUNT(*) FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${where}`, ...args)!,
  };
}

export function getSale(ctx: Ctx, id: string) {
  const s = ctx.db.get<any>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.tax_id AS customer_tax_id, u.display_name AS user_name, r.name AS register_name
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.user_id LEFT JOIN cash_registers r ON r.id = s.register_id WHERE s.id = ? OR s.number = ?`, id, id);
  if (!s) fail('NOT_FOUND', 'Vente introuvable');
  return {
    id: s.id, number: s.number, createdAt: s.created_at, customerId: s.customer_id, customerName: s.customer_name, customerPhone: s.customer_phone, customerAddress: s.customer_address, customerTaxId: s.customer_tax_id,
    userName: s.user_name, registerName: s.register_name, subtotal: s.subtotal, lineDiscountTotal: s.line_discount_total, cartDiscountTotal: s.cart_discount_total, netTotal: s.net_total, taxTotal: s.tax_total,
    total: s.total, paidTotal: s.paid_total, changeGiven: s.change_given, returnedTotal: s.returned_total, paymentStatus: s.payment_status, dueDate: s.due_date, note: s.note, pricesIncludeTax: !!s.prices_include_tax,
    items: ctx.db.all('SELECT id, variant_id AS variantId, name, sku, qty_milli AS qtyMilli, unit_price AS unitPrice, discount, cart_discount_share AS cartDiscountShare, tax_rate_bp AS taxRateBp, net, tax, total, returned_milli AS returnedMilli FROM sale_items WHERE sale_id = ?', s.id),
    payments: ctx.db.all(`SELECT p.id, p.at, p.direction, p.amount, p.tendered, m.name AS methodName, m.kind FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.sale_id = ? ORDER BY p.at`, s.id),
    allocations: ctx.db.all(`SELECT a.amount, p.at, m.name AS methodName FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN payment_methods m ON m.id = p.method_id WHERE a.sale_id = ? ORDER BY p.at`, s.id),
    returns: ctx.db.all('SELECT id, number, at, total, refund_total AS refundTotal, reason FROM sale_returns WHERE sale_id = ? ORDER BY at', s.id),
    invoice: ctx.db.get('SELECT id, number, issued_at AS issuedAt FROM invoices WHERE sale_id = ?', s.id) ?? null,
  };
}
void recordFT;
