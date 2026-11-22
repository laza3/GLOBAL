import { canTransition, isDateString, nightsBetween, quoteStay, type ReservationStatus } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { withIdempotency } from '../lib/idempotency';
import { serialRows } from '../lib/query';
import { loadPricingContext } from '../services/pricing';
import {
  addRoomLine, assertDates, expireTentatives, freeRooms, hotelClock, lockReservation, modifyRoomLine, recomputeTotals, syncReservationStatus,
} from '../services/reservations';

const money = z.number().int().min(0).max(1_000_000_000_000);
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const id = z.object({ id: z.uuid() });
const SOURCES = ['direct', 'phone', 'walk_in', 'website', 'booking_com', 'airbnb', 'expedia', 'agency', 'other'] as const;
const text = (max: number) => z.string().trim().max(max).nullable();

const lineBody = z.object({
  categoryId: z.uuid(),
  roomId: z.uuid().nullish(),
  checkIn: date,
  checkOut: date,
  adults: z.number().int().min(1).max(30).default(1),
  children: z.number().int().min(0).max(30).default(0),
});

const createBody = z.object({
  guestId: z.uuid(),
  source: z.enum(SOURCES).default('direct'),
  status: z.enum(['tentative', 'pending', 'confirmed']).default('confirmed'),
  groupName: text(120).optional(),
  specialRequests: text(2000).optional(),
  internalNotes: text(2000).optional(),
  tentativeExpiresAt: z.iso.datetime().optional(),
  depositRequired: money.default(0),
  discount: money.default(0),
  rooms: z.array(lineBody).min(1, 'Ajoutez au moins une chambre.').max(20),
});

const patchBody = z
  .object({
    guestId: z.uuid(),
    source: z.enum(SOURCES),
    groupName: text(120),
    specialRequests: text(2000),
    internalNotes: text(2000),
    tentativeExpiresAt: z.iso.datetime(),
    depositRequired: money,
    discount: money,
    version: z.number().int().min(1),
  })
  .partial()
  .required({ version: true });

const linePatchBody = z
  .object({ roomId: z.uuid(), checkIn: date, checkOut: date, adults: z.number().int().min(1).max(30), children: z.number().int().min(0).max(30), version: z.number().int().min(1) })
  .partial()
  .required({ version: true });


/** Détail complet d'une réservation : en-tête, client, chambres avec leurs nuits figées, solde, historique, actions possibles. */
async function loadDetail(tx: Tx, reservationId: string) {
  const q = serialRows(tx);
  const [head] = await q<any>(
    `SELECT r.id, r.reference, r.status, r.source, r.group_name AS "groupName", r.currency,
            r.subtotal_amount AS subtotal, r.discount_amount AS discount, r.tax_amount AS tax, r.total_amount AS total,
            r.discount_requested AS "discountRequested", r.deposit_required_amount AS "depositRequired",
            r.special_requests AS "specialRequests", r.internal_notes AS "internalNotes", r.tentative_expires_at AS "tentativeExpiresAt",
            r.cancelled_at AS "cancelledAt", r.cancel_reason AS "cancelReason", r.tax_breakdown AS taxes, r.version,
            r.created_at AS "createdAt", r.updated_at AS "updatedAt",
            g.id AS "guestId", g.first_name AS "guestFirstName", g.last_name AS "guestLastName", g.email AS "guestEmail", g.phone AS "guestPhone", g.is_vip AS "guestIsVip",
            f.id AS "folioId", COALESCE(b.amount_paid, 0) AS "amountPaid", COALESCE(b.balance_due, r.total_amount) AS "balanceDue",
            COALESCE(b.deposit_satisfied, r.deposit_required_amount = 0) AS "depositSatisfied"
     FROM reservations r
     JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
     LEFT JOIN folios f ON f.reservation_id = r.id AND f.hotel_id = r.hotel_id
     LEFT JOIN reservation_balances b ON b.reservation_id = r.id AND b.hotel_id = r.hotel_id
     WHERE r.id = $1`,
    [reservationId],
  );
  if (!head) throw new AppError('reservation_not_found');

  const [lines, nights, history] = await Promise.all([
    q<any>(
      `SELECT rr.id, rr.status, rr.room_id AS "roomId", ro.number AS "roomNumber", ro.capacity AS "roomCapacity", rr.category_id AS "categoryId", c.name AS "categoryName",
              to_char(rr.check_in, 'YYYY-MM-DD') AS "checkIn", to_char(rr.check_out, 'YYYY-MM-DD') AS "checkOut", rr.nights, rr.adults, rr.children,
              rr.actual_check_in AS "actualCheckIn", rr.actual_check_out AS "actualCheckOut",
              COALESCE(sum(n.rate), 0)::bigint AS gross, COALESCE(sum(n.discount), 0)::bigint AS discount
       FROM reservation_rooms rr
       JOIN room_categories c ON c.id = rr.category_id AND c.hotel_id = rr.hotel_id
       LEFT JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id
       LEFT JOIN reservation_room_nights n ON n.reservation_room_id = rr.id AND n.hotel_id = rr.hotel_id
       WHERE rr.reservation_id = $1
       GROUP BY rr.id, ro.number, ro.capacity, c.name
       ORDER BY rr.check_in, rr.created_at, rr.id`,
      [reservationId],
    ),
    q<any>(
      `SELECT n.reservation_room_id AS "lineId", to_char(n.night, 'YYYY-MM-DD') AS night, n.rate, n.discount
       FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id
       WHERE rr.reservation_id = $1 ORDER BY n.night`,
      [reservationId],
    ),
    q<any>(
      `SELECT a.id, a.action, a.summary, a.created_at AS "at", u.full_name AS "actorName"
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.entity_type = 'reservation' AND a.entity_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 50`,
      [reservationId],
    ),
  ]);

  const byLine = new Map<string, Array<{ night: string; rate: number; discount: number }>>();
  for (const n of nights) byLine.set(n.lineId, [...(byLine.get(n.lineId) ?? []), { night: n.night, rate: n.rate, discount: n.discount }]);
  const live = lines.filter((l: any) => !['cancelled', 'no_show'].includes(l.status));
  const status = head.status as ReservationStatus;

  return {
    ...head,
    guest: { id: head.guestId, firstName: head.guestFirstName, lastName: head.guestLastName, email: head.guestEmail, phone: head.guestPhone, isVip: head.guestIsVip },
    rooms: lines.map((l: any) => ({ ...l, nightly: byLine.get(l.id) ?? [] })),
    history,
    actions: {
      edit: ['tentative', 'pending', 'confirmed', 'checked_in'].includes(status),
      confirm: canTransition(status, 'confirmed'),
      cancel: canTransition(status, 'cancelled'),
      noShow: canTransition(status, 'no_show'),
      addRoom: ['tentative', 'pending', 'confirmed'].includes(status),
      cancelRoom: ['tentative', 'pending', 'confirmed'].includes(status) && live.length > 1,
    },
  };
}

export default async function reservationsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'reservations:read' });
  const create = app.hotelAuth({ permission: 'reservations:create' });
  const update = app.hotelAuth({ permission: 'reservations:update' });
  const cancelAuth = app.hotelAuth({ permission: 'reservations:cancel' });
  const tags = ['Réservations'];

  /* ------------------------------------------------------------------ Disponibilité */
  r.get('/reservations/availability', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Chambres libres sur une période, par catégorie, avec le prix du séjour (les options échues sont libérées avant le calcul)',
      querystring: z.object({
        checkIn: date, checkOut: date,
        adults: z.coerce.number().int().min(1).max(30).default(1),
        children: z.coerce.number().int().min(0).max(30).default(0),
        categoryId: z.uuid().optional(),
        /** Ligne en cours de modification : ses propres dates ne comptent pas comme occupées. */
        excludeLineId: z.uuid().optional(),
      }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const { checkIn, checkOut, adults, children, categoryId, excludeLineId } = req.query;
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      assertDates(checkIn, checkOut, clock.today, { allowPast: !!excludeLineId });
      await expireTentatives(tx);
      const { rows: cats } = await tx.query<{ id: string; name: string; code: string; base_rate: number }>(
        'SELECT id, name, code, base_rate FROM room_categories WHERE is_active AND ($1::uuid IS NULL OR id = $1) ORDER BY sort_order, name',
        [categoryId ?? null],
      );
      const free = await freeRooms(tx, { checkIn, checkOut, categoryId, excludeLineId, minCapacity: 1 });
      const guests = adults + children;
      const categories = [];
      for (const c of cats) {
        const ctx = await loadPricingContext(tx, c.id);
        const base = quoteStay(checkIn, checkOut, { periods: ctx.periods, baseRate: ctx.baseRate });
        const rooms = [];
        for (const room of free.filter((x) => x.categoryId === c.id && x.capacity >= guests)) {
          const own = room.nightlyRate == null ? base : quoteStay(checkIn, checkOut, { periods: ctx.periods, baseRate: ctx.baseRate, roomRate: room.nightlyRate });
          rooms.push({ id: room.id, number: room.number, capacity: room.capacity, subtotal: own.subtotal });
        }
        categories.push({
          id: c.id, name: c.name, code: c.code,
          freeCount: rooms.length,
          subtotal: base.subtotal,
          averageRate: Math.round(base.subtotal / Math.max(base.nights.length, 1)),
          minStay: base.minStay,
          minStayRespected: base.minStayRespected,
          rooms,
        });
      }
      return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut), adults, children, categories };
    });
  });

  /* ------------------------------------------------------------------ Liste */
  r.get('/reservations', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Réservations (recherche, filtres, pagination)',
      querystring: z.object({
        q: z.string().trim().max(100).optional(),
        status: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
        source: z.enum(SOURCES).optional(),
        guestId: z.uuid().optional(),
        from: date.optional(),
        to: date.optional(),
        sort: z.enum(['created', 'arrival_asc', 'arrival_desc']).default('created'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const { q, status, source, guestId, from, to, sort, page, pageSize } = req.query;
    const statuses = status ? status.split(',') : null;
    if (statuses && !statuses.every((s) => ['tentative', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'].includes(s))) {
      throw new AppError('validation_error', [{ path: 'status', message: 'Statut inconnu.' }]);
    }
    return me.tenant(async (tx) => {
      await expireTentatives(tx);
      const where = `($1::text IS NULL OR r.reference ILIKE '%' || $1 || '%' OR g.first_name ILIKE '%' || $1 || '%' OR g.last_name ILIKE '%' || $1 || '%'
                       OR (g.first_name || ' ' || g.last_name) ILIKE '%' || $1 || '%' OR g.email::text ILIKE '%' || $1 || '%'
                       OR EXISTS (SELECT 1 FROM reservation_rooms x JOIN rooms ro ON ro.id = x.room_id AND ro.hotel_id = x.hotel_id WHERE x.reservation_id = r.id AND x.hotel_id = r.hotel_id AND ro.number ILIKE $1 || '%'))
        AND ($2::text[] IS NULL OR r.status = ANY ($2))
        AND ($3::text IS NULL OR r.source = $3)
        AND ($4::uuid IS NULL OR r.guest_id = $4)
        AND (($5::date IS NULL AND $6::date IS NULL) OR EXISTS (
              SELECT 1 FROM reservation_rooms x WHERE x.reservation_id = r.id AND x.hotel_id = r.hotel_id
                AND ($6::date IS NULL OR x.check_in <= $6::date) AND ($5::date IS NULL OR x.check_out > $5::date)))`;
      const args = [q || null, statuses, source ?? null, guestId ?? null, from ?? null, to ?? null];
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM reservations r JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id WHERE ${where}`, args);
      const order = sort === 'arrival_asc' ? 'l.check_in ASC NULLS LAST, r.created_at DESC' : sort === 'arrival_desc' ? 'l.check_in DESC NULLS LAST, r.created_at DESC' : 'r.created_at DESC';
      const { rows } = await tx.query(
        `SELECT r.id, r.reference, r.status, r.source, r.group_name AS "groupName", r.currency, r.total_amount AS total,
                r.deposit_required_amount AS "depositRequired", r.tentative_expires_at AS "tentativeExpiresAt", r.created_at AS "createdAt",
                g.id AS "guestId", g.first_name AS "guestFirstName", g.last_name AS "guestLastName", g.is_vip AS "guestIsVip",
                l.check_in AS "checkIn", l.check_out AS "checkOut", COALESCE(l.rooms_count, 0) AS "roomsCount", COALESCE(l.room_numbers, '{}') AS "roomNumbers",
                COALESCE(l.adults, 0) AS adults, COALESCE(l.children, 0) AS children,
                COALESCE(b.amount_paid, 0) AS "amountPaid", COALESCE(b.balance_due, r.total_amount) AS "balanceDue",
                COALESCE(b.deposit_satisfied, r.deposit_required_amount = 0) AS "depositSatisfied"
         FROM reservations r
         JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
         LEFT JOIN LATERAL (
           SELECT to_char(min(x.check_in), 'YYYY-MM-DD') AS check_in, to_char(max(x.check_out), 'YYYY-MM-DD') AS check_out, count(*)::int AS rooms_count,
                  array_remove(array_agg(DISTINCT ro.number), NULL) AS room_numbers, sum(x.adults)::int AS adults, sum(x.children)::int AS children
           FROM reservation_rooms x LEFT JOIN rooms ro ON ro.id = x.room_id AND ro.hotel_id = x.hotel_id
           WHERE x.reservation_id = r.id AND x.hotel_id = r.hotel_id AND (r.status IN ('cancelled', 'no_show') OR x.status NOT IN ('cancelled', 'no_show'))
         ) l ON true
         LEFT JOIN reservation_balances b ON b.reservation_id = r.id AND b.hotel_id = r.hotel_id
         WHERE ${where}
         ORDER BY ${order}, r.id
         LIMIT $7 OFFSET $8`,
        [...args, pageSize, (page - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page, pageSize };
    });
  });

  /* ------------------------------------------------------------------ Détail */
  r.get('/reservations/:id', { preValidation: read, schema: { tags, summary: 'Détail d\'une réservation (chambres, nuits, taxes, solde, historique)', params: id } }, async (req) =>
    req.hotel!.tenant(async (tx) => {
      await expireTentatives(tx);
      return loadDetail(tx, req.params.id);
    }),
  );

  /* ------------------------------------------------------------------ Création */
  r.post('/reservations', {
    preValidation: create,
    schema: {
      tags,
      summary: 'Créer une réservation (une ou plusieurs chambres)',
      description:
        "Chaque chambre est affectée dès la création (la première libre de la catégorie si `roomId` est omis) : la base interdit toute double réservation, même si deux personnes réservent au même instant. " +
        "Les prix de chaque nuit sont figés. Statut `tentative` = option, qui bloque la chambre jusqu'à `tentativeExpiresAt`. En-tête facultatif `Idempotency-Key` : rejouer la même requête ne crée pas de doublon.",
      body: createBody,
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const out = await me.tenant(async (tx) =>
      withIdempotency(tx, me.hotelId, req.headers['idempotency-key'], 'reservation', b, async () => {
        const clock = await hotelClock(tx, app.deps.now());
        await expireTentatives(tx);

        if (b.status === 'tentative') {
          const at = b.tentativeExpiresAt ? new Date(b.tentativeExpiresAt) : null;
          const now = app.deps.now();
          if (!at || at.getTime() <= now.getTime() || at.getTime() > now.getTime() + 366 * 86_400_000) throw new AppError('option_expiry_invalid');
        }
        const { rowCount } = await tx.query('SELECT 1 FROM guests WHERE id = $1 AND merged_into_id IS NULL AND anonymized_at IS NULL', [b.guestId]);
        if (!rowCount) throw new AppError('guest_not_found');
        for (const line of b.rooms) assertDates(line.checkIn, line.checkOut, clock.today);

        const year = clock.today.slice(0, 4);
        const { rows: counter } = await tx.query<{ value: number }>('SELECT next_hotel_counter($1) AS value', [`reservation:${year}`]);
        const reference = `${clock.reservationPrefix}-${year}-${String(counter[0]!.value).padStart(4, '0')}`;

        const { rows: inserted } = await tx.query<{ id: string }>(
          `INSERT INTO reservations (hotel_id, reference, guest_id, status, source, group_name, currency, special_requests, internal_notes,
                                     tentative_expires_at, discount_requested, deposit_required_amount, created_by_membership_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12) RETURNING id`,
          [me.hotelId, reference, b.guestId, b.status, b.source, b.groupName ?? null, clock.currency, b.specialRequests ?? null, b.internalNotes ?? null,
            b.status === 'tentative' ? b.tentativeExpiresAt : null, b.discount, me.membershipId],
        );
        const reservationId = inserted[0]!.id;
        for (const line of b.rooms) await addRoomLine(tx, { hotelId: me.hotelId, reservationId, status: b.status, today: clock.today }, line);

        const totals = await recomputeTotals(tx, reservationId);
        if (b.depositRequired > totals.total) throw new AppError('deposit_exceeds_total');
        if (b.depositRequired > 0) await tx.query('UPDATE reservations SET deposit_required_amount = $2 WHERE id = $1', [reservationId, b.depositRequired]);
        await tx.query('INSERT INTO folios (hotel_id, reservation_id, guest_id, currency) VALUES ($1, $2, $3, $4)', [me.hotelId, reservationId, b.guestId, clock.currency]);

        await auditHotel(tx, me, 'reservation.created', { type: 'reservation', id: reservationId },
          `Réservation ${reference} créée (${b.rooms.length} chambre${b.rooms.length > 1 ? 's' : ''}, ${b.status === 'tentative' ? 'option' : b.status === 'pending' ? 'en attente' : 'confirmée'})`,
          { after: { reference, status: b.status, total: totals.total, rooms: b.rooms.length }, ip: req.ip, requestId: req.id });
        return { status: 201, body: { id: reservationId, reference, total: totals.total, currency: clock.currency } };
      }),
    );
    return reply.code(out.status).send(out.body);
  });

  /* ------------------------------------------------------------------ Modification de l'en-tête */
  r.patch('/reservations/:id', {
    preValidation: update,
    schema: { tags, summary: 'Modifier une réservation (client, source, notes, acompte, remise, échéance de l\'option) — contrôle de version', params: id, body: patchBody },
  }, async (req) => {
    const me = req.hotel!;
    const { version, ...p } = req.body;
    if (Object.keys(p).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    return me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, version);
      if (!['tentative', 'pending', 'confirmed', 'checked_in'].includes(cur.status)) throw new AppError('reservation_not_editable');

      const sets: string[] = [];
      const args: unknown[] = [req.params.id];
      const set = (col: string, value: unknown) => { args.push(value); sets.push(`${col} = $${args.length}`); };
      if (p.guestId !== undefined) {
        const { rowCount } = await tx.query('SELECT 1 FROM guests WHERE id = $1 AND merged_into_id IS NULL AND anonymized_at IS NULL', [p.guestId]);
        if (!rowCount) throw new AppError('guest_not_found');
        set('guest_id', p.guestId);
        await tx.query('UPDATE folios SET guest_id = $2 WHERE reservation_id = $1', [req.params.id, p.guestId]);
      }
      if (p.source !== undefined) set('source', p.source);
      if (p.groupName !== undefined) set('group_name', p.groupName);
      if (p.specialRequests !== undefined) set('special_requests', p.specialRequests);
      if (p.internalNotes !== undefined) set('internal_notes', p.internalNotes);
      if (p.discount !== undefined) set('discount_requested', p.discount);
      if (p.tentativeExpiresAt !== undefined) {
        if (cur.status !== 'tentative') throw new AppError('reservation_not_editable');
        const at = new Date(p.tentativeExpiresAt);
        const now = app.deps.now();
        if (at.getTime() <= now.getTime() || at.getTime() > now.getTime() + 366 * 86_400_000) throw new AppError('option_expiry_invalid');
        set('tentative_expires_at', p.tentativeExpiresAt);
      }
      if (sets.length > 0) await tx.query(`UPDATE reservations SET ${sets.join(', ')} WHERE id = $1`, args);

      let total = (await tx.query<{ total_amount: number }>('SELECT total_amount FROM reservations WHERE id = $1', [req.params.id])).rows[0]!.total_amount;
      if (p.discount !== undefined) total = (await recomputeTotals(tx, req.params.id)).total;
      if (p.depositRequired !== undefined) {
        if (p.depositRequired > total) throw new AppError('deposit_exceeds_total');
        await tx.query('UPDATE reservations SET deposit_required_amount = $2 WHERE id = $1', [req.params.id, p.depositRequired]);
      }
      await auditHotel(tx, me, 'reservation.updated', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} modifiée : ${Object.keys(p).join(', ')}`, { after: p, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
  });

  /* ------------------------------------------------------------------ Chambres de la réservation */
  r.post('/reservations/:id/rooms', {
    preValidation: update,
    schema: { tags, summary: 'Ajouter une chambre à une réservation', params: id, body: lineBody.extend({ version: z.number().int().min(1) }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const { version, ...line } = req.body;
    const detail = await me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, version);
      if (!['tentative', 'pending', 'confirmed'].includes(cur.status)) throw new AppError('reservation_not_editable');
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const added = await addRoomLine(tx, { hotelId: me.hotelId, reservationId: req.params.id, status: cur.status, today: clock.today }, line);
      await recomputeTotals(tx, req.params.id);
      await auditHotel(tx, me, 'reservation.room_added', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} : chambre ajoutée (${line.checkIn} → ${line.checkOut})`, { after: { lineId: added.lineId, roomId: added.roomId }, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
    return reply.code(201).send(detail);
  });

  r.patch('/reservations/:id/rooms/:lineId', {
    preValidation: update,
    schema: {
      tags,
      summary: 'Modifier une chambre de la réservation (dates, chambre, personnes). Les nuits conservées gardent leur prix ; seules les nuits ajoutées sont chiffrées au tarif actuel.',
      params: z.object({ id: z.uuid(), lineId: z.uuid() }),
      body: linePatchBody,
    },
  }, async (req) => {
    const me = req.hotel!;
    const { version, ...patch } = req.body;
    if (Object.keys(patch).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    return me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, version);
      if (!['tentative', 'pending', 'confirmed', 'checked_in'].includes(cur.status)) throw new AppError('reservation_not_editable');
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const res = await modifyRoomLine(tx, { hotelId: me.hotelId, reservationId: req.params.id, today: clock.today }, req.params.lineId, patch);
      if (res.changed.length > 0) {
        await recomputeTotals(tx, req.params.id);
        await auditHotel(tx, me, 'reservation.room_updated', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} : chambre modifiée (${res.changed.join(', ')})`, { after: patch, ip: req.ip, requestId: req.id });
      }
      return loadDetail(tx, req.params.id);
    });
  });

  r.post('/reservations/:id/rooms/:lineId/cancel', {
    preValidation: cancelAuth,
    schema: { tags, summary: 'Annuler une chambre d\'une réservation à plusieurs chambres', params: z.object({ id: z.uuid(), lineId: z.uuid() }), body: z.object({ version: z.number().int().min(1) }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, req.body.version);
      if (!['tentative', 'pending', 'confirmed'].includes(cur.status)) throw new AppError('reservation_not_editable');
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM reservation_rooms WHERE reservation_id = $1', [req.params.id]);
      const target = await tx.query<{ status: string }>('SELECT status FROM reservation_rooms WHERE id = $1 AND reservation_id = $2 FOR UPDATE', [req.params.lineId, req.params.id]);
      if (!target.rows[0]) throw new AppError('not_found');
      if (!['tentative', 'pending', 'confirmed'].includes(target.rows[0].status)) throw new AppError('reservation_not_editable');
      if (rows.filter((x) => !['cancelled', 'no_show'].includes(x.status)).length <= 1) throw new AppError('last_room_line');
      await tx.query("UPDATE reservation_rooms SET status = 'cancelled' WHERE id = $1", [req.params.lineId]);
      await syncReservationStatus(tx, req.params.id);
      await recomputeTotals(tx, req.params.id);
      await auditHotel(tx, me, 'reservation.room_cancelled', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} : une chambre annulée`, { after: { lineId: req.params.lineId }, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
  });

  /* ------------------------------------------------------------------ Statuts */
  r.post('/reservations/:id/confirm', {
    preValidation: update,
    schema: { tags, summary: 'Confirmer une réservation en attente ou une option (supprime l\'échéance de l\'option)', params: id, body: z.object({ version: z.number().int().min(1).optional() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      await expireTentatives(tx);
      const cur = await lockReservation(tx, req.params.id, req.body.version);
      if (!canTransition(cur.status, 'confirmed')) throw new AppError('invalid_status_transition');
      await tx.query("UPDATE reservation_rooms SET status = 'confirmed' WHERE reservation_id = $1 AND status IN ('tentative', 'pending')", [req.params.id]);
      await tx.query("UPDATE reservations SET status = 'confirmed', tentative_expires_at = NULL WHERE id = $1", [req.params.id]);
      await auditHotel(tx, me, 'reservation.confirmed', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} confirmée`, { before: { status: cur.status }, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
  });

  r.post('/reservations/:id/cancel', {
    preValidation: cancelAuth,
    schema: {
      tags,
      summary: 'Annuler une réservation (les chambres sont libérées ; les paiements déjà reçus restent sur la note, à rembourser depuis la facturation)',
      params: id,
      body: z.object({ reason: z.string().trim().min(3, 'Indiquez le motif (3 caractères au moins).').max(500), version: z.number().int().min(1).optional() }),
    },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, req.body.version);
      if (!canTransition(cur.status, 'cancelled')) throw new AppError('invalid_status_transition');
      await tx.query("UPDATE reservation_rooms SET status = 'cancelled' WHERE reservation_id = $1 AND status IN ('tentative', 'pending', 'confirmed')", [req.params.id]);
      await tx.query("UPDATE reservations SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, tentative_expires_at = NULL WHERE id = $1", [req.params.id, req.body.reason]);
      await auditHotel(tx, me, 'reservation.cancelled', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} annulée : ${req.body.reason}`, { before: { status: cur.status }, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
  });

  r.post('/reservations/:id/no-show', {
    preValidation: update,
    schema: { tags, summary: 'Marquer « non présenté » (à partir du jour d\'arrivée) : les chambres sont libérées', params: id, body: z.object({ version: z.number().int().min(1).optional() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const cur = await lockReservation(tx, req.params.id, req.body.version);
      if (!canTransition(cur.status, 'no_show')) throw new AppError('invalid_status_transition');
      const clock = await hotelClock(tx, app.deps.now());
      const { rows } = await tx.query<{ d: string }>("SELECT to_char(min(check_in), 'YYYY-MM-DD') AS d FROM reservation_rooms WHERE reservation_id = $1 AND status IN ('pending', 'confirmed')", [req.params.id]);
      if (rows[0]?.d && rows[0].d > clock.today) throw new AppError('no_show_too_early');
      await tx.query("UPDATE reservation_rooms SET status = 'no_show' WHERE reservation_id = $1 AND status IN ('pending', 'confirmed')", [req.params.id]);
      await tx.query("UPDATE reservations SET status = 'no_show' WHERE id = $1", [req.params.id]);
      await auditHotel(tx, me, 'reservation.no_show', { type: 'reservation', id: req.params.id }, `Réservation ${cur.reference} : client non présenté`, { before: { status: cur.status }, ip: req.ip, requestId: req.id });
      return loadDetail(tx, req.params.id);
    });
  });
}

export { loadDetail as loadReservationDetail };
