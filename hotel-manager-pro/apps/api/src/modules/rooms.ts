import { isDateString, nightsBetween } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { buildUpdate, withUnique } from '../lib/sql';
import { loadPricingContext, quote } from '../services/pricing';

const money = z.number().int().min(0).max(1_000_000_000_000);
const id = z.object({ id: z.uuid() });
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');

const categoryBody = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, '1 à 20 caractères : lettres, chiffres, tiret ou souligné.'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable(),
  baseRate: money,
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
});
const CATEGORY_COLUMNS = { code: 'code', name: 'name', description: 'description', baseRate: 'base_rate', sortOrder: 'sort_order', isActive: 'is_active' };

const roomFields = {
  number: z.string().trim().min(1).max(20),
  name: z.string().trim().max(80).nullable(),
  floor: z.number().int().min(-5).max(200).nullable(),
  capacity: z.number().int().min(1).max(30),
  beds: z.number().int().min(1).max(30),
  nightlyRate: money.nullable(),
  description: z.string().trim().max(1000).nullable(),
  amenities: z.array(z.string().trim().min(1).max(40)).max(30),
};
const ROOM_COLUMNS = {
  number: 'number', name: 'name', floor: 'floor', capacity: 'capacity', beds: 'beds', nightlyRate: 'nightly_rate', description: 'description', amenities: 'amenities', categoryId: 'category_id',
};

const rateBody = z
  .object({
    categoryId: z.uuid(),
    name: z.string().trim().min(2).max(80),
    startsOn: date,
    endsOn: date,
    nightlyRate: money,
    weekendRate: money.nullable(),
    minStay: z.number().int().min(1).max(365),
    priority: z.number().int().min(-100).max(100),
    isActive: z.boolean(),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'La date de fin doit être après la date de début.', path: ['endsOn'] });
const RATE_COLUMNS = { name: 'name', startsOn: 'starts_on', endsOn: 'ends_on', nightlyRate: 'nightly_rate', weekendRate: 'weekend_rate', minStay: 'min_stay', priority: 'priority', isActive: 'is_active' };

const UNIQUE = { rooms_hotel_id_number_key: 'room_number_taken', room_categories_hotel_id_code_key: 'category_code_taken' } as const;

export default async function roomsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'rooms:read' });
  const manage = app.hotelAuth({ permission: 'rooms:manage' });
  const tags = ['Chambres'];

  /* ------------------------------------------------------------------ Catégories */
  r.get('/rooms/categories', { preValidation: read, schema: { tags, summary: 'Catégories de chambres (Standard, Deluxe…) avec le nombre de chambres actives' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT c.id, c.code, c.name, c.description, c.base_rate AS "baseRate", c.sort_order AS "sortOrder", c.is_active AS "isActive",
                (SELECT count(*)::int FROM rooms r WHERE r.category_id = c.id AND NOT r.is_archived) AS "roomsCount"
         FROM room_categories c ORDER BY c.sort_order, c.name`,
      ),
    );
    return { categories: rows };
  });

  r.post('/rooms/categories', {
    preValidation: manage,
    schema: { tags, summary: 'Créer une catégorie', body: categoryBody.partial({ description: true, sortOrder: true, isActive: true }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        const { rows } = await tx.query<{ id: string }>(
          'INSERT INTO room_categories (hotel_id, code, name, description, base_rate, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [me.hotelId, b.code, b.name, b.description ?? null, b.baseRate, b.sortOrder ?? 0, b.isActive ?? true],
        );
        await auditHotel(tx, me, 'room_category.created', { type: 'room_category', id: rows[0]!.id }, `Catégorie « ${b.name} » créée`, { after: b, ip: req.ip, requestId: req.id });
        return rows[0]!;
      }),
    );
    return reply.code(201).send(created);
  });

  r.patch('/rooms/categories/:id', { preValidation: manage, schema: { tags, summary: 'Modifier une catégorie', params: id, body: categoryBody.partial() } }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('room_categories', CATEGORY_COLUMNS, req.body, { column: 'id', value: req.params.id });
    await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        const res = await tx.query(u.sql, u.args);
        if (!res.rowCount) throw new AppError('not_found');
        await auditHotel(tx, me, 'room_category.updated', { type: 'room_category', id: req.params.id }, `Catégorie modifiée : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
      }),
    );
    return { updated: u.keys };
  });

  /* ------------------------------------------------------------------ Chambres */
  r.get('/rooms', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Liste des chambres avec leur état du jour (dérivé : disponible, réservée, occupée, à nettoyer, maintenance…)',
      querystring: z.object({
        categoryId: z.uuid().optional(),
        status: z.string().max(30).optional(),
        q: z.string().trim().max(60).optional(),
        archived: z.enum(['true', 'false']).default('false'),
      }),
    },
  }, async (req) => {
    const { categoryId, status, q, archived } = req.query;
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT r.id, r.number, r.name, r.floor, r.capacity, r.beds, r.category_id AS "categoryId", c.name AS "categoryName", c.code AS "categoryCode",
                r.nightly_rate AS "nightlyRate", COALESCE(r.nightly_rate, c.base_rate) AS "baseNightlyRate", r.description, r.amenities,
                r.housekeeping_status AS "housekeepingStatus", r.is_archived AS "isArchived", r.version,
                CASE WHEN r.is_archived THEN 'archived' ELSE s.display_status END AS "displayStatus"
         FROM rooms r JOIN room_categories c ON c.id = r.category_id LEFT JOIN room_status_today s ON s.room_id = r.id
         WHERE ($1::uuid IS NULL OR r.category_id = $1)
           AND ($2::boolean OR NOT r.is_archived)
           AND ($3::text IS NULL OR r.number ILIKE '%' || $3 || '%' OR r.name ILIKE '%' || $3 || '%')
           AND ($4::text IS NULL OR s.display_status = $4)
         ORDER BY length(r.number), r.number`,
        [categoryId ?? null, archived === 'true', q || null, status ?? null],
      ),
    );
    return { rooms: rows };
  });

  r.post('/rooms', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Créer une chambre (la limite de la formule est vérifiée par la base)',
      body: z.object({ ...roomFields, categoryId: z.uuid() }).partial({ name: true, floor: true, capacity: true, beds: true, nightlyRate: true, description: true, amenities: true }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        const { rows: cat } = await tx.query<{ is_active: boolean }>('SELECT is_active FROM room_categories WHERE id = $1', [b.categoryId]);
        if (!cat[0]) throw new AppError('not_found');
        if (!cat[0].is_active) throw new AppError('category_inactive');
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO rooms (hotel_id, category_id, number, name, floor, capacity, beds, nightly_rate, description, amenities)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [me.hotelId, b.categoryId, b.number, b.name ?? null, b.floor ?? null, b.capacity ?? 2, b.beds ?? 1, b.nightlyRate ?? null, b.description ?? null, b.amenities ?? []],
        );
        await auditHotel(tx, me, 'room.created', { type: 'room', id: rows[0]!.id }, `Chambre ${b.number} créée`, { after: b, ip: req.ip, requestId: req.id });
        return rows[0]!;
      }),
    );
    return reply.code(201).send(created);
  });

  r.post('/rooms/bulk', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Créer plusieurs chambres d\'un coup (ex. 101 à 110) — tout ou rien',
      body: z.object({
        categoryId: z.uuid(),
        from: z.number().int().min(0).max(99_999),
        to: z.number().int().min(0).max(99_999),
        prefix: z.string().trim().max(6).default(''),
        floor: z.number().int().min(-5).max(200).nullable().optional(),
        capacity: z.number().int().min(1).max(30).default(2),
        beds: z.number().int().min(1).max(30).default(1),
      }).refine((v) => v.to >= v.from && v.to - v.from < 200, { message: 'Indiquez une plage de 200 chambres au plus (de … à …).', path: ['to'] }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const numbers: string[] = [];
    for (let n = b.from; n <= b.to; n++) numbers.push(`${b.prefix}${n}`);
    await me.tenant(async (tx) => {
      const { rows: cat } = await tx.query<{ is_active: boolean }>('SELECT is_active FROM room_categories WHERE id = $1', [b.categoryId]);
      if (!cat[0]) throw new AppError('not_found');
      if (!cat[0].is_active) throw new AppError('category_inactive');
      for (const number of numbers) {
        await withUnique(UNIQUE, () =>
          tx.query('INSERT INTO rooms (hotel_id, category_id, number, floor, capacity, beds) VALUES ($1, $2, $3, $4, $5, $6)', [me.hotelId, b.categoryId, number, b.floor ?? null, b.capacity, b.beds]),
        );
      }
      await auditHotel(tx, me, 'room.bulk_created', { type: 'room' }, `${numbers.length} chambres créées (${numbers[0]} à ${numbers[numbers.length - 1]})`, { ip: req.ip, requestId: req.id });
    });
    return reply.code(201).send({ created: numbers.length, numbers });
  });

  r.patch('/rooms/:id', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Modifier une chambre (contrôle de version : refus si quelqu\'un l\'a modifiée entre-temps)',
      params: id,
      body: z.object({ ...roomFields, categoryId: z.uuid(), version: z.number().int().min(1) }).partial().required({ version: true }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const { version, ...patch } = req.body;
    const u = buildUpdate('rooms', ROOM_COLUMNS, patch, { column: 'id', value: req.params.id, version });
    await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        const res = await tx.query(u.sql, u.args);
        if (!res.rowCount) {
          const exists = await tx.query('SELECT 1 FROM rooms WHERE id = $1', [req.params.id]);
          throw new AppError(exists.rowCount ? 'version_conflict' : 'not_found');
        }
        await auditHotel(tx, me, 'room.updated', { type: 'room', id: req.params.id }, `Chambre modifiée : ${u.keys.join(', ')}`, { after: patch, ip: req.ip, requestId: req.id });
      }),
    );
    return { updated: u.keys };
  });

  r.post('/rooms/:id/archive', { preValidation: manage, schema: { tags, summary: 'Archiver une chambre (refusé si des séjours ou blocages sont à venir)', params: id } }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const future = await tx.query(
        `SELECT 1 FROM room_allocations a JOIN hotel_settings hs ON hs.hotel_id = a.hotel_id
         WHERE a.room_id = $1 AND (a.ends_on IS NULL OR a.ends_on > (now() AT TIME ZONE hs.timezone)::date) LIMIT 1`,
        [req.params.id],
      );
      if (future.rowCount) throw new AppError('room_has_future_stays');
      const res = await tx.query('UPDATE rooms SET is_archived = true WHERE id = $1 AND NOT is_archived', [req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'room.archived', { type: 'room', id: req.params.id }, 'Chambre archivée', { ip: req.ip, requestId: req.id });
    });
    return { archived: true };
  });

  r.post('/rooms/:id/restore', { preValidation: manage, schema: { tags, summary: 'Restaurer une chambre archivée (la limite de la formule est revérifiée)', params: id } }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const res = await tx.query('UPDATE rooms SET is_archived = false WHERE id = $1 AND is_archived', [req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'room.restored', { type: 'room', id: req.params.id }, 'Chambre restaurée', { ip: req.ip, requestId: req.id });
    });
    return { archived: false };
  });

  /* ------------------------------------------------------------------ Tarifs saisonniers */
  r.get('/rooms/rates', { preValidation: read, schema: { tags, summary: 'Périodes tarifaires (saisons)', querystring: z.object({ categoryId: z.uuid().optional() }) } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT p.id, p.category_id AS "categoryId", c.name AS "categoryName", p.name, to_char(p.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(p.ends_on, 'YYYY-MM-DD') AS "endsOn",
                p.nightly_rate AS "nightlyRate", p.weekend_rate AS "weekendRate", p.min_stay AS "minStay", p.priority, p.is_active AS "isActive"
         FROM rate_periods p JOIN room_categories c ON c.id = p.category_id
         WHERE ($1::uuid IS NULL OR p.category_id = $1) ORDER BY c.sort_order, c.name, p.starts_on`,
        [req.query.categoryId ?? null],
      ),
    );
    return { periods: rows };
  });

  r.post('/rooms/rates', { preValidation: manage, schema: { tags, summary: 'Créer une période tarifaire', body: rateBody } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO rate_periods (hotel_id, category_id, name, starts_on, ends_on, nightly_rate, weekend_rate, min_stay, priority, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [me.hotelId, b.categoryId, b.name, b.startsOn, b.endsOn, b.nightlyRate, b.weekendRate, b.minStay, b.priority, b.isActive],
      );
      await auditHotel(tx, me, 'rate_period.created', { type: 'rate_period', id: rows[0]!.id }, `Période « ${b.name} » créée`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!;
    });
    return reply.code(201).send(created);
  });

  r.patch('/rooms/rates/:id', {
    preValidation: manage,
    schema: { tags, summary: 'Modifier une période tarifaire (les réservations existantes ne sont jamais recalculées)', params: id, body: z.object({
      name: z.string().trim().min(2).max(80), startsOn: date, endsOn: date, nightlyRate: money, weekendRate: money.nullable(), minStay: z.number().int().min(1).max(365), priority: z.number().int().min(-100).max(100), isActive: z.boolean(),
    }).partial() },
  }, async (req) => {
    const me = req.hotel!;
    const u = buildUpdate('rate_periods', RATE_COLUMNS, req.body, { column: 'id', value: req.params.id });
    await me.tenant(async (tx) => {
      const res = await tx.query(u.sql, u.args);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'rate_period.updated', { type: 'rate_period', id: req.params.id }, `Période modifiée : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.delete('/rooms/rates/:id', { preValidation: manage, schema: { tags, summary: 'Supprimer une période tarifaire', params: id } }, async (req, reply) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const res = await tx.query('DELETE FROM rate_periods WHERE id = $1', [req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'rate_period.deleted', { type: 'rate_period', id: req.params.id }, 'Période tarifaire supprimée', { ip: req.ip, requestId: req.id });
    });
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------ Devis */
  r.get('/rooms/pricing', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Prix d\'un séjour, nuit par nuit (tarif de la chambre > saison > tarif de base ; week-end = nuits du vendredi et du samedi)',
      querystring: z.object({ categoryId: z.uuid(), roomId: z.uuid().optional(), checkIn: date, checkOut: date }),
    },
  }, async (req) => {
    const { categoryId, roomId, checkIn, checkOut } = req.query;
    if (nightsBetween(checkIn, checkOut) < 1) throw new AppError('validation_error', [{ path: 'checkOut', message: 'Le départ doit être après l\'arrivée.' }]);
    return req.hotel!.tenant(async (tx) => {
      const ctx = await loadPricingContext(tx, categoryId, roomId);
      return { category: ctx.categoryName, ...quote(ctx, checkIn, checkOut) };
    });
  });
}
