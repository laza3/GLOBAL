import { isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { withIdempotency } from '../lib/idempotency';
import { serialRows } from '../lib/query';
import { buildUpdate, withUnique } from '../lib/sql';
import { lockFolio } from '../services/folio';
import { hotelClock } from '../services/reservations';

const money = z.number().int().min(0).max(1_000_000_000_000);
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const id = z.object({ id: z.uuid() });
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const OPEN = ['open', 'served'];

interface TaxInfo { kind: string; rate_bps: number | null; is_inclusive: boolean; is_active: boolean }

/** Taxe d'une ligne : pourcentage exclu (s'ajoute au prix) ou inclus (extraite du prix). */
function lineTax(quantity: number, unit: number, tax: TaxInfo | null): { gross: number; tax: number; net: number } {
  const gross = quantity * unit;
  if (!tax || tax.kind !== 'percentage' || !tax.is_active || !tax.rate_bps) return { gross, tax: 0, net: gross };
  if (tax.is_inclusive) {
    const net = Math.round((gross * 10_000) / (10_000 + tax.rate_bps));
    return { gross, tax: gross - net, net };
  }
  const t = Math.round((gross * tax.rate_bps) / 10_000);
  return { gross: gross + t, tax: t, net: gross };
}

/** Recalcule l'addition à partir des lignes non annulées. total = sous-total + taxes (contrainte de la base). */
async function recomputeOrder(tx: Tx, orderId: string) {
  const { rows } = await tx.query<{ quantity: number; unit_price: number; tax_amount: number; inclusive: boolean }>(
    "SELECT quantity, unit_price, tax_amount, tax_inclusive AS inclusive FROM order_items WHERE order_id = $1 AND status <> 'cancelled'",
    [orderId],
  );
  // Prix TTC (taxe incluse) : le sous-total est hors taxe ; sinon le prix est déjà hors taxe
  const subtotal = rows.reduce((s, r) => s + r.quantity * r.unit_price - (r.inclusive ? r.tax_amount : 0), 0);
  const tax = rows.reduce((s, r) => s + r.tax_amount, 0);
  await tx.query('UPDATE orders SET subtotal_amount = $2, tax_amount = $3, total_amount = $4 WHERE id = $1', [orderId, subtotal, tax, subtotal + tax]);
  return { subtotal, tax, total: subtotal + tax };
}

async function loadOrder(tx: Tx, orderId: string) {
  const q = serialRows(tx);
  const [head] = await q<any>(
    `SELECT o.id, o.number, o.status, o.covers, o.currency, o.subtotal_amount AS subtotal, o.tax_amount AS tax, o.total_amount AS total, o.notes, o.opened_at AS "openedAt", o.closed_at AS "closedAt",
            t.id AS "tableId", t.label AS "tableLabel", o.folio_id AS "folioId", r.reference AS "reservationReference", g.first_name || ' ' || g.last_name AS "guestName",
            u.full_name AS "openedByName",
            (SELECT p.method_code FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed' LIMIT 1) AS "paidWith"
     FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id AND t.hotel_id = o.hotel_id
     LEFT JOIN folios f ON f.id = o.folio_id AND f.hotel_id = o.hotel_id LEFT JOIN reservations r ON r.id = f.reservation_id AND r.hotel_id = o.hotel_id LEFT JOIN guests g ON g.id = f.guest_id AND g.hotel_id = o.hotel_id
     LEFT JOIN memberships m ON m.id = o.opened_by_membership_id AND m.hotel_id = o.hotel_id LEFT JOIN users u ON u.id = m.user_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (!head) throw new AppError('order_not_found');
  const items = await q<any>('SELECT id, product_id AS "productId", name, quantity, unit_price AS "unitPrice", tax_amount AS "taxAmount", status, notes FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  return { ...head, items };
}

const itemsBody = z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(100), notes: z.string().trim().max(200).nullish() })).min(1).max(60);

async function addItems(tx: Tx, hotelId: string, orderId: string, items: z.infer<typeof itemsBody>) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const { rows: products } = await tx.query<{ id: string; name: string; price: number; is_active: boolean; kind: string | null; rate_bps: number | null; is_inclusive: boolean | null; rule_active: boolean | null }>(
    `SELECT p.id, p.name, p.price, p.is_active, r.kind, r.rate_bps, r.is_inclusive, r.is_active AS rule_active FROM products p LEFT JOIN tax_rules r ON r.id = p.tax_rule_id AND r.hotel_id = p.hotel_id WHERE p.id = ANY ($1::uuid[])`,
    [ids],
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const it of items) {
    const p = byId.get(it.productId);
    if (!p || !p.is_active) throw new AppError('product_unavailable');
    const t = lineTax(it.quantity, p.price, p.kind ? { kind: p.kind, rate_bps: p.rate_bps, is_inclusive: !!p.is_inclusive, is_active: !!p.rule_active } : null);
    await tx.query('INSERT INTO order_items (hotel_id, order_id, product_id, name, quantity, unit_price, tax_amount, tax_inclusive, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [hotelId, orderId, p.id, p.name, it.quantity, p.price, t.tax, !!p.is_inclusive && t.tax > 0, it.notes ?? null]);
  }
}

export default async function restaurantRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const feature = 'restaurant';
  const read = app.hotelAuth({ permission: 'restaurant:read', feature });
  const manage = app.hotelAuth({ permission: 'restaurant:manage', feature });
  const order = app.hotelAuth({ permission: 'restaurant:order', feature });
  const tags = ['Restaurant'];

  /* ------------------------------------------------------------------ Carte */
  r.get('/restaurant/menu', { preValidation: read, schema: { tags, summary: 'Carte : catégories et plats (`all=true` : y compris les plats retirés)', querystring: z.object({ all: z.enum(['true']).optional() }) } }, async (req) => {
    const all = req.query.all === 'true';
    return req.hotel!.tenant(async (tx) => {
      const q = serialRows(tx);
      const categories = await q<any>('SELECT id, name, sort_order AS "sortOrder", is_active AS "isActive" FROM menu_categories WHERE ($1::boolean OR is_active) ORDER BY sort_order, name', [all]);
      const products = await q<any>(
        `SELECT p.id, p.category_id AS "categoryId", p.name, p.description, p.price, p.tax_rule_id AS "taxRuleId", r.name AS "taxName", p.is_active AS "isActive"
         FROM products p LEFT JOIN tax_rules r ON r.id = p.tax_rule_id AND r.hotel_id = p.hotel_id WHERE ($1::boolean OR p.is_active) ORDER BY p.name`,
        [all],
      );
      return { categories, products };
    });
  });

  r.post('/restaurant/categories', { preValidation: manage, schema: { tags, summary: 'Créer une catégorie de la carte', body: z.object({ name: z.string().trim().min(2).max(60), sortOrder: z.number().int().min(0).max(1000).default(0) }) } }, async (req, reply) => {
    const me = req.hotel!;
    const created = await me.tenant((tx) => withUnique({ menu_categories_hotel_id_name_key: 'menu_category_taken' }, async () => {
      const { rows } = await tx.query<{ id: string }>('INSERT INTO menu_categories (hotel_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id', [me.hotelId, req.body.name, req.body.sortOrder]);
      await auditHotel(tx, me, 'menu.category_created', { type: 'menu_category', id: rows[0]!.id }, `Catégorie de la carte : ${req.body.name}`, { ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    }));
    return reply.code(201).send({ id: created });
  });

  r.patch('/restaurant/categories/:id', { preValidation: manage, schema: { tags, summary: 'Modifier une catégorie de la carte', params: id, body: z.object({ name: z.string().trim().min(2).max(60), sortOrder: z.number().int().min(0).max(1000), isActive: z.boolean() }).partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('menu_categories', { name: 'name', sortOrder: 'sort_order', isActive: 'is_active' }, req.body, { column: 'id', value: req.params.id });
    await me.tenant((tx) => withUnique({ menu_categories_hotel_id_name_key: 'menu_category_taken' }, async () => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'menu.category_updated', { type: 'menu_category', id: req.params.id }, `Catégorie modifiée : ${u.keys.join(', ')}`, { ip: req.ip, requestId: req.id });
    }));
    return { updated: u.keys };
  });

  const productBody = z.object({ categoryId: z.uuid().nullable(), name: z.string().trim().min(2).max(100), description: z.string().trim().max(300).nullable(), price: money, taxRuleId: z.uuid().nullable(), isActive: z.boolean() });
  const PRODUCT_COLUMNS = { categoryId: 'category_id', name: 'name', description: 'description', price: 'price', taxRuleId: 'tax_rule_id', isActive: 'is_active' };

  r.post('/restaurant/products', { preValidation: manage, schema: { tags, summary: 'Ajouter un plat ou une boisson', body: productBody.partial({ categoryId: true, description: true, taxRuleId: true, isActive: true }) } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string }>('INSERT INTO products (hotel_id, category_id, name, description, price, tax_rule_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [me.hotelId, b.categoryId ?? null, b.name, b.description ?? null, b.price, b.taxRuleId ?? null, b.isActive ?? true]);
      await auditHotel(tx, me, 'menu.product_created', { type: 'product', id: rows[0]!.id }, `Plat ajouté : ${b.name}`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.patch('/restaurant/products/:id', { preValidation: manage, schema: { tags, summary: 'Modifier un plat (les additions passées gardent le prix et le nom d\'origine)', params: id, body: productBody.partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('products', PRODUCT_COLUMNS, req.body, { column: 'id', value: req.params.id });
    await me.tenant(async (tx) => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'menu.product_updated', { type: 'product', id: req.params.id }, `Plat modifié : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  /* ------------------------------------------------------------------ Tables */
  r.get('/restaurant/tables', { preValidation: read, schema: { tags, summary: 'Tables, avec la commande en cours' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT t.id, t.label, t.area, t.seats, t.is_active AS "isActive", o.id AS "orderId", o.number AS "orderNumber", o.total_amount AS "orderTotal", (o.id IS NOT NULL) AS busy
         FROM dining_tables t LEFT JOIN orders o ON o.table_id = t.id AND o.hotel_id = t.hotel_id AND o.status IN ('open', 'served') ORDER BY t.area NULLS LAST, length(t.label), t.label`,
      ),
    );
    return { tables: rows };
  });

  const tableBody = z.object({ label: z.string().trim().min(1).max(30), area: z.string().trim().max(40).nullable(), seats: z.number().int().min(1).max(60), isActive: z.boolean() });
  r.post('/restaurant/tables', { preValidation: manage, schema: { tags, summary: 'Ajouter une table', body: tableBody.partial({ area: true, isActive: true }) } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant((tx) => withUnique({ dining_tables_hotel_id_label_key: 'table_label_taken' }, async () => {
      const { rows } = await tx.query<{ id: string }>('INSERT INTO dining_tables (hotel_id, label, area, seats, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id', [me.hotelId, b.label, b.area ?? null, b.seats, b.isActive ?? true]);
      await auditHotel(tx, me, 'restaurant.table_created', { type: 'dining_table', id: rows[0]!.id }, `Table ajoutée : ${b.label}`, { ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    }));
    return reply.code(201).send({ id: created });
  });

  r.patch('/restaurant/tables/:id', { preValidation: manage, schema: { tags, summary: 'Modifier une table', params: id, body: tableBody.partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('dining_tables', { label: 'label', area: 'area', seats: 'seats', isActive: 'is_active' }, req.body, { column: 'id', value: req.params.id });
    await me.tenant((tx) => withUnique({ dining_tables_hotel_id_label_key: 'table_label_taken' }, async () => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'restaurant.table_updated', { type: 'dining_table', id: req.params.id }, `Table modifiée : ${u.keys.join(', ')}`, { ip: req.ip, requestId: req.id });
    }));
    return { updated: u.keys };
  });

  /* ------------------------------------------------------------------ Commandes */
  r.get('/restaurant/orders', {
    preValidation: read,
    schema: { tags, summary: 'Commandes', querystring: z.object({ status: z.enum(['active', 'open', 'served', 'paid', 'posted_to_room', 'cancelled']).optional(), date: date.optional(), q: z.string().trim().max(60).optional(), ...page }) },
  }, async (req) => {
    const { status, date: day, q, page: pg, pageSize } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const where = `($1::text IS NULL OR ($1 = 'active' AND o.status IN ('open', 'served')) OR o.status = $1) AND ($2::date IS NULL OR (o.opened_at AT TIME ZONE $3)::date = $2) AND ($4::text IS NULL OR o.number ILIKE '%' || $4 || '%' OR t.label ILIKE $4 || '%')`;
      const args = [status ?? null, day ?? null, clock.timezone, q || null];
      const from = 'FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id AND t.hotel_id = o.hotel_id';
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n ${from} WHERE ${where}`, args);
      const { rows } = await tx.query(
        `SELECT o.id, o.number, o.status, o.covers, o.total_amount AS total, o.currency, o.opened_at AS "openedAt", t.label AS "tableLabel",
                (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id AND i.status <> 'cancelled') AS "itemsCount"
         ${from} WHERE ${where} ORDER BY CASE WHEN o.status IN ('open', 'served') THEN 0 ELSE 1 END, o.opened_at DESC, o.id LIMIT $5 OFFSET $6`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: pg, pageSize };
    });
  });

  r.get('/restaurant/orders/:id', { preValidation: read, schema: { tags, summary: 'Détail d\'une commande', params: id } }, async (req) => req.hotel!.tenant((tx) => loadOrder(tx, req.params.id)));

  r.get('/restaurant/summary', { preValidation: read, schema: { tags, summary: 'Ventes du jour : commandes encaissées ou imputées aux chambres, commandes en cours', querystring: z.object({ date: date.optional() }) } }, async (req) =>
    req.hotel!.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      const day = req.query.date ?? clock.today;
      const { rows } = await tx.query<{ status: string; n: number; total: number }>(
        `SELECT status, count(*)::int AS n, COALESCE(sum(total_amount), 0)::bigint AS total FROM orders WHERE (opened_at AT TIME ZONE $2)::date = $1::date GROUP BY status`,
        [day, clock.timezone],
      );
      const by = Object.fromEntries(rows.map((x) => [x.status, x]));
      return {
        date: day, currency: clock.currency,
        sales: { count: (by.paid?.n ?? 0) + (by.posted_to_room?.n ?? 0), total: (by.paid?.total ?? 0) + (by.posted_to_room?.total ?? 0), paidAtTable: by.paid?.total ?? 0, postedToRooms: by.posted_to_room?.total ?? 0 },
        active: { count: (by.open?.n ?? 0) + (by.served?.n ?? 0), total: (by.open?.total ?? 0) + (by.served?.total ?? 0) },
        cancelled: by.cancelled?.n ?? 0,
      };
    }),
  );

  r.post('/restaurant/orders', {
    preValidation: order,
    schema: { tags, summary: 'Ouvrir une commande (table facultative : vente au comptoir). Une table n\'a qu\'une commande en cours.', body: z.object({ tableId: z.uuid().nullish(), covers: z.number().int().min(1).max(60).default(1), notes: z.string().trim().max(300).nullish(), items: itemsBody }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const out = await me.tenant((tx) =>
      withIdempotency(tx, me.hotelId, req.headers['idempotency-key'], 'order', b, async () => {
        const clock = await hotelClock(tx, app.deps.now());
        if (b.tableId) {
          const t = await tx.query<{ is_active: boolean }>('SELECT is_active FROM dining_tables WHERE id = $1 FOR UPDATE', [b.tableId]);
          if (!t.rows[0]) throw new AppError('not_found');
          const busy = await tx.query("SELECT 1 FROM orders WHERE table_id = $1 AND status IN ('open', 'served') LIMIT 1", [b.tableId]);
          if (busy.rowCount) throw new AppError('table_busy');
        }
        const year = clock.today.slice(0, 4);
        const { rows: ctr } = await tx.query<{ value: number }>('SELECT next_hotel_counter($1) AS value', [`order:${year}`]);
        const number = `CMD-${year}-${String(ctr[0]!.value).padStart(4, '0')}`;
        const { rows } = await tx.query<{ id: string }>(
          'INSERT INTO orders (hotel_id, number, table_id, covers, currency, notes, opened_by_membership_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [me.hotelId, number, b.tableId ?? null, b.covers, clock.currency, b.notes ?? null, me.membershipId],
        );
        await addItems(tx, me.hotelId, rows[0]!.id, b.items);
        const totals = await recomputeOrder(tx, rows[0]!.id);
        await auditHotel(tx, me, 'restaurant.order_opened', { type: 'order', id: rows[0]!.id }, `Commande ${number} ouverte (${totals.total})`, { after: { number, total: totals.total }, ip: req.ip, requestId: req.id });
        return { status: 201, body: { id: rows[0]!.id, number, total: totals.total } };
      }),
    );
    return reply.code(out.status).send(out.body);
  });

  /** Verrouille une commande encore modifiable (ouverte ou servie). */
  const lockOpen = async (tx: Tx, orderId: string) => {
    const { rows } = await tx.query<{ status: string; number: string; total_amount: number; currency: string; table_id: string | null }>('SELECT status, number, total_amount, currency, table_id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o) throw new AppError('order_not_found');
    if (!OPEN.includes(o.status)) throw new AppError('order_not_editable');
    return o;
  };

  r.post('/restaurant/orders/:id/items', { preValidation: order, schema: { tags, summary: 'Ajouter des plats à une commande en cours', params: id, body: z.object({ items: itemsBody }) } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const o = await lockOpen(tx, req.params.id);
      await addItems(tx, me.hotelId, req.params.id, req.body.items);
      await tx.query("UPDATE orders SET status = 'open' WHERE id = $1", [req.params.id]);
      await recomputeOrder(tx, req.params.id);
      await auditHotel(tx, me, 'restaurant.order_updated', { type: 'order', id: req.params.id }, `Commande ${o.number} : plats ajoutés`, { ip: req.ip, requestId: req.id });
      return loadOrder(tx, req.params.id);
    });
  });

  r.post('/restaurant/orders/:id/items/:itemId/cancel', { preValidation: order, schema: { tags, summary: 'Annuler une ligne de la commande', params: z.object({ id: z.uuid(), itemId: z.uuid() }) } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const o = await lockOpen(tx, req.params.id);
      const res = await tx.query("UPDATE order_items SET status = 'cancelled' WHERE id = $1 AND order_id = $2 AND status <> 'cancelled'", [req.params.itemId, req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await recomputeOrder(tx, req.params.id);
      await auditHotel(tx, me, 'restaurant.order_updated', { type: 'order', id: req.params.id }, `Commande ${o.number} : une ligne annulée`, { ip: req.ip, requestId: req.id });
      return loadOrder(tx, req.params.id);
    });
  });

  r.post('/restaurant/orders/:id/serve', { preValidation: order, schema: { tags, summary: 'Marquer la commande servie', params: id } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const o = await lockOpen(tx, req.params.id);
      await tx.query("UPDATE order_items SET status = 'served' WHERE order_id = $1 AND status = 'ordered'", [req.params.id]);
      await tx.query("UPDATE orders SET status = 'served' WHERE id = $1", [req.params.id]);
      await auditHotel(tx, me, 'restaurant.order_served', { type: 'order', id: req.params.id }, `Commande ${o.number} servie`, { ip: req.ip, requestId: req.id });
      return loadOrder(tx, req.params.id);
    });
  });

  r.post('/restaurant/orders/:id/cancel', { preValidation: order, schema: { tags, summary: 'Annuler une commande non encaissée', params: id, body: z.object({ reason: z.string().trim().min(3).max(200) }) } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const o = await lockOpen(tx, req.params.id);
      await tx.query("UPDATE order_items SET status = 'cancelled' WHERE order_id = $1", [req.params.id]);
      await tx.query("UPDATE orders SET status = 'cancelled', closed_at = now(), notes = COALESCE(notes || E'\\n', '') || $2 WHERE id = $1", [req.params.id, `Annulée : ${req.body.reason}`]);
      await auditHotel(tx, me, 'restaurant.order_cancelled', { type: 'order', id: req.params.id }, `Commande ${o.number} annulée : ${req.body.reason}`, { ip: req.ip, requestId: req.id });
      return loadOrder(tx, req.params.id);
    });
  });

  r.post('/restaurant/orders/:id/pay', {
    preValidation: order,
    schema: { tags, summary: 'Encaisser l\'addition à table (devise de l\'établissement) ; référence exigée hors espèces', params: id, body: z.object({ methodCode: z.string().regex(/^[a-z0-9_]{2,30}$/), amount: z.number().int().min(1), reference: z.string().trim().max(100).nullish() }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const out = await me.tenant((tx) =>
      withIdempotency(tx, me.hotelId, req.headers['idempotency-key'], 'order-pay', { order: req.params.id, ...b }, async () => {
        const o = await lockOpen(tx, req.params.id);
        if (o.total_amount === 0) throw new AppError('order_empty');
        if (b.amount !== o.total_amount) throw new AppError('order_amount_mismatch', { total: o.total_amount });
        const { rows: method } = await tx.query<{ kind: string; is_active: boolean }>('SELECT kind, is_active FROM payment_methods WHERE code = $1', [b.methodCode]);
        if (!method[0] || !method[0].is_active) throw new AppError('payment_method_unavailable');
        if (method[0].kind !== 'cash' && !b.reference?.trim()) throw new AppError('payment_reference_required');
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO payments (hotel_id, order_id, kind, method_code, amount, currency, exchange_rate, base_amount, reference, status, received_by_membership_id)
           VALUES ($1, $2, 'payment', $3, $4, $5, 1, $4, $6, 'confirmed', $7) RETURNING id`,
          [me.hotelId, req.params.id, b.methodCode, o.total_amount, o.currency, b.reference?.trim() || null, me.membershipId],
        );
        await tx.query("UPDATE order_items SET status = 'served' WHERE order_id = $1 AND status = 'ordered'", [req.params.id]);
        await tx.query("UPDATE orders SET status = 'paid', closed_at = now() WHERE id = $1", [req.params.id]);
        await auditHotel(tx, me, 'restaurant.order_paid', { type: 'order', id: req.params.id }, `Commande ${o.number} encaissée (${o.total_amount}, ${b.methodCode})`, { after: { paymentId: rows[0]!.id }, ip: req.ip, requestId: req.id });
        return { status: 200, body: await loadOrder(tx, req.params.id) };
      }),
    );
    return reply.code(out.status).send(out.body);
  });

  r.get('/restaurant/in-house', { preValidation: order, schema: { tags, summary: 'Clients actuellement en séjour (pour imputer une commande à leur chambre)' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT r.id AS "reservationId", r.reference, ro.number AS "roomNumber", g.first_name || ' ' || g.last_name AS "guestName"
         FROM reservation_rooms rr JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
         JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id
         WHERE rr.status = 'checked_in' ORDER BY length(ro.number), ro.number`,
      ),
    );
    return { guests: rows };
  });

  r.post('/restaurant/orders/:id/post-to-room', {
    preValidation: order,
    schema: { tags, summary: 'Imputer la commande à la note d\'un client en séjour (une seule fois) : elle sera facturée avec son séjour', params: id, body: z.object({ reservationId: z.uuid() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const o = await lockOpen(tx, req.params.id);
      if (o.total_amount === 0) throw new AppError('order_empty');
      const { rows: target } = await tx.query<{ folio_id: string; currency: string }>(
        `SELECT f.id AS folio_id, f.currency FROM reservations r JOIN folios f ON f.reservation_id = r.id AND f.hotel_id = r.hotel_id
         WHERE r.id = $1 AND EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.reservation_id = r.id AND rr.status = 'checked_in')`,
        [req.body.reservationId],
      );
      if (!target[0]) throw new AppError('order_target_not_in_house');
      const folio = await lockFolio(tx, target[0].folio_id);
      if (folio.status !== 'open') throw new AppError('folio_closed');
      if (folio.currency !== o.currency) throw new AppError('payment_currency_mismatch');
      const { rows: head } = await tx.query<{ subtotal_amount: number; tax_amount: number }>('SELECT subtotal_amount, tax_amount FROM orders WHERE id = $1', [req.params.id]);
      const clock = await hotelClock(tx, app.deps.now());
      // L'index unique (source, source_ref) interdit d'imputer deux fois la même commande
      await tx.query(
        `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, quantity, unit_amount, amount, tax_amount, service_date, source, source_ref, created_by_membership_id)
         VALUES ($1, $2, 'restaurant', $3, 1, $4, $4, $5, $6, 'restaurant_order', $7, $8)`,
        [me.hotelId, folio.id, `Restaurant ${o.number}`, head[0]!.subtotal_amount, head[0]!.tax_amount, clock.today, req.params.id, me.membershipId],
      );
      await tx.query("UPDATE order_items SET status = 'served' WHERE order_id = $1 AND status = 'ordered'", [req.params.id]);
      await tx.query("UPDATE orders SET status = 'posted_to_room', folio_id = $2, closed_at = now() WHERE id = $1", [req.params.id, folio.id]);
      await auditHotel(tx, me, 'restaurant.order_posted', { type: 'order', id: req.params.id }, `Commande ${o.number} imputée à la note ${req.body.reservationId}`, { after: { folioId: folio.id }, ip: req.ip, requestId: req.id });
      return loadOrder(tx, req.params.id);
    });
  });
}
