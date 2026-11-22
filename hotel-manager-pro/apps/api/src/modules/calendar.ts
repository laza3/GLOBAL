import { addDays, eachNight, isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { serialRows } from '../lib/query';
import { expireTentatives, hotelClock, lockReservation, modifyRoomLine, recomputeTotals } from '../services/reservations';

const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const REASONS = ['maintenance', 'out_of_service', 'owner_use', 'other'] as const;
const MAX_DAYS = 62;

interface StayItem {
  kind: 'stay'; id: string; roomId: string; startsOn: string; endsOn: string; reservationId: string; reference: string; status: string;
  guestName: string; isVip: boolean; adults: number; children: number; balanceDue: number; currency: string; version: number;
}
interface BlockItem { kind: 'block'; id: string; roomId: string; startsOn: string; endsOn: string | null; reason: string; notes: string | null }

export default async function calendarRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'calendar:read' });
  const move = app.hotelAuth({ permission: 'calendar:move' });
  const tags = ['Calendrier'];

  r.get('/calendar', {
    preValidation: read,
    schema: {
      tags,
      summary: "Grille d'occupation : chambres, séjours et blocages sur une période, avec l'occupation de chaque jour",
      querystring: z.object({ from: date.optional(), days: z.coerce.number().int().min(1).max(MAX_DAYS).default(14), categoryId: z.uuid().optional() }),
    },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const from = req.query.from ?? clock.today;
      const days = req.query.days;
      const to = addDays(from, days); // exclu
      const q = serialRows(tx);

      const rooms = await q<{ id: string; number: string; name: string | null; floor: number | null; capacity: number; categoryId: string; categoryName: string }>(
        `SELECT r.id, r.number, r.name, r.floor, r.capacity, r.category_id AS "categoryId", c.name AS "categoryName"
         FROM rooms r JOIN room_categories c ON c.id = r.category_id AND c.hotel_id = r.hotel_id
         WHERE NOT r.is_archived AND ($1::uuid IS NULL OR r.category_id = $1)
         ORDER BY c.sort_order, c.name, length(r.number), r.number`,
        [req.query.categoryId ?? null],
      );
      // Séjours lus sur les lignes de réservation (et non sur les allocations) : un séjour terminé reste visible dans le passé
      const stays = await q<StayItem>(
        `SELECT 'stay' AS kind, rr.id, rr.room_id AS "roomId", to_char(rr.check_in, 'YYYY-MM-DD') AS "startsOn", to_char(rr.check_out, 'YYYY-MM-DD') AS "endsOn",
                r.id AS "reservationId", r.reference, rr.status, g.first_name || ' ' || g.last_name AS "guestName", g.is_vip AS "isVip",
                rr.adults, rr.children, COALESCE(b.balance_due, r.total_amount) AS "balanceDue", r.currency, r.version
         FROM reservation_rooms rr
         JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id
         JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
         LEFT JOIN reservation_balances b ON b.reservation_id = r.id AND b.hotel_id = r.hotel_id
         WHERE rr.room_id IS NOT NULL AND rr.status IN ('tentative', 'pending', 'confirmed', 'checked_in', 'checked_out')
           AND rr.check_in < $2::date AND rr.check_out > $1::date
         ORDER BY rr.check_in, rr.id`,
        [from, to],
      );
      const blocks = await q<BlockItem>(
        `SELECT 'block' AS kind, a.id, a.room_id AS "roomId", to_char(a.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(a.ends_on, 'YYYY-MM-DD') AS "endsOn",
                a.block_reason AS reason, a.notes
         FROM room_allocations a
         WHERE a.kind = 'block' AND a.starts_on < $2::date AND (a.ends_on IS NULL OR a.ends_on > $1::date)
         ORDER BY a.starts_on, a.id`,
        [from, to],
      );

      const roomIds = new Set(rooms.map((x) => x.id));
      const items = [...stays, ...blocks].filter((i) => roomIds.has(i.roomId));

      // Occupation de chaque nuit : chambres occupées / chambres vendables (une chambre bloquée n'est pas vendable)
      const occupancy = Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), occupied: 0, blocked: 0, total: rooms.length }));
      const index = new Map(occupancy.map((o, i) => [o.date, i]));
      for (const item of items) {
        const end = item.endsOn ?? to;
        const lo = item.startsOn < from ? from : item.startsOn;
        const hi = end > to ? to : end;
        if (hi <= lo) continue;
        for (const night of eachNight(lo, hi)) {
          const slot = occupancy[index.get(night) ?? -1];
          if (!slot) continue;
          if (item.kind === 'stay') slot.occupied++;
          else slot.blocked++;
        }
      }
      return { from, to, days, today: clock.today, rooms, items, occupancy };
    });
  });

  /* ------------------------------------------------------------------ Blocages de chambre */
  r.post('/calendar/blocks', {
    preValidation: move,
    schema: {
      tags,
      summary: 'Bloquer une chambre (maintenance, hors service, usage propriétaire) : elle n\'est plus vendable sur la période',
      body: z.object({ roomId: z.uuid(), startsOn: date, endsOn: date.nullable(), reason: z.enum(REASONS), notes: z.string().trim().max(500).nullable().optional() })
        .refine((b) => b.endsOn === null || b.endsOn > b.startsOn, { message: 'La fin doit être après le début.', path: ['endsOn'] }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const created = await me.tenant(async (tx) => {
      await expireTentatives(tx);
      const room = await tx.query('SELECT number FROM rooms WHERE id = $1 AND NOT is_archived', [b.roomId]);
      if (!room.rowCount) throw new AppError('not_found');
      // Le chevauchement avec un séjour est refusé par la base (409 room_not_available)
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason, notes, created_by_membership_id)
         VALUES ($1, $2, 'block', $3, $4, $5, $6, $7) RETURNING id`,
        [me.hotelId, b.roomId, b.startsOn, b.endsOn, b.reason, b.notes ?? null, me.membershipId],
      );
      await auditHotel(tx, me, 'room.blocked', { type: 'room', id: b.roomId }, `Chambre ${room.rows[0].number} bloquée (${b.reason}) du ${b.startsOn}${b.endsOn ? ` au ${b.endsOn}` : ' jusqu\'à nouvel ordre'}`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id: created });
  });

  r.patch('/calendar/blocks/:id', {
    preValidation: move,
    schema: {
      tags,
      summary: 'Modifier un blocage : date de fin (« la maintenance est terminée ») ou note',
      params: z.object({ id: z.uuid() }),
      body: z.object({ endsOn: date.nullable().optional(), notes: z.string().trim().max(500).nullable().optional() }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    if (b.endsOn === undefined && b.notes === undefined) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ starts_on: string; room_id: string }>("SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, room_id FROM room_allocations WHERE id = $1 AND kind = 'block' FOR UPDATE", [req.params.id]);
      const cur = rows[0];
      if (!cur) throw new AppError('not_found');
      if (b.endsOn && b.endsOn <= cur.starts_on) throw new AppError('validation_error', [{ path: 'endsOn', message: 'La fin doit être après le début du blocage.' }]);
      await tx.query(
        'UPDATE room_allocations SET ends_on = CASE WHEN $2::boolean THEN $3::date ELSE ends_on END, notes = CASE WHEN $4::boolean THEN $5 ELSE notes END WHERE id = $1',
        [req.params.id, b.endsOn !== undefined, b.endsOn ?? null, b.notes !== undefined, b.notes ?? null],
      );
      await auditHotel(tx, me, 'room.block_updated', { type: 'room', id: cur.room_id }, 'Blocage de chambre modifié', { after: b, ip: req.ip, requestId: req.id });
    });
    return { updated: true };
  });

  r.delete('/calendar/blocks/:id', { preValidation: move, schema: { tags, summary: 'Lever un blocage', params: z.object({ id: z.uuid() }) } }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const res = await tx.query<{ room_id: string }>("DELETE FROM room_allocations WHERE id = $1 AND kind = 'block' RETURNING room_id", [req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'room.unblocked', { type: 'room', id: res.rows[0]!.room_id }, 'Blocage de chambre levé', { ip: req.ip, requestId: req.id });
    });
    return { removed: true };
  });

  /* ------------------------------------------------------------------ Déplacer un séjour */
  r.post('/calendar/stays/:lineId/move', {
    preValidation: move,
    schema: {
      tags,
      summary: 'Déplacer un séjour vers une autre chambre et/ou d\'autres dates (les nuits conservées gardent leur prix)',
      params: z.object({ lineId: z.uuid() }),
      body: z.object({ roomId: z.uuid().optional(), checkIn: date.optional(), checkOut: date.optional() }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const patch = req.body;
    if (Object.keys(patch).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    return me.tenant(async (tx) => {
      const { rows } = await tx.query<{ reservation_id: string }>('SELECT reservation_id FROM reservation_rooms WHERE id = $1', [req.params.lineId]);
      const reservationId = rows[0]?.reservation_id;
      if (!reservationId) throw new AppError('not_found');
      const cur = await lockReservation(tx, reservationId);
      if (!['tentative', 'pending', 'confirmed', 'checked_in'].includes(cur.status)) throw new AppError('reservation_not_editable');
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const res = await modifyRoomLine(tx, { hotelId: me.hotelId, reservationId, today: clock.today }, req.params.lineId, patch);
      if (res.changed.length > 0) {
        await recomputeTotals(tx, reservationId);
        await auditHotel(tx, me, 'reservation.room_updated', { type: 'reservation', id: reservationId }, `Réservation ${cur.reference} : séjour déplacé (${res.changed.join(', ')})`, { after: patch, ip: req.ip, requestId: req.id });
      }
      return { reservationId, changed: res.changed };
    });
  });
}
