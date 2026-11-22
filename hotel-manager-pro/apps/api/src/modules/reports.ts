import { addDays, isDateString, nightsBetween, type DateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { toCsv } from '../lib/csv';
import { serialRows } from '../lib/query';
import { expireTentatives, hotelClock } from '../services/reservations';

const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const MAX_DAYS = 366;
/** Nuits comptées comme « vendues » : réservations fermes ou en cours/terminées (une option n'est pas une vente). */
const SOLD = "('pending', 'confirmed', 'checked_in', 'checked_out')";

interface DayRow { date: DateString; roomsSold: number; roomsAvailable: number; revenue: number }

/** Chambres vendues, chambres disponibles (hors chambres bloquées) et revenu des nuits, jour par jour. */
async function dailySeries(tx: Tx, from: DateString, to: DateString): Promise<DayRow[]> {
  const { rows } = await tx.query<DayRow>(
    `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d),
          total AS (SELECT count(*)::int AS n FROM rooms WHERE NOT is_archived),
          sold AS (
            SELECT n.night AS d, count(*)::int AS rooms, COALESCE(sum(n.rate - n.discount), 0)::bigint AS revenue
            FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id
            WHERE n.night BETWEEN $1::date AND $2::date AND rr.status IN ${SOLD} GROUP BY n.night),
          blocked AS (
            SELECT days.d, count(DISTINCT a.room_id)::int AS rooms FROM days
            JOIN room_allocations a ON a.kind = 'block' AND daterange(a.starts_on, a.ends_on, '[)') @> days.d
            JOIN rooms ro ON ro.id = a.room_id AND ro.hotel_id = a.hotel_id AND NOT ro.is_archived GROUP BY days.d)
     SELECT to_char(days.d, 'YYYY-MM-DD') AS date, COALESCE(sold.rooms, 0) AS "roomsSold", GREATEST(total.n - COALESCE(blocked.rooms, 0), 0) AS "roomsAvailable", COALESCE(sold.revenue, 0) AS revenue
     FROM days CROSS JOIN total LEFT JOIN sold ON sold.d = days.d LEFT JOIN blocked ON blocked.d = days.d ORDER BY days.d`,
    [from, to],
  );
  return rows;
}

const kpis = (days: DayRow[]) => {
  const sold = days.reduce((s, d) => s + d.roomsSold, 0);
  const available = days.reduce((s, d) => s + d.roomsAvailable, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  return {
    roomsSold: sold, roomsAvailable: available, revenue,
    occupancyRate: available > 0 ? Math.round((sold / available) * 10_000) / 10_000 : 0,
    adr: sold > 0 ? Math.round(revenue / sold) : 0,
    revpar: available > 0 ? Math.round(revenue / available) : 0,
  };
};

export default async function reportsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'reports:read' });
  const exportAuth = app.hotelAuth({ permission: 'reports:export', feature: 'exports' });
  const tags = ['Rapports'];
  const range = z.object({ from: date.optional(), to: date.optional() });

  async function resolveRange(tx: Tx, q: { from?: string; to?: string }) {
    const clock = await hotelClock(tx, app.deps.now());
    const to = q.to ?? clock.today;
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw new AppError('validation_error', [{ path: 'to', message: 'La fin doit être après le début.' }]);
    if (nightsBetween(from, to) + 1 > MAX_DAYS) throw new AppError('validation_error', [{ path: 'from', message: `Période trop longue (${MAX_DAYS} jours au plus).` }]);
    return { from, to, clock };
  }

  r.get('/reports/performance', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Occupation, prix moyen (ADR), revenu par chambre disponible (RevPAR) sur une période',
      description:
        "Calculé sur les NUITS réservées (les prix de chaque nuit sont figés à la réservation : un tarif modifié ensuite ne réécrit pas l'historique). Les chambres bloquées ne comptent pas comme disponibles. " +
        "Revenu = prix des nuits, remises déduites (hors restaurant et services, donnés à part). Les comparaisons avec la période précédente, les ventilations et les meilleurs clients exigent la formule avec analytique avancée (`advanced: false` sinon).",
      querystring: range,
    },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      await expireTentatives(tx);
      const { from, to, clock } = await resolveRange(tx, req.query);
      const advanced = !!me.entitlements.features.reports_advanced;
      const days = await dailySeries(tx, from, to);
      const q = serialRows(tx);

      const charges = await q<{ kind: string; amount: number; tax: number }>(
        "SELECT kind, COALESCE(sum(amount), 0)::bigint AS amount, COALESCE(sum(tax_amount), 0)::bigint AS tax FROM folio_charges c WHERE c.voided_at IS NULL AND c.service_date BETWEEN $1::date AND $2::date AND NOT (c.source = 'reservation' AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = c.source_ref AND r.status = 'tentative')) GROUP BY kind ORDER BY kind",
        [from, to],
      );

      let previous = null, previousDaily = null, byCategory = null, bySource = null, topGuests = null;
      if (advanced) {
        const span = nightsBetween(from, to) + 1;
        const pFrom = addDays(from, -span);
        const pTo = addDays(from, -1);
        previousDaily = await dailySeries(tx, pFrom, pTo);
        previous = kpis(previousDaily);
        const to1 = addDays(to, 1);
        byCategory = await q<any>(
          `SELECT c.id, c.name,
                  (SELECT count(*)::int FROM rooms ro WHERE ro.category_id = c.id AND NOT ro.is_archived) AS rooms,
                  COALESCE(s.sold, 0) AS "roomsSold", COALESCE(s.revenue, 0)::bigint AS revenue,
                  GREATEST((SELECT count(*)::int FROM rooms ro WHERE ro.category_id = c.id AND NOT ro.is_archived) * $3::int - COALESCE(b.blocked, 0), 0) AS "roomsAvailable"
           FROM room_categories c
           LEFT JOIN (SELECT rr.category_id, count(*)::int AS sold, sum(n.rate - n.discount) AS revenue
                      FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id
                      WHERE n.night BETWEEN $1::date AND $2::date AND rr.status IN ${SOLD} GROUP BY rr.category_id) s ON s.category_id = c.id
           LEFT JOIN (SELECT ro.category_id, sum(GREATEST(0, LEAST(COALESCE(a.ends_on, $4::date), $4::date) - GREATEST(a.starts_on, $1::date)))::int AS blocked
                      FROM room_allocations a JOIN rooms ro ON ro.id = a.room_id AND ro.hotel_id = a.hotel_id AND NOT ro.is_archived
                      WHERE a.kind = 'block' AND a.starts_on < $4::date AND (a.ends_on IS NULL OR a.ends_on > $1::date) GROUP BY ro.category_id) b ON b.category_id = c.id
           WHERE c.is_active OR s.sold IS NOT NULL ORDER BY c.sort_order, c.name`,
          [from, to, span, to1],
        );
        byCategory = byCategory.map((c: any) => ({ ...c, occupancyRate: c.roomsAvailable > 0 ? Math.round((c.roomsSold / c.roomsAvailable) * 10_000) / 10_000 : 0, adr: c.roomsSold > 0 ? Math.round(c.revenue / c.roomsSold) : 0 }));
        bySource = await q<any>(
          `SELECT r.source, count(*)::int AS nights, sum(n.rate - n.discount)::bigint AS revenue, count(DISTINCT r.id)::int AS stays
           FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id
           WHERE n.night BETWEEN $1::date AND $2::date AND rr.status IN ${SOLD} GROUP BY r.source ORDER BY sum(n.rate - n.discount) DESC`,
          [from, to],
        );
        topGuests = await q<any>(
          `SELECT g.id AS "guestId", g.first_name || ' ' || g.last_name AS name, count(DISTINCT r.id)::int AS stays, count(*)::int AS nights, sum(n.rate - n.discount)::bigint AS revenue
           FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id JOIN reservations r ON r.id = rr.reservation_id AND r.hotel_id = rr.hotel_id
           JOIN guests g ON g.id = r.guest_id AND g.hotel_id = r.hotel_id
           WHERE n.night BETWEEN $1::date AND $2::date AND rr.status IN ${SOLD} AND g.anonymized_at IS NULL GROUP BY g.id, g.first_name, g.last_name ORDER BY sum(n.rate - n.discount) DESC, g.id LIMIT 10`,
          [from, to],
        );
      }
      return { from, to, currency: clock.currency, advanced, kpis: kpis(days), previous, daily: days, previousDaily, byCategory, bySource, topGuests, charges };
    });
  });

  r.get('/reports/performance.csv', { preValidation: exportAuth, schema: { tags, summary: 'Exporter la série quotidienne en CSV (Excel) — formule avec exports, journalisé', querystring: range } }, async (req, reply) => {
    const me = req.hotel!;
    const out = await me.tenant(async (tx) => {
      const { from, to } = await resolveRange(tx, req.query);
      const days = await dailySeries(tx, from, to);
      await auditHotel(tx, me, 'report.exported', { type: 'report' }, `Export CSV des performances ${from} → ${to}`, { ip: req.ip, requestId: req.id });
      return { from, to, days };
    });
    const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1).replace('.', ',') : '0');
    const csv = toCsv(
      ['Date', 'Chambres vendues', 'Chambres disponibles', "Taux d'occupation (%)", 'Revenu des nuits', 'Prix moyen (ADR)', 'RevPAR'],
      out.days.map((d) => [d.date, d.roomsSold, d.roomsAvailable, pct(d.roomsSold, d.roomsAvailable), d.revenue, d.roomsSold > 0 ? Math.round(d.revenue / d.roomsSold) : 0, d.roomsAvailable > 0 ? Math.round(d.revenue / d.roomsAvailable) : 0]),
    );
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="performances-${out.from}-${out.to}.csv"`).send(csv);
  });

  /* ------------------------------------------------------------------ Tableau de bord */
  const dashboardAuth = app.hotelAuth({ lapsedOk: true });
  r.get('/dashboard', {
    preValidation: dashboardAuth,
    schema: {
      tags,
      summary: 'Vue d\'ensemble de la journée : chambres, arrivées et départs, encaissé, à encaisser, ménage, pannes',
      description: "Chaque bloc n'est renvoyé que si l'utilisateur a le droit de le voir (sinon `null`) : le tableau de bord ne contourne jamais les permissions.",
    },
  }, async (req) => {
    const me = req.hotel!;
    const can = (p: string) => me.permissions.includes(p);
    const feature = (f: string) => !!me.entitlements.features[f];
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const q = serialRows(tx);
      const today = clock.today;

      const rooms = can('rooms:read')
        ? await (async () => {
            const rows = await q<{ status: string; n: number }>('SELECT display_status AS status, count(*)::int AS n FROM room_status_today GROUP BY display_status');
            const by = Object.fromEntries(rows.map((x) => [x.status, x.n]));
            const total = rows.reduce((s, x) => s + x.n, 0);
            const sellable = total - (by.maintenance ?? 0) - (by.out_of_service ?? 0);
            return { total, byStatus: by, occupied: by.occupied ?? 0, occupancyRate: sellable > 0 ? Math.round(((by.occupied ?? 0) / sellable) * 10_000) / 10_000 : 0 };
          })()
        : null;

      const stays = can('reservations:read')
        ? await (async () => {
            const [c] = await q<any>(
              `SELECT count(*) FILTER (WHERE check_in = $1::date AND status IN ('pending', 'confirmed', 'checked_in', 'checked_out'))::int AS arrivals,
                      count(*) FILTER (WHERE check_in = $1::date AND status IN ('checked_in', 'checked_out'))::int AS "arrivalsDone",
                      count(*) FILTER (WHERE check_out = $1::date AND status IN ('checked_in', 'checked_out'))::int AS departures,
                      count(*) FILTER (WHERE check_out = $1::date AND status = 'checked_out')::int AS "departuresDone",
                      count(*) FILTER (WHERE status = 'checked_in')::int AS "inHouse",
                      count(*) FILTER (WHERE status = 'checked_in' AND check_out < $1::date)::int AS overdue
               FROM reservation_rooms`,
              [today],
            );
            const upcoming = await q<{ date: string; n: number }>(
              `WITH d AS (SELECT generate_series($1::date, $1::date + 6, interval '1 day')::date AS day)
               SELECT to_char(d.day, 'YYYY-MM-DD') AS date, (SELECT count(*)::int FROM reservation_rooms rr WHERE rr.check_in = d.day AND rr.status IN ('pending', 'confirmed')) AS n FROM d ORDER BY d.day`,
              [today],
            );
            const [opt] = await q<{ n: number }>("SELECT count(*)::int AS n FROM reservations WHERE status = 'tentative' AND tentative_expires_at < now() + interval '48 hours'");
            const [pending] = await q<{ n: number }>("SELECT count(*)::int AS n FROM reservations WHERE status = 'pending'");
            return { ...c, upcomingArrivals: upcoming, expiringOptions: opt!.n, pendingConfirmation: pending!.n };
          })()
        : null;

      const money = can('payments:read') || can('billing:read')
        ? await (async () => {
            const [c] = await q<{ n: number }>(
              `SELECT COALESCE(sum(CASE WHEN kind = 'refund' THEN -base_amount ELSE base_amount END), 0)::bigint AS n FROM payments WHERE status = 'confirmed' AND (received_at AT TIME ZONE $2)::date = $1::date`,
              [today, clock.timezone],
            );
            const [r2] = await q<{ total: number; n: number }>("SELECT COALESCE(sum(b.balance_due), 0)::bigint AS total, count(*)::int AS n FROM folio_balances b JOIN folios f ON f.id = b.folio_id WHERE f.status = 'open' AND b.balance_due > 0 AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.id = f.reservation_id AND r.status = 'tentative')");
            return { collectedToday: c!.n, receivables: r2!.total, receivablesFolios: r2!.n };
          })()
        : null;

      const restaurant = can('restaurant:read') && feature('restaurant')
        ? (await q<{ n: number; c: number }>(
            "SELECT COALESCE(sum(total_amount) FILTER (WHERE status IN ('paid', 'posted_to_room')), 0)::bigint AS n, count(*) FILTER (WHERE status IN ('open', 'served'))::int AS c FROM orders WHERE (opened_at AT TIME ZONE $2)::date = $1::date",
            [today, clock.timezone],
          )).map((x) => ({ salesToday: x.n, openOrders: x.c }))[0]!
        : null;

      const housekeeping = can('housekeeping:read') && feature('housekeeping')
        ? await (async () => {
            const [h] = await q<{ dirty: number; cleaning: number; issues: number }>(
              `SELECT (SELECT count(*)::int FROM rooms WHERE NOT is_archived AND housekeeping_status = 'dirty') AS dirty,
                      (SELECT count(*)::int FROM rooms WHERE NOT is_archived AND housekeeping_status = 'cleaning') AS cleaning,
                      (SELECT count(*)::int FROM maintenance_requests WHERE status IN ('open', 'in_progress')) AS issues`,
            );
            return h!;
          })()
        : null;

      return { today, currency: clock.currency, rooms, stays, money, restaurant, housekeeping };
    });
  });
}
