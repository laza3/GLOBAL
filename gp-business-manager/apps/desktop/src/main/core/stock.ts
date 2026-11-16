import { formatQty } from '@gp/shared';
import { audit, branchScope, fail, nextNumber, nowIso, numberingOf, outbox, uuid, type Ctx } from './util';

/** Un utilisateur limité à une boutique ne peut toucher qu'aux entrepôts de cette boutique. */
function assertWarehouseInScope(ctx: Ctx, warehouseId: string) {
  const b = branchScope(ctx);
  if (b && ctx.db.value<string>('SELECT branch_id FROM warehouses WHERE id = ?', warehouseId) !== b) fail('BRANCH_FORBIDDEN', "Cet entrepôt appartient à une autre boutique que la vôtre.");
}

export type MovementType = 'IN' | 'OUT' | 'SALE' | 'RETURN_IN' | 'PURCHASE' | 'PURCHASE_RETURN' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'INVENTORY' | 'LOSS' | 'DAMAGED' | 'OPENING';

export interface MovementInput {
  variantId: string;
  warehouseId: string;
  type: MovementType;
  /** quantité signée en millièmes (+ entrée, − sortie) */
  qtyMilli: number;
  unitCost?: number;
  lotNo?: string | null;
  expiryDate?: string | null;
  refType?: string;
  refId?: string;
  reason?: string;
  /** autorise le stock négatif pour cette opération (vente hors ligne déjà encaissée) */
  allowNegative?: boolean;
}

interface VariantInfo { id: string; track_stock: number; track_lots: number; name: string; sku: string }

function variantInfo(ctx: Ctx, variantId: string): VariantInfo {
  const v = ctx.db.get<VariantInfo>(
    `SELECT v.id, p.track_stock, p.track_lots, p.name || COALESCE(' — ' || v.name, '') AS name, v.sku
     FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
    variantId,
  );
  return v ?? fail('NOT_FOUND', 'Article introuvable');
}

export function stockQty(ctx: Ctx, variantId: string, warehouseId: string): number {
  return ctx.db.value<number>('SELECT qty_milli FROM stock WHERE variant_id = ? AND warehouse_id = ?', variantId, warehouseId) ?? 0;
}

/**
 * Applique un mouvement de stock (toujours dans une transaction appelante).
 * Retourne le coût unitaire moyen appliqué (utile pour le coût des ventes).
 * - entrées : coût moyen pondéré recalculé ;
 * - sorties : coût moyen inchangé, FEFO sur les lots si l'article est suivi par lots ;
 * - refus si le stock devient négatif (sauf paramètre d'entreprise ou `allowNegative`).
 */
export function applyMovement(ctx: Ctx, m: MovementInput): { unitCost: number } {
  const { db } = ctx;
  if (!Number.isInteger(m.qtyMilli) || m.qtyMilli === 0) fail('INVALID_QTY', 'Quantité invalide');
  const v = variantInfo(ctx, m.variantId);
  const at = nowIso();
  const cur = db.get<{ qty_milli: number; avg_cost: number }>('SELECT qty_milli, avg_cost FROM stock WHERE variant_id = ? AND warehouse_id = ?', m.variantId, m.warehouseId);
  const oldQty = cur?.qty_milli ?? 0;
  let avg = cur?.avg_cost ?? 0;
  if (!v.track_stock) {
    // service / article non suivi : pas de mouvement, coût = coût de revient fiche
    const c = db.value<number>('SELECT cost_price FROM product_variants WHERE id = ?', m.variantId) ?? 0;
    return { unitCost: c };
  }
  const newQty = oldQty + m.qtyMilli;
  if (m.qtyMilli < 0 && newQty < 0 && !m.allowNegative && !ctx.company().allow_negative_stock) {
    fail('INSUFFICIENT_STOCK', `Stock insuffisant pour « ${v.name} » : disponible ${formatQty(oldQty)}, demandé ${formatQty(-m.qtyMilli)}`, { variantId: m.variantId, available: oldQty });
  }
  if (m.qtyMilli > 0 && (m.unitCost ?? 0) > 0) {
    avg = oldQty > 0 ? Math.round((oldQty * avg + m.qtyMilli * m.unitCost!) / (oldQty + m.qtyMilli)) : m.unitCost!;
  } else if (!cur && m.qtyMilli > 0) {
    avg = db.value<number>('SELECT cost_price FROM product_variants WHERE id = ?', m.variantId) ?? 0;
  }
  db.run(
    `INSERT INTO stock (variant_id, warehouse_id, qty_milli, avg_cost) VALUES (?,?,?,?)
     ON CONFLICT(variant_id, warehouse_id) DO UPDATE SET qty_milli = excluded.qty_milli, avg_cost = excluded.avg_cost`,
    m.variantId, m.warehouseId, newQty, avg,
  );

  const record = (lotId: string | null, qty: number) =>
    db.run(
      `INSERT INTO stock_movements (id, variant_id, warehouse_id, lot_id, type, qty_milli, unit_cost, ref_type, ref_id, reason, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uuid(), m.variantId, m.warehouseId, lotId, m.type, qty, m.qtyMilli > 0 ? (m.unitCost ?? avg) : avg, m.refType ?? null, m.refId ?? null, m.reason ?? null, ctx.user.id, at,
    );

  if (v.track_lots) {
    if (m.qtyMilli > 0) {
      const lotNo = m.lotNo || 'SANS-LOT';
      let lot = db.get<{ id: string }>('SELECT id FROM stock_lots WHERE variant_id = ? AND warehouse_id = ? AND lot_no = ?', m.variantId, m.warehouseId, lotNo);
      if (!lot) {
        lot = { id: uuid() };
        db.run('INSERT INTO stock_lots (id, variant_id, warehouse_id, lot_no, expiry_date, qty_milli, created_at) VALUES (?,?,?,?,?,0,?)', lot.id, m.variantId, m.warehouseId, lotNo, m.expiryDate ?? null, at);
      } else if (m.expiryDate) db.run('UPDATE stock_lots SET expiry_date = ? WHERE id = ? AND expiry_date IS NULL', m.expiryDate, lot.id);
      db.run('UPDATE stock_lots SET qty_milli = qty_milli + ? WHERE id = ?', m.qtyMilli, lot.id);
      record(lot.id, m.qtyMilli);
    } else {
      let need = -m.qtyMilli;
      const lots = db.all<{ id: string; qty_milli: number }>(
        `SELECT id, qty_milli FROM stock_lots WHERE variant_id = ? AND warehouse_id = ? AND qty_milli > 0
         ORDER BY expiry_date IS NULL, expiry_date, created_at`,
        m.variantId, m.warehouseId,
      );
      for (const l of lots) {
        if (need <= 0) break;
        const take = Math.min(l.qty_milli, need);
        db.run('UPDATE stock_lots SET qty_milli = qty_milli - ? WHERE id = ?', take, l.id);
        record(l.id, -take);
        need -= take;
      }
      if (need > 0) record(null, -need);
    }
  } else {
    record(null, m.qtyMilli);
  }
  outbox(db, 'stock', `${m.variantId}:${m.warehouseId}`, 'UPDATE', { qtyMilli: newQty });
  return { unitCost: m.qtyMilli < 0 ? avg : (m.unitCost ?? avg) };
}

export interface AdjustInput {
  warehouseId: string;
  variantId: string;
  /** IN/OUT : quantité = valeur absolue + sens implicite ; autres : signée */
  type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'LOSS' | 'DAMAGED';
  qtyMilli: number;
  reason?: string;
  unitCost?: number;
  lotNo?: string;
  expiryDate?: string;
}
export function adjustStock(ctx: Ctx, i: AdjustInput) {
  assertWarehouseInScope(ctx, i.warehouseId);
  if (['LOSS', 'DAMAGED', 'OUT'].includes(i.type) && !i.reason) fail('REASON_REQUIRED', 'Un motif est obligatoire');
  const qty = i.type === 'IN' ? Math.abs(i.qtyMilli) : ['OUT', 'LOSS', 'DAMAGED'].includes(i.type) ? -Math.abs(i.qtyMilli) : i.qtyMilli;
  return ctx.db.tx(() => {
    const r = applyMovement(ctx, { variantId: i.variantId, warehouseId: i.warehouseId, type: i.type, qtyMilli: qty, unitCost: i.unitCost, lotNo: i.lotNo, expiryDate: i.expiryDate, reason: i.reason, refType: 'adjustment' });
    audit(ctx, `stock.${i.type.toLowerCase()}`, 'variant', i.variantId, { qty, warehouseId: i.warehouseId, reason: i.reason });
    return r;
  });
}

export function createTransfer(ctx: Ctx, i: { fromWarehouseId: string; toWarehouseId: string; items: { variantId: string; qtyMilli: number }[]; note?: string }) {
  assertWarehouseInScope(ctx, i.fromWarehouseId);
  assertWarehouseInScope(ctx, i.toWarehouseId);
  if (i.fromWarehouseId === i.toWarehouseId) fail('INVALID', "L'entrepôt source et destination doivent être différents");
  if (!i.items.length) fail('INVALID', 'Aucun article à transférer');
  return ctx.db.tx(() => {
    const id = uuid();
    const number = nextNumber(ctx.db, 'TRANSFER', numberingOf(ctx.company()));
    ctx.db.run('INSERT INTO stock_transfers (id, number, from_warehouse_id, to_warehouse_id, note, user_id, at) VALUES (?,?,?,?,?,?,?)', id, number, i.fromWarehouseId, i.toWarehouseId, i.note ?? null, ctx.user.id, nowIso());
    for (const it of i.items) {
      if (it.qtyMilli <= 0) fail('INVALID_QTY', 'Quantité invalide');
      const out = applyMovement(ctx, { variantId: it.variantId, warehouseId: i.fromWarehouseId, type: 'TRANSFER_OUT', qtyMilli: -it.qtyMilli, refType: 'transfer', refId: id });
      applyMovement(ctx, { variantId: it.variantId, warehouseId: i.toWarehouseId, type: 'TRANSFER_IN', qtyMilli: it.qtyMilli, unitCost: out.unitCost, refType: 'transfer', refId: id });
      ctx.db.run('INSERT INTO stock_transfer_items (transfer_id, variant_id, qty_milli) VALUES (?,?,?)', id, it.variantId, it.qtyMilli);
    }
    audit(ctx, 'stock.transfer', 'transfer', id, { number, lines: i.items.length });
    return { id, number };
  });
}

export function listTransfers(ctx: Ctx, limit = 100) {
  return ctx.db.all(
    `SELECT t.id, t.number, t.at, t.note, wf.name AS fromName, wt.name AS toName, u.display_name AS userName,
            (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = t.id) AS lines
     FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id LEFT JOIN users u ON u.id = t.user_id
     ORDER BY t.at DESC LIMIT ?`, limit);
}

// ---------- inventaires ----------
export function createInventory(ctx: Ctx, i: { warehouseId: string; categoryId?: string; note?: string }) {
  return ctx.db.tx(() => {
    const id = uuid();
    const number = nextNumber(ctx.db, 'INVENTORY', numberingOf(ctx.company()));
    ctx.db.run("INSERT INTO inventories (id, number, warehouse_id, status, note, user_id, created_at) VALUES (?,?,?,'OPEN',?,?,?)", id, number, i.warehouseId, i.note ?? null, ctx.user.id, nowIso());
    const rows = ctx.db.all<{ id: string; qty: number }>(
      `SELECT v.id, COALESCE(s.qty_milli, 0) AS qty FROM product_variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN stock s ON s.variant_id = v.id AND s.warehouse_id = ?
       WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.track_stock = 1 AND (? IS NULL OR p.category_id = ?)`,
      i.warehouseId, i.categoryId ?? null, i.categoryId ?? null,
    );
    for (const r of rows) ctx.db.run('INSERT INTO inventory_lines (inventory_id, variant_id, expected_milli) VALUES (?,?,?)', id, r.id, r.qty);
    audit(ctx, 'inventory.create', 'inventory', id, { number, lines: rows.length });
    return { id, number, lines: rows.length };
  });
}
export const listInventories = (ctx: Ctx) =>
  ctx.db.all(`SELECT i.id, i.number, i.status, i.created_at AS createdAt, i.validated_at AS validatedAt, w.name AS warehouseName,
    (SELECT COUNT(*) FROM inventory_lines l WHERE l.inventory_id = i.id) AS lines,
    (SELECT COUNT(*) FROM inventory_lines l WHERE l.inventory_id = i.id AND l.counted_milli IS NOT NULL) AS counted
    FROM inventories i JOIN warehouses w ON w.id = i.warehouse_id ORDER BY i.created_at DESC`);
export function getInventory(ctx: Ctx, id: string) {
  const inv = ctx.db.get<any>('SELECT i.*, w.name AS warehouse_name FROM inventories i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.id = ?', id);
  if (!inv) fail('NOT_FOUND', 'Inventaire introuvable');
  const lines = ctx.db.all(
    `SELECT l.variant_id AS variantId, p.name || COALESCE(' — ' || v.name, '') AS name, v.sku, l.expected_milli AS expectedMilli, l.counted_milli AS countedMilli
     FROM inventory_lines l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.inventory_id = ? ORDER BY p.name`, id);
  return { id: inv.id, number: inv.number, status: inv.status, warehouseId: inv.warehouse_id, warehouseName: inv.warehouse_name, note: inv.note, lines };
}
export function setInventoryCount(ctx: Ctx, i: { inventoryId: string; variantId: string; countedMilli: number | null }) {
  const inv = ctx.db.get<any>('SELECT status FROM inventories WHERE id = ?', i.inventoryId);
  if (!inv) fail('NOT_FOUND', 'Inventaire introuvable');
  if (inv.status !== 'OPEN') fail('LOCKED', 'Inventaire déjà validé');
  ctx.db.run('UPDATE inventory_lines SET counted_milli = ? WHERE inventory_id = ? AND variant_id = ?', i.countedMilli, i.inventoryId, i.variantId);
}
/** Validation : génère un mouvement INVENTORY pour chaque écart (compté − stock actuel, en tenant compte des ventes survenues depuis). */
export function validateInventory(ctx: Ctx, inventoryId: string) {
  return ctx.db.tx(() => {
    const inv = ctx.db.get<any>('SELECT * FROM inventories WHERE id = ?', inventoryId);
    if (!inv) fail('NOT_FOUND', 'Inventaire introuvable');
    if (inv.status !== 'OPEN') fail('LOCKED', 'Inventaire déjà validé');
    const lines = ctx.db.all<any>('SELECT * FROM inventory_lines WHERE inventory_id = ? AND counted_milli IS NOT NULL', inventoryId);
    let adjusted = 0;
    for (const l of lines) {
      const diff = l.counted_milli - stockQty(ctx, l.variant_id, inv.warehouse_id);
      if (diff !== 0) {
        applyMovement(ctx, { variantId: l.variant_id, warehouseId: inv.warehouse_id, type: 'INVENTORY', qtyMilli: diff, refType: 'inventory', refId: inventoryId, reason: `Inventaire ${inv.number}`, allowNegative: true });
        adjusted++;
      }
    }
    ctx.db.run("UPDATE inventories SET status = 'VALIDATED', validated_at = ? WHERE id = ?", nowIso(), inventoryId);
    audit(ctx, 'inventory.validate', 'inventory', inventoryId, { adjusted });
    return { adjusted };
  });
}

// ---------- consultation ----------
export function stockLevels(ctx: Ctx, q: { warehouseId?: string; q?: string; lowOnly?: boolean; categoryId?: string; limit?: number; offset?: number }) {
  const like = q.q ? `%${q.q}%` : null;
  return ctx.db.all(
    `SELECT v.id AS variantId, p.id AS productId, p.name || COALESCE(' — ' || v.name, '') AS name, v.sku, c.name AS categoryName,
            w.id AS warehouseId, w.name AS warehouseName, COALESCE(s.qty_milli, 0) AS qtyMilli, COALESCE(s.avg_cost, v.cost_price) AS avgCost,
            v.alert_qty_milli AS alertQtyMilli, u.code AS unit,
            CAST(ROUND(COALESCE(s.qty_milli,0) * COALESCE(s.avg_cost, v.cost_price) / 1000.0) AS INTEGER) AS value
     FROM product_variants v JOIN products p ON p.id = v.product_id
     CROSS JOIN warehouses w
     LEFT JOIN stock s ON s.variant_id = v.id AND s.warehouse_id = w.id
     LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN units u ON u.id = p.unit_id
     WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.track_stock = 1 AND w.deleted_at IS NULL
       AND (? IS NULL OR w.branch_id = ?) AND (? IS NULL OR w.id = ?) AND (? IS NULL OR p.name LIKE ? OR v.sku LIKE ? OR EXISTS (SELECT 1 FROM barcodes b WHERE b.variant_id = v.id AND b.code LIKE ?))
       AND (? IS NULL OR p.category_id = ?)
       AND (? = 0 OR COALESCE(s.qty_milli,0) <= v.alert_qty_milli)
     ORDER BY p.name, v.name, w.name LIMIT ? OFFSET ?`,
    branchScope(ctx), branchScope(ctx), q.warehouseId ?? null, q.warehouseId ?? null, like, like, like, like, q.categoryId ?? null, q.categoryId ?? null, q.lowOnly ? 1 : 0, q.limit ?? 500, q.offset ?? 0,
  );
}

export function stockMovements(ctx: Ctx, q: { variantId?: string; warehouseId?: string; type?: string; from?: string; to?: string; limit?: number }) {
  return ctx.db.all(
    `SELECT m.id, m.at, m.type, m.qty_milli AS qtyMilli, m.unit_cost AS unitCost, m.reason, m.ref_type AS refType, m.ref_id AS refId,
            p.name || COALESCE(' — ' || v.name, '') AS name, v.sku, w.name AS warehouseName, l.lot_no AS lotNo, u.display_name AS userName
     FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
     JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN stock_lots l ON l.id = m.lot_id LEFT JOIN users u ON u.id = m.user_id
     WHERE (? IS NULL OR w.branch_id = ?) AND (? IS NULL OR m.variant_id = ?) AND (? IS NULL OR m.warehouse_id = ?) AND (? IS NULL OR m.type = ?)
       AND (? IS NULL OR substr(m.at,1,10) >= ?) AND (? IS NULL OR substr(m.at,1,10) <= ?)
     ORDER BY m.at DESC, m.rowid DESC LIMIT ?`,
    branchScope(ctx), branchScope(ctx), q.variantId ?? null, q.variantId ?? null, q.warehouseId ?? null, q.warehouseId ?? null, q.type ?? null, q.type ?? null,
    q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, Math.min(q.limit ?? 300, 2000),
  );
}

export function stockValuation(ctx: Ctx, warehouseId?: string) {
  const row = ctx.db.get<{ value: number; qty: number }>(
    `SELECT COALESCE(SUM(CAST(ROUND(s.qty_milli * s.avg_cost / 1000.0) AS INTEGER)),0) AS value, COALESCE(SUM(s.qty_milli),0) AS qty
     FROM stock s WHERE s.qty_milli > 0 AND (? IS NULL OR s.warehouse_id = ?)`, warehouseId ?? null, warehouseId ?? null)!;
  return row;
}

export function expiringLots(ctx: Ctx, days = 30) {
  const limit = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
  return ctx.db.all(
    `SELECT l.id, p.name || COALESCE(' — ' || v.name, '') AS name, v.sku, l.lot_no AS lotNo, l.expiry_date AS expiryDate, l.qty_milli AS qtyMilli, w.name AS warehouseName
     FROM stock_lots l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.qty_milli > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ? ORDER BY l.expiry_date`, limit);
}
