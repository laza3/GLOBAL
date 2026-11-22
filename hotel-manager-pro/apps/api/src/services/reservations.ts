import {
  computeTotals, eachNight, isActiveStatus, nightsBetween, spreadDiscount, todayIn,
  type DateString, type ReservationStatus, type StayQuote, type TaxRule,
} from '@hmp/shared';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { loadPricingContext, quote } from './pricing';

/**
 * Cœur des réservations : disponibilité, affectation des chambres, prix figés, totaux.
 *
 * Garantie d'unicité : toute ligne de réservation reçoit une chambre DÈS sa création ; c'est la contrainte d'exclusion de la base
 * (`room_allocations_no_overlap`) qui interdit la double réservation, y compris quand deux requêtes arrivent en même temps :
 * la seconde attend la première, puis échoue (ou passe à la chambre libre suivante quand l'affectation est automatique).
 */

export interface RoomLineInput {
  categoryId: string;
  roomId?: string | null;
  checkIn: DateString;
  checkOut: DateString;
  adults: number;
  children: number;
}

export interface FreeRoom { id: string; number: string; categoryId: string; capacity: number; nightlyRate: number | null }

export const MAX_STAY_NIGHTS = 365;

/** Passe en « annulée » les options échues de l'établissement courant : leurs chambres redeviennent vendables. */
export const expireTentatives = async (tx: Tx): Promise<number> => (await tx.query<{ n: number }>('SELECT expire_my_tentatives() AS n')).rows[0]!.n;

export async function hotelClock(tx: Tx, now: Date): Promise<{ today: DateString; timezone: string; currency: string; reservationPrefix: string }> {
  const { rows } = await tx.query<{ timezone: string; default_currency: string; reservation_prefix: string }>(
    'SELECT timezone, default_currency, reservation_prefix FROM hotel_settings LIMIT 1',
  );
  const s = rows[0]!;
  return { today: todayIn(s.timezone, now), timezone: s.timezone, currency: s.default_currency, reservationPrefix: s.reservation_prefix };
}

/** Règles de taxe applicables aux nuitées à la date donnée. */
export async function loadRoomTaxRules(tx: Tx, on: DateString): Promise<TaxRule[]> {
  const { rows } = await tx.query<{ id: string; name: string; kind: 'percentage' | 'fixed_per_person_night'; rate_bps: number | null; fixed_amount: number | null; is_inclusive: boolean }>(
    `SELECT id, name, kind, rate_bps, fixed_amount, is_inclusive FROM tax_rules
     WHERE is_active AND 'room' = ANY (applies_to) AND (valid_from IS NULL OR valid_from <= $1::date) AND (valid_to IS NULL OR valid_to >= $1::date)
     ORDER BY created_at, id`,
    [on],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, rateBps: r.rate_bps, fixedAmount: r.fixed_amount, inclusive: r.is_inclusive }));
}

/** Chambres libres sur [checkIn, checkOut) : non archivées, catégorie active, aucune occupation (séjour ou bloc) qui chevauche. */
export async function freeRooms(
  tx: Tx,
  q: { checkIn: DateString; checkOut: DateString; categoryId?: string | null; minCapacity?: number; excludeLineId?: string | null },
): Promise<FreeRoom[]> {
  const { rows } = await tx.query<FreeRoom>(
    `SELECT r.id, r.number, r.category_id AS "categoryId", r.capacity, r.nightly_rate AS "nightlyRate"
     FROM rooms r JOIN room_categories c ON c.id = r.category_id AND c.hotel_id = r.hotel_id AND c.is_active
     WHERE NOT r.is_archived
       AND ($1::uuid IS NULL OR r.category_id = $1)
       AND r.capacity >= $2
       AND NOT EXISTS (
         SELECT 1 FROM room_allocations a
         WHERE a.room_id = r.id AND a.hotel_id = r.hotel_id
           AND ($3::uuid IS NULL OR a.reservation_room_id IS DISTINCT FROM $3)
           AND daterange(a.starts_on, a.ends_on, '[)') && daterange($4::date, $5::date, '[)'))
     ORDER BY length(r.number), r.number`,
    [q.categoryId ?? null, q.minCapacity ?? 1, q.excludeLineId ?? null, q.checkIn, q.checkOut],
  );
  return rows;
}

export function assertDates(checkIn: DateString, checkOut: DateString, today: DateString, opts: { allowPast?: boolean } = {}) {
  const n = nightsBetween(checkIn, checkOut);
  if (n < 1) throw new AppError('validation_error', [{ path: 'checkOut', message: "Le départ doit être après l'arrivée." }]);
  if (n > MAX_STAY_NIGHTS) throw new AppError('validation_error', [{ path: 'checkOut', message: `Un séjour ne peut pas dépasser ${MAX_STAY_NIGHTS} nuits.` }]);
  if (!opts.allowPast && checkIn < today) throw new AppError('checkin_in_past');
}

const isExclusion = (e: unknown) => (e as { code?: string } | null)?.code === '23P01';

/** Exécute `fn` dans un SAVEPOINT : une violation d'exclusion annule seulement cette tentative et renvoie `false`. */
async function attempt(tx: Tx, fn: () => Promise<void>): Promise<boolean> {
  await tx.query('SAVEPOINT line_attempt');
  try {
    await fn();
    await tx.query('RELEASE SAVEPOINT line_attempt');
    return true;
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT line_attempt');
    await tx.query('RELEASE SAVEPOINT line_attempt');
    if (isExclusion(e)) return false;
    throw e;
  }
}

async function insertNights(tx: Tx, hotelId: string, lineId: string, nights: Array<{ night: DateString; rate: number }>) {
  if (nights.length === 0) return;
  await tx.query(
    `INSERT INTO reservation_room_nights (hotel_id, reservation_room_id, night, rate)
     SELECT $1, $2, n, r FROM unnest($3::date[], $4::bigint[]) AS t(n, r)`,
    [hotelId, lineId, nights.map((n) => n.night), nights.map((n) => n.rate)],
  );
}

/**
 * Ajoute une ligne de chambre à une réservation : choisit la chambre (la première libre par numéro si aucune n'est imposée),
 * fige le prix de chaque nuit. Renvoie l'identifiant de la ligne.
 */
export async function addRoomLine(
  tx: Tx,
  ctx: { hotelId: string; reservationId: string; status: ReservationStatus; today: DateString },
  line: RoomLineInput,
): Promise<{ lineId: string; roomId: string; quote: StayQuote }> {
  assertDates(line.checkIn, line.checkOut, ctx.today);
  const guests = line.adults + line.children;

  let candidates: FreeRoom[];
  if (line.roomId) {
    const { rows } = await tx.query<{ id: string; number: string; category_id: string; capacity: number; nightly_rate: number | null; is_archived: boolean }>(
      'SELECT id, number, category_id, capacity, nightly_rate, is_archived FROM rooms WHERE id = $1',
      [line.roomId],
    );
    const room = rows[0];
    if (!room || room.is_archived) throw new AppError('not_found');
    if (room.category_id !== line.categoryId) throw new AppError('validation_error', [{ path: 'roomId', message: 'Cette chambre n\'appartient pas à la catégorie choisie.' }]);
    if (room.capacity < guests) throw new AppError('capacity_exceeded');
    candidates = [{ id: room.id, number: room.number, categoryId: room.category_id, capacity: room.capacity, nightlyRate: room.nightly_rate }];
  } else {
    // Catégorie archivée / inconnue : loadPricingContext lève l'erreur précise
    await loadPricingContext(tx, line.categoryId);
    candidates = await freeRooms(tx, { checkIn: line.checkIn, checkOut: line.checkOut, categoryId: line.categoryId, minCapacity: guests });
    if (candidates.length === 0) {
      // Distinguer « aucune chambre assez grande » de « tout est pris »
      const anyFit = await tx.query('SELECT 1 FROM rooms r WHERE r.category_id = $1 AND NOT r.is_archived AND r.capacity >= $2 LIMIT 1', [line.categoryId, guests]);
      throw new AppError(anyFit.rowCount ? 'room_not_available' : 'capacity_exceeded');
    }
  }

  // Séjour minimal : propre à la période de la nuit d'arrivée, indépendant de la chambre
  const base = await loadPricingContext(tx, line.categoryId);
  const baseQuote = quote(base, line.checkIn, line.checkOut);
  if (!baseQuote.minStayRespected) throw new AppError('min_stay_not_met', { minStay: baseQuote.minStay });

  const status = ctx.status === 'tentative' || ctx.status === 'pending' || ctx.status === 'confirmed' ? ctx.status : 'confirmed';
  for (const room of candidates) {
    const pricing = await loadPricingContext(tx, line.categoryId, room.id);
    const priced = quote(pricing, line.checkIn, line.checkOut);
    let lineId = '';
    const ok = await attempt(tx, async () => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, status, check_in, check_out, adults, children)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [ctx.hotelId, ctx.reservationId, line.categoryId, room.id, status, line.checkIn, line.checkOut, line.adults, line.children],
      );
      lineId = rows[0]!.id;
      await insertNights(tx, ctx.hotelId, lineId, priced.nights.map((n) => ({ night: n.night, rate: n.rate })));
    });
    if (ok) return { lineId, roomId: room.id, quote: priced };
  }
  throw new AppError('room_not_available');
}

interface NightRow { id: string; rate: number; line_id: string; adults: number; status: string }

/**
 * Recalcule les montants d'une réservation à partir de ses nuits FIGÉES (jamais des tarifs courants) :
 * hors taxe, remise répartie par nuit, taxes (règles applicables à la date d'arrivée), total. Écrit le détail des taxes.
 * Une réservation annulée ou « non présenté » garde ses montants tels qu'au dernier calcul.
 */
export async function recomputeTotals(tx: Tx, reservationId: string): Promise<{ subtotal: number; discount: number; tax: number; total: number }> {
  const { rows: head } = await tx.query<{ discount_requested: number; deposit_required_amount: number; status: string }>(
    'SELECT discount_requested, deposit_required_amount, status FROM reservations WHERE id = $1',
    [reservationId],
  );
  const res = head[0];
  if (!res) throw new AppError('reservation_not_found');

  const { rows: nights } = await tx.query<NightRow>(
    `SELECT n.id, n.rate, rr.id AS line_id, rr.adults, rr.status
     FROM reservation_room_nights n JOIN reservation_rooms rr ON rr.id = n.reservation_room_id AND rr.hotel_id = n.hotel_id
     WHERE rr.reservation_id = $1 AND rr.status NOT IN ('cancelled', 'no_show')
     ORDER BY rr.check_in, rr.created_at, rr.id, n.night`,
    [reservationId],
  );
  const { rows: first } = await tx.query<{ d: string }>(
    "SELECT to_char(min(check_in), 'YYYY-MM-DD') AS d FROM reservation_rooms WHERE reservation_id = $1 AND status NOT IN ('cancelled', 'no_show')",
    [reservationId],
  );
  const rates = nights.map((n) => n.rate);
  const rules = first[0]?.d ? await loadRoomTaxRules(tx, first[0].d) : [];
  const personNights = nights.reduce((s, n) => s + n.adults, 0);
  const totals = computeTotals({ rates, discount: res.discount_requested, personNights, rules });

  const shares = spreadDiscount(rates, res.discount_requested);
  if (nights.length > 0) {
    await tx.query(
      'UPDATE reservation_room_nights n SET discount = v.d FROM unnest($1::uuid[], $2::bigint[]) AS v(id, d) WHERE n.id = v.id AND n.discount <> v.d',
      [nights.map((n) => n.id), shares],
    );
  }
  // Un acompte ne peut dépasser le total : si le séjour raccourcit, il est ramené au total plutôt que de bloquer la modification
  await tx.query(
    `UPDATE reservations SET subtotal_amount = $2, discount_amount = $3, tax_amount = $4, total_amount = $5, tax_breakdown = $6::jsonb,
            deposit_required_amount = LEAST(deposit_required_amount, $5) WHERE id = $1`,
    [reservationId, totals.subtotal, totals.discount, totals.tax, totals.total, JSON.stringify(totals.taxes)],
  );
  return { subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, total: totals.total };
}

export interface LinePatch { roomId?: string; checkIn?: DateString; checkOut?: DateString; adults?: number; children?: number }

/**
 * Modifie une ligne de chambre. Les nuits CONSERVÉES gardent leur prix figé (changer une date ne réécrit pas le tarif déjà convenu) ;
 * seules les nuits ajoutées sont chiffrées au tarif courant. Un changement de catégorie rechiffre tout le séjour.
 * Une chambre déjà en séjour ne peut que voir son départ modifié (le changement de chambre en cours de séjour relève de la réception).
 */
export async function modifyRoomLine(
  tx: Tx,
  ctx: { hotelId: string; reservationId: string; today: DateString },
  lineId: string,
  patch: LinePatch,
): Promise<{ changed: string[] }> {
  const { rows } = await tx.query<{ id: string; status: string; room_id: string | null; category_id: string; check_in: string; check_out: string; adults: number; children: number }>(
    `SELECT id, status, room_id, category_id, to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out, adults, children
     FROM reservation_rooms WHERE id = $1 AND reservation_id = $2 FOR UPDATE`,
    [lineId, ctx.reservationId],
  );
  const line = rows[0];
  if (!line) throw new AppError('not_found');
  if (!isActiveStatus(line.status)) throw new AppError('reservation_not_editable');

  const inHouse = line.status === 'checked_in';
  if (inHouse && (patch.roomId !== undefined || patch.checkIn !== undefined || patch.adults !== undefined || patch.children !== undefined)) {
    throw new AppError('reservation_not_editable');
  }

  const next = {
    roomId: patch.roomId ?? line.room_id,
    checkIn: patch.checkIn ?? line.check_in,
    checkOut: patch.checkOut ?? line.check_out,
    adults: patch.adults ?? line.adults,
    children: patch.children ?? line.children,
  };
  const changed = (Object.keys(patch) as Array<keyof LinePatch>).filter((k) => {
    const prev = { roomId: line.room_id, checkIn: line.check_in, checkOut: line.check_out, adults: line.adults, children: line.children }[k];
    return patch[k] !== undefined && patch[k] !== prev;
  });
  if (changed.length === 0) return { changed };

  assertDates(next.checkIn, next.checkOut, ctx.today, { allowPast: next.checkIn === line.check_in });
  if (inHouse && next.checkOut <= ctx.today) throw new AppError('validation_error', [{ path: 'checkOut', message: 'Le nouveau départ doit être après aujourd\'hui.' }]);

  const { rows: roomRows } = await tx.query<{ category_id: string; capacity: number; is_archived: boolean }>('SELECT category_id, capacity, is_archived FROM rooms WHERE id = $1', [next.roomId]);
  const room = roomRows[0];
  if (!room || (room.is_archived && next.roomId !== line.room_id)) throw new AppError('not_found');
  if (room.capacity < next.adults + next.children) throw new AppError('capacity_exceeded');
  const categoryChanged = room.category_id !== line.category_id;

  const pricing = await loadPricingContext(tx, room.category_id, next.roomId);
  const priced = quote(pricing, next.checkIn, next.checkOut);
  if ((changed.includes('checkIn') || changed.includes('checkOut') || categoryChanged) && !priced.minStayRespected) throw new AppError('min_stay_not_met', { minStay: priced.minStay });

  const { rows: old } = await tx.query<{ night: string; rate: number }>(
    "SELECT to_char(night, 'YYYY-MM-DD') AS night, rate FROM reservation_room_nights WHERE reservation_room_id = $1",
    [lineId],
  );
  const oldNights = new Set(old.map((n) => n.night));
  const frozen = new Map(categoryChanged ? [] : old.map((n) => [n.night, n.rate] as const));
  const wanted = priced.nights.map((n) => ({ night: n.night, rate: frozen.get(n.night) ?? n.rate }));
  const wantedSet = new Set(wanted.map((n) => n.night));

  // Nuits conservées : prix figé intact. Nuits retirées : supprimées. Nuits ajoutées : tarif courant.
  const gone = categoryChanged ? [...oldNights] : [...oldNights].filter((n) => !wantedSet.has(n));
  if (gone.length > 0) await tx.query('DELETE FROM reservation_room_nights WHERE reservation_room_id = $1 AND night = ANY ($2::date[])', [lineId, gone]);
  await insertNights(tx, ctx.hotelId, lineId, wanted.filter((n) => categoryChanged || !oldNights.has(n.night)));
  // La remise est répartie à nouveau sur l'ensemble des nuits par recomputeTotals
  await tx.query('UPDATE reservation_room_nights SET discount = 0 WHERE reservation_room_id = $1 AND discount <> 0', [lineId]);

  try {
    await tx.query(
      'UPDATE reservation_rooms SET room_id = $2, category_id = $3, check_in = $4, check_out = $5, adults = $6, children = $7 WHERE id = $1',
      [lineId, next.roomId, room.category_id, next.checkIn, next.checkOut, next.adults, next.children],
    );
  } catch (e) {
    if (isExclusion(e)) throw new AppError('room_not_available');
    throw e;
  }
  return { changed };
}

/** Statut de la réservation déduit de ses lignes (une chambre annulée ou non présentée ne compte plus). */
export function deriveStatus(lineStatuses: string[]): ReservationStatus {
  const live = lineStatuses.filter((s) => s !== 'cancelled' && s !== 'no_show');
  if (live.length === 0) return lineStatuses.includes('no_show') ? 'no_show' : 'cancelled';
  if (live.every((s) => s === 'checked_out')) return 'checked_out';
  if (live.some((s) => s === 'checked_in' || s === 'checked_out')) return 'checked_in';
  if (live.every((s) => s === 'confirmed')) return 'confirmed';
  if (live.some((s) => s === 'pending')) return 'pending';
  if (live.some((s) => s === 'confirmed')) return 'confirmed';
  return 'tentative';
}

export async function syncReservationStatus(tx: Tx, reservationId: string): Promise<ReservationStatus> {
  const { rows } = await tx.query<{ status: string }>('SELECT status FROM reservation_rooms WHERE reservation_id = $1', [reservationId]);
  const next = deriveStatus(rows.map((r) => r.status));
  await tx.query(
    `UPDATE reservations SET status = $2,
            tentative_expires_at = CASE WHEN $2 = 'tentative' THEN tentative_expires_at ELSE NULL END
     WHERE id = $1 AND status <> $2`,
    [reservationId, next],
  );
  return next;
}

/** Verrouille la réservation pour la durée de la transaction et contrôle la version vue par l'utilisateur. */
export async function lockReservation(tx: Tx, id: string, version?: number) {
  const { rows } = await tx.query<{ id: string; status: ReservationStatus; version: number; guest_id: string; reference: string; currency: string; tentative_expires_at: Date | null }>(
    'SELECT id, status, version, guest_id, reference, currency, tentative_expires_at FROM reservations WHERE id = $1 FOR UPDATE',
    [id],
  );
  const r = rows[0];
  if (!r) throw new AppError('reservation_not_found');
  if (version !== undefined && r.version !== version) throw new AppError('version_conflict');
  return r;
}

export const isEditableStatus = (s: string) => isActiveStatus(s);
export { eachNight };
