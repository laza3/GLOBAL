import { applyMovement } from './stock';
import { audit, fail, like, nowIso, outbox, uuid, businessDate, type Ctx } from './util';

// ---------- catégories & marques ----------
export const listCategories = (ctx: Ctx) =>
  ctx.db.all(
    `SELECT c.id, c.name, c.parent_id AS parentId, p.name AS parentName, c.active,
            (SELECT COUNT(*) FROM products x WHERE x.category_id = c.id AND x.deleted_at IS NULL) AS productCount
     FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.deleted_at IS NULL ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`,
  );
export function saveCategory(ctx: Ctx, i: { id?: string; name: string; parentId?: string | null; active?: boolean }) {
  const t = nowIso();
  if (i.parentId && i.parentId === i.id) fail('INVALID', 'Une catégorie ne peut pas être son propre parent');
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE categories SET name=?, parent_id=?, active=?, updated_at=? WHERE id=?', i.name, i.parentId ?? null, i.active === false ? 0 : 1, t, id);
  else ctx.db.run('INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,?)', id, i.name, i.parentId ?? null, t, t);
  outbox(ctx.db, 'category', id, i.id ? 'UPDATE' : 'INSERT', i);
  audit(ctx, 'category.save', 'category', id);
  return { id };
}
export function deleteCategory(ctx: Ctx, id: string) {
  if (ctx.db.get('SELECT 1 FROM products WHERE category_id = ? AND deleted_at IS NULL', id)) fail('IN_USE', 'Cette catégorie contient encore des produits');
  if (ctx.db.get('SELECT 1 FROM categories WHERE parent_id = ? AND deleted_at IS NULL', id)) fail('IN_USE', 'Cette catégorie possède des sous-catégories');
  ctx.db.run('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  outbox(ctx.db, 'category', id, 'DELETE');
  audit(ctx, 'category.delete', 'category', id);
}
export const listBrands = (ctx: Ctx) => ctx.db.all('SELECT id, name FROM brands WHERE deleted_at IS NULL ORDER BY name');
export function saveBrand(ctx: Ctx, i: { id?: string; name: string }) {
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE brands SET name=?, updated_at=? WHERE id=?', i.name, t, id);
  else ctx.db.run('INSERT INTO brands (id, name, created_at, updated_at) VALUES (?,?,?,?)', id, i.name, t, t);
  outbox(ctx.db, 'brand', id, i.id ? 'UPDATE' : 'INSERT', i);
  return { id };
}
export function deleteBrand(ctx: Ctx, id: string) {
  if (ctx.db.get('SELECT 1 FROM products WHERE brand_id = ? AND deleted_at IS NULL', id)) fail('IN_USE', 'Cette marque est utilisée par des produits');
  ctx.db.run('UPDATE brands SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
  outbox(ctx.db, 'brand', id, 'DELETE');
}

// ---------- produits ----------
export interface VariantInput {
  id?: string;
  sku?: string;
  name?: string | null;
  size?: string | null;
  color?: string | null;
  costPrice: number;
  price: number;
  wholesalePrice?: number | null;
  promoPrice?: number | null;
  promoStart?: string | null;
  promoEnd?: string | null;
  alertQtyMilli?: number;
  barcodes?: string[];
  active?: boolean;
  /** stock d'ouverture (création uniquement) */
  openingQtyMilli?: number;
  openingWarehouseId?: string;
}
export interface ProductInput {
  id?: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  unitId?: string | null;
  taxRateId?: string | null;
  trackStock?: boolean;
  trackLots?: boolean;
  image?: string | null;
  active?: boolean;
  variants: VariantInput[];
}

function autoSku(ctx: Ctx): string {
  for (let n = 1; ; n++) {
    const next = (ctx.db.value<number>("SELECT COUNT(*) FROM product_variants") ?? 0) + n;
    const sku = `P${String(next).padStart(6, '0')}`;
    if (!ctx.db.get('SELECT 1 FROM product_variants WHERE sku = ?', sku)) return sku;
  }
}

const PRICE_FIELDS = [['cost_price', 'costPrice'], ['price', 'price'], ['wholesale_price', 'wholesalePrice'], ['promo_price', 'promoPrice']] as const;

export function saveProduct(ctx: Ctx, i: ProductInput) {
  if (!i.name.trim()) fail('INVALID', 'Le nom du produit est obligatoire');
  if (!i.variants.length) fail('INVALID', 'Au moins un article (variante) est requis');
  const t = nowIso();
  return ctx.db.tx(() => {
    const productId = i.id ?? uuid();
    const defaultTax = i.taxRateId ?? ctx.db.value<string>('SELECT id FROM tax_rates WHERE is_default = 1') ?? null;
    if (i.id) {
      ctx.db.run(
        `UPDATE products SET name=?, description=?, category_id=?, brand_id=?, unit_id=?, tax_rate_id=?, track_stock=?, track_lots=?, image=?, active=?, version=version+1, updated_at=? WHERE id=?`,
        i.name.trim(), i.description ?? null, i.categoryId ?? null, i.brandId ?? null, i.unitId ?? null, defaultTax, i.trackStock === false ? 0 : 1, i.trackLots ? 1 : 0, i.image ?? null, i.active === false ? 0 : 1, t, productId,
      );
    } else {
      ctx.db.run(
        `INSERT INTO products (id, name, description, category_id, brand_id, unit_id, tax_rate_id, track_stock, track_lots, image, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        productId, i.name.trim(), i.description ?? null, i.categoryId ?? null, i.brandId ?? null, i.unitId ?? null, defaultTax, i.trackStock === false ? 0 : 1, i.trackLots ? 1 : 0, i.image ?? null, i.active === false ? 0 : 1, t, t,
      );
    }

    const keep = new Set<string>();
    for (const v of i.variants) {
      if (v.price < 0 || v.costPrice < 0) fail('INVALID', 'Les prix ne peuvent pas être négatifs');
      if (v.promoPrice != null && v.promoPrice >= v.price && v.price > 0) fail('INVALID', 'Le prix promotionnel doit être inférieur au prix de vente');
      const sku = (v.sku || '').trim() || autoSku(ctx);
      const dupe = ctx.db.get('SELECT id FROM product_variants WHERE sku = ? AND deleted_at IS NULL AND id <> ?', sku, v.id ?? '');
      if (dupe) fail('DUPLICATE_SKU', `Le SKU « ${sku} » existe déjà`);
      const variantId = v.id ?? uuid();
      keep.add(variantId);
      const prev = v.id ? ctx.db.get<any>('SELECT * FROM product_variants WHERE id = ?', v.id) : undefined;
      if (prev) {
        ctx.db.run(
          `UPDATE product_variants SET sku=?, name=?, size=?, color=?, cost_price=?, price=?, wholesale_price=?, promo_price=?, promo_start=?, promo_end=?, alert_qty_milli=?, active=?, deleted_at=NULL, version=version+1, updated_at=? WHERE id=?`,
          sku, v.name ?? null, v.size ?? null, v.color ?? null, v.costPrice, v.price, v.wholesalePrice ?? null, v.promoPrice ?? null, v.promoStart ?? null, v.promoEnd ?? null, v.alertQtyMilli ?? 0, v.active === false ? 0 : 1, t, variantId,
        );
        for (const [col, key] of PRICE_FIELDS) {
          const nv = (v as any)[key] ?? null;
          if ((prev[col] ?? null) !== nv) ctx.db.run('INSERT INTO price_history (id, variant_id, field, old_value, new_value, user_id, at) VALUES (?,?,?,?,?,?,?)', uuid(), variantId, col, prev[col], nv, ctx.user.id, t);
        }
      } else {
        ctx.db.run(
          `INSERT INTO product_variants (id, product_id, sku, name, size, color, cost_price, price, wholesale_price, promo_price, promo_start, promo_end, alert_qty_milli, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          variantId, productId, sku, v.name ?? null, v.size ?? null, v.color ?? null, v.costPrice, v.price, v.wholesalePrice ?? null, v.promoPrice ?? null, v.promoStart ?? null, v.promoEnd ?? null, v.alertQtyMilli ?? 0, v.active === false ? 0 : 1, t, t,
        );
        ctx.db.run('INSERT INTO price_history (id, variant_id, field, old_value, new_value, user_id, at) VALUES (?,?,?,?,?,?,?)', uuid(), variantId, 'price', null, v.price, ctx.user.id, t);
        if (v.openingQtyMilli && v.openingQtyMilli > 0 && i.trackStock !== false) {
          const wh = v.openingWarehouseId ?? ctx.db.value<string>('SELECT id FROM warehouses WHERE is_default = 1 AND deleted_at IS NULL') ?? fail('NO_WAREHOUSE', 'Aucun entrepôt par défaut');
          applyMovement(ctx, { variantId, warehouseId: wh, type: 'OPENING', qtyMilli: v.openingQtyMilli, unitCost: v.costPrice, reason: 'Stock initial', refType: 'opening' });
        }
      }
      // codes-barres
      if (v.barcodes) {
        const wanted = [...new Set(v.barcodes.map((b) => b.trim()).filter(Boolean))];
        for (const code of wanted) {
          const owner = ctx.db.get<{ variant_id: string }>('SELECT variant_id FROM barcodes WHERE code = ?', code);
          if (owner && owner.variant_id !== variantId) fail('DUPLICATE_BARCODE', `Le code-barres ${code} est déjà utilisé par un autre article`);
        }
        ctx.db.run('DELETE FROM barcodes WHERE variant_id = ?', variantId);
        for (const code of wanted) ctx.db.run('INSERT INTO barcodes (code, variant_id) VALUES (?,?)', code, variantId);
      }
      outbox(ctx.db, 'variant', variantId, prev ? 'UPDATE' : 'INSERT', { productId, sku, price: v.price });
    }
    if (i.id) {
      // variantes retirées : suppression logique (tombstone)
      const existing = ctx.db.all<{ id: string }>('SELECT id FROM product_variants WHERE product_id = ? AND deleted_at IS NULL', productId);
      for (const e of existing) {
        if (!keep.has(e.id)) {
          ctx.db.run('UPDATE product_variants SET deleted_at = ?, updated_at = ? WHERE id = ?', t, t, e.id);
          ctx.db.run('DELETE FROM barcodes WHERE variant_id = ?', e.id);
          outbox(ctx.db, 'variant', e.id, 'DELETE');
        }
      }
    }
    outbox(ctx.db, 'product', productId, i.id ? 'UPDATE' : 'INSERT', { name: i.name });
    audit(ctx, i.id ? 'product.update' : 'product.create', 'product', productId, { name: i.name });
    return { id: productId };
  });
}

export function deleteProduct(ctx: Ctx, id: string) {
  const t = nowIso();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE products SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', t, t, id);
    for (const v of ctx.db.all<{ id: string }>('SELECT id FROM product_variants WHERE product_id = ?', id)) {
      ctx.db.run('UPDATE product_variants SET deleted_at = ?, updated_at = ? WHERE id = ?', t, t, v.id);
      ctx.db.run('DELETE FROM barcodes WHERE variant_id = ?', v.id);
      outbox(ctx.db, 'variant', v.id, 'DELETE');
    }
    outbox(ctx.db, 'product', id, 'DELETE');
    audit(ctx, 'product.delete', 'product', id);
  });
}

export function getProduct(ctx: Ctx, id: string) {
  const p = ctx.db.get<any>('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', id);
  if (!p) fail('NOT_FOUND', 'Produit introuvable');
  const variants = ctx.db.all<any>('SELECT * FROM product_variants WHERE product_id = ? AND deleted_at IS NULL ORDER BY created_at', id).map((v) => ({
    id: v.id, sku: v.sku, name: v.name, size: v.size, color: v.color, costPrice: v.cost_price, price: v.price, wholesalePrice: v.wholesale_price,
    promoPrice: v.promo_price, promoStart: v.promo_start, promoEnd: v.promo_end, alertQtyMilli: v.alert_qty_milli, active: !!v.active,
    barcodes: ctx.db.all<{ code: string }>('SELECT code FROM barcodes WHERE variant_id = ?', v.id).map((b) => b.code),
    stock: ctx.db.all('SELECT s.warehouse_id AS warehouseId, w.name AS warehouseName, s.qty_milli AS qtyMilli, s.avg_cost AS avgCost FROM stock s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.variant_id = ?', v.id),
    priceHistory: ctx.db.all('SELECT h.at, h.field, h.old_value AS oldValue, h.new_value AS newValue, u.display_name AS userName FROM price_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.variant_id = ? ORDER BY h.at DESC LIMIT 50', v.id),
  }));
  return {
    id: p.id, name: p.name, description: p.description, categoryId: p.category_id, brandId: p.brand_id, unitId: p.unit_id, taxRateId: p.tax_rate_id,
    trackStock: !!p.track_stock, trackLots: !!p.track_lots, image: p.image, active: !!p.active, variants,
  };
}

export interface ProductQuery { q?: string; categoryId?: string; brandId?: string; active?: boolean; limit?: number; offset?: number }
export function listProducts(ctx: Ctx, q: ProductQuery) {
  const s = q.q?.trim() ? like(q.q.trim()) : null;
  const where = `p.deleted_at IS NULL AND (? IS NULL OR p.category_id = ?) AND (? IS NULL OR p.brand_id = ?) AND (? IS NULL OR p.active = ?)
    AND (? IS NULL OR p.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND (v.sku LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM barcodes b WHERE b.variant_id = v.id AND b.code LIKE ? ESCAPE '\\'))))`;
  const args = [q.categoryId ?? null, q.categoryId ?? null, q.brandId ?? null, q.brandId ?? null, q.active === undefined ? null : q.active ? 1 : 0, q.active === undefined ? null : q.active ? 1 : 0, s, s, s, s, s];
  const rows = ctx.db.all(
    `SELECT p.id, p.name, p.image, p.active, p.track_stock AS trackStock, c.name AS categoryName, b.name AS brandName, u.code AS unit,
       (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS variantCount,
       (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS minPrice,
       (SELECT MAX(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS maxPrice,
       (SELECT MIN(v.sku) FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS sku,
       (SELECT COALESCE(SUM(s.qty_milli),0) FROM stock s JOIN product_variants v ON v.id = s.variant_id WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS stockMilli,
       (SELECT COALESCE(SUM(CASE WHEN v.price > 0 THEN (v.price - v.cost_price) * 10000 / v.price ELSE 0 END),0) / MAX(COUNT(*),1) FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS marginBp
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN units u ON u.id = p.unit_id
     WHERE ${where} ORDER BY p.name LIMIT ? OFFSET ?`,
    ...args, Math.min(q.limit ?? 200, 1000), q.offset ?? 0,
  );
  const total = ctx.db.value<number>(`SELECT COUNT(*) FROM products p WHERE ${where}`, ...args)!;
  return { rows, total };
}

/** Prix effectif d'un article : promotion en cours > prix de gros (client grossiste) > prix de vente. */
export function effectivePrice(v: { price: number; wholesale_price: number | null; promo_price: number | null; promo_start: string | null; promo_end: string | null }, tier: 'RETAIL' | 'WHOLESALE', today: string): { price: number; promo: boolean } {
  const promoActive = v.promo_price != null && (!v.promo_start || v.promo_start <= today) && (!v.promo_end || v.promo_end >= today);
  if (promoActive) return { price: v.promo_price!, promo: true };
  if (tier === 'WHOLESALE' && v.wholesale_price != null) return { price: v.wholesale_price, promo: false };
  return { price: v.price, promo: false };
}

export interface SellableRow {
  variantId: string; productId: string; name: string; sku: string; barcode: string | null; price: number; basePrice: number; promo: boolean;
  taxRateBp: number; unit: string | null; allowDecimal: boolean; image: string | null; trackStock: boolean; stockMilli: number; categoryName: string | null;
}

function toSellable(ctx: Ctx, r: any, tier: 'RETAIL' | 'WHOLESALE', today: string): SellableRow {
  const ep = effectivePrice(r, tier, today);
  return {
    variantId: r.variant_id, productId: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode ?? null, price: ep.price, basePrice: r.price, promo: ep.promo,
    taxRateBp: r.rate_bp ?? 0, unit: r.unit, allowDecimal: !!r.allow_decimal, image: r.image, trackStock: !!r.track_stock, stockMilli: r.stock_milli ?? 0, categoryName: r.category_name ?? null,
  };
}
const SELL_SELECT = `SELECT v.id AS variant_id, p.id AS product_id, p.name || COALESCE(' — ' || COALESCE(NULLIF(v.name,''), NULLIF(TRIM(COALESCE(v.size,'') || ' ' || COALESCE(v.color,'')),'')), '') AS name,
  v.sku, v.price, v.wholesale_price, v.promo_price, v.promo_start, v.promo_end, COALESCE(t.rate_bp, 0) AS rate_bp, u.code AS unit, u.allow_decimal, p.image, p.track_stock,
  COALESCE((SELECT SUM(s.qty_milli) FROM stock s WHERE s.variant_id = v.id AND (? IS NULL OR s.warehouse_id = ?)), 0) AS stock_milli, c.name AS category_name
  FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN tax_rates t ON t.id = p.tax_rate_id LEFT JOIN units u ON u.id = p.unit_id LEFT JOIN categories c ON c.id = p.category_id
  WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND v.active = 1 AND p.active = 1`;

/** Recherche instantanée pour le POS (nom, SKU, code-barres). */
export function searchSellable(ctx: Ctx, q: { q?: string; warehouseId?: string; tier?: 'RETAIL' | 'WHOLESALE'; categoryId?: string; limit?: number }) {
  const today = businessDate(ctx.company().timezone);
  const s = q.q?.trim();
  const wh = q.warehouseId ?? null;
  const rows = s
    ? ctx.db.all(
        `${SELL_SELECT} AND (p.name LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM barcodes b WHERE b.variant_id = v.id AND b.code LIKE ? ESCAPE '\\'))
         AND (? IS NULL OR p.category_id = ?) ORDER BY (v.sku = ?) DESC, p.name LIMIT ?`,
        wh, wh, like(s), like(s), like(s), like(s), q.categoryId ?? null, q.categoryId ?? null, s, q.limit ?? 40)
    : ctx.db.all(`${SELL_SELECT} AND (? IS NULL OR p.category_id = ?) ORDER BY p.name LIMIT ?`, wh, wh, q.categoryId ?? null, q.categoryId ?? null, q.limit ?? 40);
  return rows.map((r) => toSellable(ctx, r, q.tier ?? 'RETAIL', today));
}

/** Lecture d'un code-barres (ou SKU exact) : retourne l'article ou null. */
export function findByCode(ctx: Ctx, code: string, warehouseId?: string, tier: 'RETAIL' | 'WHOLESALE' = 'RETAIL'): SellableRow | null {
  const c = code.trim();
  if (!c) return null;
  const today = businessDate(ctx.company().timezone);
  const wh = warehouseId ?? null;
  const row = ctx.db.get(
    `${SELL_SELECT} AND (v.sku = ? OR v.id IN (SELECT variant_id FROM barcodes WHERE code = ?)) LIMIT 1`, wh, wh, c, c);
  return row ? toSellable(ctx, { ...row, barcode: c }, tier, today) : null;
}

export function priceHistory(ctx: Ctx, variantId: string) {
  return ctx.db.all('SELECT h.at, h.field, h.old_value AS oldValue, h.new_value AS newValue, u.display_name AS userName FROM price_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.variant_id = ? ORDER BY h.at DESC', variantId);
}
