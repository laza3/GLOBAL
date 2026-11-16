import { percentOf, mulQty, allocate } from '@gp/shared';
import { ledgerSupplier, supplierBalance } from './parties';
import { applyMovement } from './stock';
import { audit, fail, nextNumber, nowIso, numberingOf, outbox, uuid, type Ctx } from './util';

export interface PurchaseInput {
  supplierId: string;
  warehouseId: string;
  items: { variantId: string; qtyMilli: number; unitCost: number; taxRateBp?: number }[];
  supplierRef?: string;
  expectedDate?: string | null;
  dueDate?: string | null;
  shippingCost?: number;
  note?: string;
}

export function createPurchase(ctx: Ctx, i: PurchaseInput) {
  if (!i.items.length) fail('EMPTY_CART', 'Aucun article');
  return ctx.db.tx(() => {
    if (!ctx.db.get('SELECT 1 FROM suppliers WHERE id = ? AND deleted_at IS NULL', i.supplierId)) fail('NOT_FOUND', 'Fournisseur introuvable');
    const id = uuid();
    const number = nextNumber(ctx.db, 'PURCHASE', numberingOf(ctx.company()));
    const t = nowIso();
    let net = 0, tax = 0;
    const lines = i.items.map((it) => {
      if (it.qtyMilli <= 0 || it.unitCost < 0) fail('INVALID', 'Quantité ou coût invalide');
      const bp = it.taxRateBp ?? ctx.db.value<number>('SELECT COALESCE(t.rate_bp,0) FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN tax_rates t ON t.id = p.tax_rate_id WHERE v.id = ?', it.variantId) ?? 0;
      const n = mulQty(it.unitCost, it.qtyMilli);
      const tx = percentOf(n, bp);
      net += n; tax += tx;
      return { ...it, bp };
    });
    ctx.db.run(
      `INSERT INTO purchases (id, number, supplier_id, warehouse_id, status, supplier_ref, expected_date, due_date, shipping_cost, note, net_total, tax_total, total, user_id, created_at, updated_at) VALUES (?,?,?,?,'ORDERED',?,?,?,?,?,?,?,?,?,?,?)`,
      id, number, i.supplierId, i.warehouseId, i.supplierRef ?? null, i.expectedDate ?? null, i.dueDate ?? null, i.shippingCost ?? 0, i.note ?? null, net, tax, net + tax, ctx.user.id, t, t,
    );
    for (const l of lines) ctx.db.run('INSERT INTO purchase_items (id, purchase_id, variant_id, qty_milli, unit_cost, tax_rate_bp) VALUES (?,?,?,?,?,?)', uuid(), id, l.variantId, l.qtyMilli, l.unitCost, l.bp);
    outbox(ctx.db, 'purchase', id, 'INSERT', { number });
    audit(ctx, 'purchase.create', 'purchase', id, { number, total: net + tax });
    return { id, number, total: net + tax };
  });
}

/**
 * Réception (totale ou partielle) : entre en stock au coût de revient (prix + quote-part des frais d'approche),
 * recalcule le coût moyen pondéré et enregistre la dette fournisseur correspondante.
 */
export function receivePurchase(ctx: Ctx, i: { purchaseId: string; items: { purchaseItemId: string; qtyMilli: number; lotNo?: string; expiryDate?: string }[]; note?: string }) {
  return ctx.db.tx(() => {
    const p = ctx.db.get<any>('SELECT * FROM purchases WHERE id = ?', i.purchaseId);
    if (!p) fail('NOT_FOUND', 'Commande introuvable');
    if (p.status === 'CANCELLED') fail('CANCELLED', 'Commande annulée');
    if (p.status === 'RECEIVED') fail('ALREADY_RECEIVED', 'Commande déjà entièrement réceptionnée');
    const rid = uuid();
    const number = nextNumber(ctx.db, 'RECEIPT', numberingOf(ctx.company()));
    const at = nowIso();
    const lines = i.items.filter((x) => x.qtyMilli > 0).map((x) => {
      const pi = ctx.db.get<any>('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?', x.purchaseItemId, i.purchaseId);
      if (!pi) fail('NOT_FOUND', 'Ligne de commande introuvable');
      if (pi.received_milli + x.qtyMilli > pi.qty_milli) fail('OVER_RECEIPT', 'Quantité reçue supérieure à la quantité commandée');
      return { x, pi };
    });
    if (!lines.length) fail('EMPTY_CART', 'Aucune quantité reçue');
    // frais d'approche répartis au prorata de la valeur reçue
    const values = lines.map((l) => mulQty(l.pi.unit_cost, l.x.qtyMilli));
    const shippingShare = p.net_total > 0 ? Math.round((p.shipping_cost * values.reduce((a, b) => a + b, 0)) / p.net_total) : 0;
    const shipAlloc = allocate(shippingShare, values);
    const taxes = lines.map((l, idx) => percentOf(values[idx], l.pi.tax_rate_bp));
    const net = values.reduce((a, b) => a + b, 0);
    const tax = taxes.reduce((a, b) => a + b, 0);
    const total = net + tax;
    ctx.db.run('INSERT INTO goods_receipts (id, number, purchase_id, net_total, tax_total, total, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?)', rid, number, i.purchaseId, net, tax, total, i.note ?? null, ctx.user.id, at);
    lines.forEach((l, idx) => {
      const landed = l.pi.unit_cost + Math.round((shipAlloc[idx] * 1000) / l.x.qtyMilli);
      applyMovement(ctx, { variantId: l.pi.variant_id, warehouseId: p.warehouse_id, type: 'PURCHASE', qtyMilli: l.x.qtyMilli, unitCost: landed, lotNo: l.x.lotNo, expiryDate: l.x.expiryDate, refType: 'purchase', refId: i.purchaseId, reason: number });
      ctx.db.run('UPDATE purchase_items SET received_milli = received_milli + ? WHERE id = ?', l.x.qtyMilli, l.pi.id);
      ctx.db.run('UPDATE product_variants SET cost_price = ?, updated_at = ? WHERE id = ?', landed, at, l.pi.variant_id);
      ctx.db.run('INSERT INTO goods_receipt_items (receipt_id, purchase_item_id, qty_milli, unit_cost, landed_unit_cost, lot_no, expiry_date) VALUES (?,?,?,?,?,?,?)', rid, l.pi.id, l.x.qtyMilli, l.pi.unit_cost, landed, l.x.lotNo ?? null, l.x.expiryDate ?? null);
    });
    const open = ctx.db.value<number>('SELECT COUNT(*) FROM purchase_items WHERE purchase_id = ? AND received_milli < qty_milli', i.purchaseId)!;
    ctx.db.run('UPDATE purchases SET status = ?, received_total = received_total + ?, updated_at = ? WHERE id = ?', open === 0 ? 'RECEIVED' : 'PARTIAL', total, at, i.purchaseId);
    ledgerSupplier(ctx, p.supplier_id, 'PURCHASE', total, { refType: 'purchase', refId: i.purchaseId, dueDate: p.due_date, note: `${p.number} / ${number}` });
    outbox(ctx.db, 'goods_receipt', rid, 'INSERT', { purchaseId: i.purchaseId });
    audit(ctx, 'purchase.receive', 'purchase', i.purchaseId, { number, total });
    return { id: rid, number, total };
  });
}

export function cancelPurchase(ctx: Ctx, id: string) {
  const p = ctx.db.get<any>('SELECT * FROM purchases WHERE id = ?', id);
  if (!p) fail('NOT_FOUND', 'Commande introuvable');
  if (p.status !== 'ORDERED') fail('LOCKED', 'Seule une commande sans aucune réception peut être annulée');
  ctx.db.run("UPDATE purchases SET status = 'CANCELLED', updated_at = ? WHERE id = ?", nowIso(), id);
  audit(ctx, 'purchase.cancel', 'purchase', id);
}

/** Retour fournisseur : sortie de stock + diminution de la dette. */
export function returnToSupplier(ctx: Ctx, i: { supplierId: string; warehouseId: string; items: { variantId: string; qtyMilli: number; unitCost: number }[]; reason?: string }) {
  return ctx.db.tx(() => {
    const rid = uuid();
    let total = 0;
    for (const it of i.items) {
      if (it.qtyMilli <= 0) fail('INVALID_QTY', 'Quantité invalide');
      applyMovement(ctx, { variantId: it.variantId, warehouseId: i.warehouseId, type: 'PURCHASE_RETURN', qtyMilli: -it.qtyMilli, refType: 'purchase_return', refId: rid, reason: i.reason });
      total += mulQty(it.unitCost, it.qtyMilli);
    }
    ledgerSupplier(ctx, i.supplierId, 'RETURN', -total, { refType: 'purchase_return', refId: rid, note: i.reason });
    audit(ctx, 'purchase.return', 'supplier', i.supplierId, { total });
    return { id: rid, total, balance: supplierBalance(ctx, i.supplierId) };
  });
}

export function listPurchases(ctx: Ctx, q: { supplierId?: string; status?: string; limit?: number }) {
  return ctx.db.all(
    `SELECT p.id, p.number, p.status, p.created_at AS createdAt, p.due_date AS dueDate, p.total, p.received_total AS receivedTotal, p.paid_total AS paidTotal, s.name AS supplierName, w.name AS warehouseName
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id
     WHERE (? IS NULL OR p.supplier_id = ?) AND (? IS NULL OR p.status = ?) ORDER BY p.created_at DESC LIMIT ?`, q.supplierId ?? null, q.supplierId ?? null, q.status ?? null, q.status ?? null, q.limit ?? 200);
}
export function getPurchase(ctx: Ctx, id: string) {
  const p = ctx.db.get<any>('SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = ?', id);
  if (!p) fail('NOT_FOUND', 'Commande introuvable');
  return {
    id: p.id, number: p.number, status: p.status, supplierId: p.supplier_id, supplierName: p.supplier_name, warehouseId: p.warehouse_id, warehouseName: p.warehouse_name,
    supplierRef: p.supplier_ref, dueDate: p.due_date, expectedDate: p.expected_date, shippingCost: p.shipping_cost, note: p.note, netTotal: p.net_total, taxTotal: p.tax_total, total: p.total,
    receivedTotal: p.received_total, paidTotal: p.paid_total, createdAt: p.created_at,
    items: ctx.db.all(`SELECT i.id, i.variant_id AS variantId, pr.name || COALESCE(' — ' || v.name,'') AS name, v.sku, i.qty_milli AS qtyMilli, i.received_milli AS receivedMilli, i.unit_cost AS unitCost, i.tax_rate_bp AS taxRateBp, pr.track_lots AS trackLots
      FROM purchase_items i JOIN product_variants v ON v.id = i.variant_id JOIN products pr ON pr.id = v.product_id WHERE i.purchase_id = ?`, id),
    receipts: ctx.db.all('SELECT id, number, at, total FROM goods_receipts WHERE purchase_id = ? ORDER BY at', id),
  };
}
