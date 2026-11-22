import { isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { serialRows } from '../lib/query';
import { folioBalance } from '../services/folio';
import { ensureCleaningTask } from '../services/housekeeping';
import { expireTentatives, hotelClock, lockReservation, recomputeTotals, syncReservationStatus } from '../services/reservations';

const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');

const LINE_SELECT = `SELECT rr.id AS "lineId", r.id AS "reservationId", r.reference, rr.status, g.id AS "guestId", g.first_name || ' ' || g.last_name AS "guestName", g.is_vip AS "isVip",
         ro.id AS "roomId", ro.number AS "roomNumber", ro.housekeeping_status AS "housekeepingStatus", c.name AS "categoryName",
         to_char(rr.check_in, 'YYYY-MM-DD') AS "checkIn", to_char(rr.check_out, 'YYYY-MM-DD') AS "checkOut", rr.adults, rr.children,
         rr.actual_check_in AS "actualCheckIn", rr.actual_check_out AS "actualCheckOut",
         COALESCE(b.balance_due, r.total_amount) AS "balanceDue", r.deposit_required_amount AS "depositRequired", COALESCE(b.deposit_satisfied, r.deposit_required_amount = 0) AS "depositSatisfied",
         r.currency, f.id AS "folioId", r.special_requests AS "specialRequests"
  FROM reservation_rooms rr
  JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id
  JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
  JOIN room_categories c ON c.id = rr.category_id AND c.hotel_id = rr.hotel_id
  LEFT JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id
  LEFT JOIN reservation_balances b ON b.reservation_id = r.id AND b.hotel_id = r.hotel_id
  LEFT JOIN folios f ON f.reservation_id = r.id AND f.hotel_id = r.hotel_id`;

const target = z.object({ reservationId: z.uuid().optional(), lineIds: z.array(z.uuid()).min(1).max(20).optional() })
  .refine((b) => b.reservationId || b.lineIds, { message: 'Indiquez la réservation ou les chambres.' });

/** Réservation visée : donnée directement, ou déduite de la première chambre indiquée. */
async function resolveReservation(tx: Tx, b: { reservationId?: string; lineIds?: string[] }): Promise<string> {
  if (b.reservationId) return b.reservationId;
  const { rows } = await tx.query<{ reservation_id: string }>('SELECT reservation_id FROM reservation_rooms WHERE id = $1', [b.lineIds![0]]);
  if (!rows[0]) throw new AppError('not_found');
  return rows[0].reservation_id;
}

/**
 * Chambre quittée : « à nettoyer » et tâche de ménage créée si la formule inclut le housekeeping. Sans ce module, il n'y a personne
 * pour la remettre « propre » : la chambre reste donc directement disponible.
 */
async function markRoomsDirty(tx: Tx, me: { hotelId: string; entitlements: { features: Record<string, boolean> } }, roomIds: string[], today: string) {
  if (!me.entitlements.features.housekeeping) return;
  await tx.query("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = ANY ($1::uuid[])", [roomIds]);
  for (const id of roomIds) await ensureCleaningTask(tx, me.hotelId, id, today);
}

export default async function receptionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'reservations:read' });
  const checkin = app.hotelAuth({ permission: 'reception:checkin' });
  const checkout = app.hotelAuth({ permission: 'reception:checkout' });
  const tags = ['Réception'];

  r.get('/reception/overview', {
    preValidation: read,
    schema: { tags, summary: 'Journée à la réception : arrivées, départs, clients en séjour, départs en retard', querystring: z.object({ date: date.optional() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const day = req.query.date ?? clock.today;
      const q = serialRows(tx);
      const [arrivals, departures, inHouse, overdue] = await Promise.all([
        q<any>(`${LINE_SELECT} WHERE rr.check_in = $1::date AND rr.status IN ('pending', 'confirmed', 'checked_in', 'checked_out') ORDER BY ro.number NULLS LAST, g.last_name`, [day]),
        q<any>(`${LINE_SELECT} WHERE rr.check_out = $1::date AND rr.status IN ('checked_in', 'checked_out') ORDER BY ro.number NULLS LAST, g.last_name`, [day]),
        q<any>(`${LINE_SELECT} WHERE rr.status = 'checked_in' ORDER BY ro.number NULLS LAST, g.last_name`),
        q<any>(`${LINE_SELECT} WHERE rr.status = 'checked_in' AND rr.check_out < $1::date ORDER BY rr.check_out, ro.number`, [clock.today]),
      ]);
      const done = (l: any, s: string) => l.status === s || l.status === 'checked_out';
      return {
        date: day, today: clock.today, arrivals, departures, inHouse, overdue,
        counts: {
          arrivals: arrivals.length, arrivalsDone: arrivals.filter((l: any) => done(l, 'checked_in')).length,
          departures: departures.length, departuresDone: departures.filter((l: any) => l.status === 'checked_out').length,
          inHouse: inHouse.length, overdue: overdue.length,
        },
      };
    });
  });

  /* ------------------------------------------------------------------ Arrivée */
  r.post('/reception/check-in', {
    preValidation: checkin,
    schema: {
      tags,
      summary: "Enregistrer l'arrivée (une chambre, ou toutes les chambres dues d'une réservation)",
      description: "Possible à partir du jour d'arrivée, réservation confirmée. Une chambre à nettoyer est refusée (409 `room_not_ready`) sauf `force: true`, qui est tracé.",
      body: target.and(z.object({ force: z.boolean().default(false) })),
    },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    return me.tenant(async (tx) => {
      const reservationId = await resolveReservation(tx, b);
      const cur = await lockReservation(tx, reservationId);
      const clock = await hotelClock(tx, app.deps.now());
      const { rows: lines } = await tx.query<{ id: string; room_id: string; number: string; hk: string; check_in: string; check_out: string }>(
        `SELECT rr.id, rr.room_id, ro.number, ro.housekeeping_status AS hk, to_char(rr.check_in, 'YYYY-MM-DD') AS check_in, to_char(rr.check_out, 'YYYY-MM-DD') AS check_out
         FROM reservation_rooms rr JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id
         WHERE rr.reservation_id = $1 AND rr.status IN ('pending', 'confirmed') AND ($2::uuid[] IS NULL OR rr.id = ANY ($2)) ORDER BY ro.number`,
        [reservationId, b.lineIds ?? null],
      );
      if (lines.length === 0) throw new AppError('invalid_status_transition');
      if (lines.some((l) => l.check_in > clock.today)) throw new AppError('checkin_too_early');
      if (lines.some((l) => l.check_out <= clock.today)) throw new AppError('invalid_status_transition');
      const notReady = lines.filter((l) => l.hk !== 'clean' && l.hk !== 'inspected');
      if (notReady.length > 0 && !b.force) throw new AppError('room_not_ready', { rooms: notReady.map((l) => l.number) });
      await tx.query("UPDATE reservation_rooms SET status = 'checked_in', actual_check_in = now() WHERE id = ANY ($1::uuid[])", [lines.map((l) => l.id)]);
      const status = await syncReservationStatus(tx, reservationId);
      await auditHotel(tx, me, 'reception.checked_in', { type: 'reservation', id: reservationId },
        `Arrivée enregistrée : ${cur.reference}, chambre${lines.length > 1 ? 's' : ''} ${lines.map((l) => l.number).join(', ')}${notReady.length ? ' (chambre non prête, forcé)' : ''}`,
        { after: { lines: lines.map((l) => l.id), forced: notReady.length > 0 }, ip: req.ip, requestId: req.id });
      return { reservationId, status, checkedIn: lines.map((l) => l.id), forced: notReady.length > 0 };
    });
  });

  /* ------------------------------------------------------------------ Départ */
  r.post('/reception/check-out', {
    preValidation: checkout,
    schema: {
      tags,
      summary: 'Enregistrer le départ : la chambre passe « à nettoyer », la note est clôturée quand elle est soldée',
      description: "Refusé s'il reste un solde (409 `balance_outstanding`) sauf `allowUnpaid: true` (tracé). `shorten: true` : départ avant la date prévue, les nuits non occupées sont retirées de la réservation (refusé si elle est déjà facturée : émettez d'abord un avoir).",
      body: target.and(z.object({ allowUnpaid: z.boolean().default(false), shorten: z.boolean().default(false) })),
    },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    return me.tenant(async (tx) => {
      const reservationId = await resolveReservation(tx, b);
      const cur = await lockReservation(tx, reservationId);
      const clock = await hotelClock(tx, app.deps.now());
      const { rows: lines } = await tx.query<{ id: string; room_id: string; number: string; check_in: string; check_out: string }>(
        `SELECT rr.id, rr.room_id, ro.number, to_char(rr.check_in, 'YYYY-MM-DD') AS check_in, to_char(rr.check_out, 'YYYY-MM-DD') AS check_out
         FROM reservation_rooms rr JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id
         WHERE rr.reservation_id = $1 AND rr.status = 'checked_in' AND ($2::uuid[] IS NULL OR rr.id = ANY ($2)) ORDER BY ro.number`,
        [reservationId, b.lineIds ?? null],
      );
      if (lines.length === 0) throw new AppError('invalid_status_transition');

      // Le solde ne se contrôle qu'au dernier départ de la réservation (une famille peut partir chambre par chambre)
      const { rows: remaining } = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM reservation_rooms WHERE reservation_id = $1 AND status = 'checked_in' AND id <> ALL ($2::uuid[])", [reservationId, lines.map((l) => l.id)]);
      const last = remaining[0]!.n === 0;
      let unpaid = 0;
      if (last) {
        const folio = await tx.query<{ id: string }>('SELECT id FROM folios WHERE reservation_id = $1', [reservationId]);
        if (folio.rows[0]) {
          // Départ anticipé : les nuits retirées d'abord, pour que le solde soit celui du séjour réellement effectué
          if (b.shorten) {
            for (const l of lines.filter((x) => x.check_in < clock.today && x.check_out > clock.today)) {
              await tx.query('DELETE FROM reservation_room_nights WHERE reservation_room_id = $1 AND night >= $2::date', [l.id, clock.today]);
              await tx.query('UPDATE reservation_rooms SET check_out = $2::date WHERE id = $1', [l.id, clock.today]);
            }
            await recomputeTotals(tx, reservationId);
          }
          unpaid = Math.max((await folioBalance(tx, folio.rows[0].id)).due, 0);
          if (unpaid > 0 && !b.allowUnpaid) throw new AppError('balance_outstanding', { due: unpaid, currency: cur.currency });
        }
      } else if (b.shorten) {
        for (const l of lines.filter((x) => x.check_in < clock.today && x.check_out > clock.today)) {
          await tx.query('DELETE FROM reservation_room_nights WHERE reservation_room_id = $1 AND night >= $2::date', [l.id, clock.today]);
          await tx.query('UPDATE reservation_rooms SET check_out = $2::date WHERE id = $1', [l.id, clock.today]);
        }
        await recomputeTotals(tx, reservationId);
      }

      await tx.query("UPDATE reservation_rooms SET status = 'checked_out', actual_check_out = now() WHERE id = ANY ($1::uuid[])", [lines.map((l) => l.id)]);
      await markRoomsDirty(tx, me, lines.map((l) => l.room_id), clock.today);
      const status = await syncReservationStatus(tx, reservationId);
      let folioClosed = false;
      if (status === 'checked_out') {
        const res = await tx.query("UPDATE folios SET status = 'closed', closed_at = now() WHERE reservation_id = $1 AND status = 'open' AND (SELECT balance_due FROM folio_balances WHERE folio_id = folios.id) <= 0", [reservationId]);
        folioClosed = (res.rowCount ?? 0) > 0;
      }
      await auditHotel(tx, me, unpaid > 0 ? 'reception.checked_out_unpaid' : 'reception.checked_out', { type: 'reservation', id: reservationId },
        `Départ enregistré : ${cur.reference}, chambre${lines.length > 1 ? 's' : ''} ${lines.map((l) => l.number).join(', ')}${unpaid > 0 ? ` — solde impayé ${unpaid} ${cur.currency}` : ''}`,
        { after: { lines: lines.map((l) => l.id), unpaid, shortened: b.shorten }, ip: req.ip, requestId: req.id });
      return { reservationId, status, checkedOut: lines.map((l) => l.id), unpaid, folioClosed };
    });
  });

  /* ------------------------------------------------------------------ Changement de chambre */
  r.post('/reception/change-room', {
    preValidation: checkin,
    schema: {
      tags,
      summary: 'Changer un client de chambre pendant son séjour',
      description: "Le séjour est scindé à la date du jour : l'ancienne chambre est clôturée (et passe « à nettoyer »), une nouvelle ligne occupe la nouvelle chambre jusqu'au départ. Les nuits à venir gardent leur prix convenu.",
      body: z.object({ lineId: z.uuid(), roomId: z.uuid(), reason: z.string().trim().max(300).optional() }),
    },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    return me.tenant(async (tx) => {
      const { rows } = await tx.query<{ reservation_id: string }>('SELECT reservation_id FROM reservation_rooms WHERE id = $1', [b.lineId]);
      if (!rows[0]) throw new AppError('not_found');
      const reservationId = rows[0].reservation_id;
      const cur = await lockReservation(tx, reservationId);
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const { rows: l } = await tx.query<{ id: string; status: string; room_id: string; category_id: string; check_in: string; check_out: string; adults: number; children: number; old_number: string }>(
        `SELECT rr.id, rr.status, rr.room_id, rr.category_id, to_char(rr.check_in, 'YYYY-MM-DD') AS check_in, to_char(rr.check_out, 'YYYY-MM-DD') AS check_out, rr.adults, rr.children, ro.number AS old_number
         FROM reservation_rooms rr JOIN rooms ro ON ro.id = rr.room_id AND ro.hotel_id = rr.hotel_id WHERE rr.id = $1 FOR UPDATE`,
        [b.lineId],
      );
      const line = l[0]!;
      if (line.status !== 'checked_in') throw new AppError('invalid_status_transition');
      if (line.room_id === b.roomId) throw new AppError('room_change_same');
      const { rows: room } = await tx.query<{ category_id: string; capacity: number; number: string; is_archived: boolean }>('SELECT category_id, capacity, number, is_archived FROM rooms WHERE id = $1', [b.roomId]);
      const target = room[0];
      if (!target || target.is_archived) throw new AppError('not_found');
      if (target.capacity < line.adults + line.children) throw new AppError('capacity_exceeded');

      try {
        if (line.check_in >= clock.today) {
          // Arrivé aujourd'hui : aucune nuit passée dans l'ancienne chambre, on change simplement de chambre
          await tx.query('UPDATE reservation_rooms SET room_id = $2, category_id = $3 WHERE id = $1', [line.id, b.roomId, target.category_id]);
        } else {
          // L'ancienne chambre se termine aujourd'hui ; la nouvelle ligne reprend les nuits restantes avec leur prix
          await tx.query("UPDATE reservation_rooms SET check_out = $2::date, status = 'checked_out', actual_check_out = now() WHERE id = $1", [line.id, clock.today]);
          const { rows: created } = await tx.query<{ id: string }>(
            `INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, status, check_in, check_out, adults, children, actual_check_in)
             VALUES ($1, $2, $3, $4, 'checked_in', $5::date, $6::date, $7, $8, now()) RETURNING id`,
            [me.hotelId, reservationId, target.category_id, b.roomId, clock.today, line.check_out, line.adults, line.children],
          );
          await tx.query('UPDATE reservation_room_nights SET reservation_room_id = $2 WHERE reservation_room_id = $1 AND night >= $3::date', [line.id, created[0]!.id, clock.today]);
        }
      } catch (e) {
        if ((e as { code?: string }).code === '23P01') throw new AppError('room_not_available');
        throw e;
      }
      await markRoomsDirty(tx, me, [line.room_id], clock.today);
      await syncReservationStatus(tx, reservationId);
      await auditHotel(tx, me, 'reception.room_changed', { type: 'reservation', id: reservationId }, `${cur.reference} : chambre ${line.old_number} → ${target.number}${b.reason ? ` (${b.reason})` : ''}`, { after: b, ip: req.ip, requestId: req.id });
      return { reservationId, from: line.old_number, to: target.number };
    });
  });
}
