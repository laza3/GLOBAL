import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbErrorCode } from '../src/client.js';
import { ROLE, bookRoom, createTestDb, registerHotel, seedGuest, seedRooms, sqlState, withTenant, type HotelFixture, type TestDb } from './helpers.js';

let db: TestDb;
let H: HotelFixture;
let cat: string;
let rooms: string[];
let guest: string;

const as = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: H.hotelId, userId: H.userId }, fn, ROLE);

/** Réservation sans compteur partagé (le compteur sérialiserait les transactions et masquerait la vraie course). */
async function rawBook(roomId: string | null, checkIn: string, checkOut: string, status = 'confirmed') {
  const reservationId = randomUUID();
  return as(async (tx) => {
    await tx.query(`INSERT INTO reservations (id, hotel_id, reference, guest_id, status, currency) VALUES ($1, $2, $3, $4, $5, 'MGA')`,
      [reservationId, H.hotelId, `R-${reservationId}`, guest, status]);
    const rr = randomUUID();
    await tx.query(
      `INSERT INTO reservation_rooms (id, hotel_id, reservation_id, category_id, room_id, status, check_in, check_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [rr, H.hotelId, reservationId, cat, roomId, status, checkIn, checkOut],
    );
    return { reservationId, reservationRoomId: rr };
  });
}

beforeAll(async () => {
  db = await createTestDb();
  H = await registerHotel(db, { plan: 'business' });
  ({ categoryId: cat, roomIds: rooms } = await seedRooms(db, H, 4));
  guest = await seedGuest(db, H);
});
afterAll(async () => {
  await db.drop();
});

describe('anti double-réservation (contrainte d\'exclusion PostgreSQL)', () => {
  it('refuse une seconde réservation de la même chambre sur des dates qui se chevauchent', async () => {
    await rawBook(rooms[0]!, '2031-03-10', '2031-03-15');
    for (const [from, to] of [['2031-03-10', '2031-03-15'], ['2031-03-12', '2031-03-13'], ['2031-03-08', '2031-03-11'], ['2031-03-14', '2031-03-20'], ['2031-03-01', '2031-03-31']] as const) {
      const r = await sqlState(rawBook(rooms[0]!, from, to));
      expect(r.code, `${from} -> ${to}`).toBe('23P01');
      expect(dbErrorCode({ code: r.code, constraint: r.constraint })).toBe('room_not_available');
    }
  });

  it('autorise les rotations le jour même (départ le 15, arrivée le 15) et les dates disjointes', async () => {
    await rawBook(rooms[0]!, '2031-03-15', '2031-03-17');
    await rawBook(rooms[0]!, '2031-03-08', '2031-03-10');
    await rawBook(rooms[0]!, '2031-04-01', '2031-04-05');
  });

  it('autorise les mêmes dates sur des chambres différentes', async () => {
    await rawBook(rooms[1]!, '2031-03-10', '2031-03-15');
    await rawBook(rooms[2]!, '2031-03-10', '2031-03-15');
  });

  it('une seule réservation gagne quand 12 clients réservent la même chambre en même temps', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => rawBook(rooms[3]!, '2031-06-01', '2031-06-04')));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(11);
    expect(ko.every((r) => (r.reason as { code?: string }).code === '23P01')).toBe(true);
    const { rows } = await db.admin.query(`SELECT count(*)::int AS n FROM room_allocations WHERE room_id = $1 AND starts_on = '2031-06-01'`, [rooms[3]]);
    expect(rows[0].n).toBe(1);
  });

  it('les chevauchements partiels concurrents n\'en laissent passer qu\'un seul', async () => {
    const room = rooms[3]!;
    const windows: Array<[string, string]> = [['2031-08-01', '2031-08-05'], ['2031-08-03', '2031-08-08'], ['2031-08-04', '2031-08-06'], ['2031-08-02', '2031-08-04']];
    const results = await Promise.allSettled(windows.map(([a, b]) => rawBook(room, a, b)));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    // Invariant : aucune paire d'allocations de la chambre ne se chevauche, quel que soit l'ordre d'arrivée
    const { rows } = await db.admin.query(
      `SELECT count(*)::int AS n FROM room_allocations a JOIN room_allocations b
         ON a.room_id = b.room_id AND a.id < b.id AND daterange(a.starts_on, a.ends_on) && daterange(b.starts_on, b.ends_on)
       WHERE a.room_id = $1`, [room]);
    expect(rows[0].n).toBe(0);
  });

  it('une réservation provisoire (tentative) bloque la chambre ; une chambre non affectée n\'en bloque aucune', async () => {
    const tentative = randomUUID();
    await as(async (tx) => {
      await tx.query(`INSERT INTO reservations (id, hotel_id, reference, guest_id, status, currency, tentative_expires_at) VALUES ($1, $2, 'T-1', $3, 'tentative', 'MGA', now() + interval '2 days')`, [tentative, H.hotelId, guest]);
      await tx.query(`INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, status, check_in, check_out) VALUES ($1, $2, $3, $4, 'tentative', '2032-01-10', '2032-01-12')`, [H.hotelId, tentative, cat, rooms[0]]);
    });
    expect((await sqlState(rawBook(rooms[0]!, '2032-01-11', '2032-01-13'))).code).toBe('23P01');
    // sans chambre affectée : aucune allocation, donc aucun conflit possible
    await rawBook(null, '2032-01-10', '2032-01-12');
    await rawBook(null, '2032-01-10', '2032-01-12');
  });
});

describe('cycle de vie : l\'allocation suit la réservation sans intervention de l\'API', () => {
  it('annuler libère la chambre immédiatement', async () => {
    const a = await rawBook(rooms[1]!, '2032-02-01', '2032-02-05');
    expect((await sqlState(rawBook(rooms[1]!, '2032-02-02', '2032-02-04'))).code).toBe('23P01');
    await as((tx) => tx.query(`UPDATE reservation_rooms SET status = 'cancelled' WHERE id = $1`, [a.reservationRoomId]));
    await rawBook(rooms[1]!, '2032-02-02', '2032-02-04');
  });

  it('un client absent (no-show) libère la chambre', async () => {
    const a = await rawBook(rooms[2]!, '2032-02-01', '2032-02-03');
    await as((tx) => tx.query(`UPDATE reservation_rooms SET status = 'no_show' WHERE id = $1`, [a.reservationRoomId]));
    await rawBook(rooms[2]!, '2032-02-01', '2032-02-03');
  });

  it('changer de chambre déplace l\'allocation ; viser une chambre prise est refusé et ne change rien', async () => {
    const a = await rawBook(rooms[0]!, '2032-03-01', '2032-03-04');
    await rawBook(rooms[1]!, '2032-03-02', '2032-03-03');
    const refused = await sqlState(as((tx) => tx.query(`UPDATE reservation_rooms SET room_id = $1 WHERE id = $2`, [rooms[1], a.reservationRoomId])));
    expect(refused.code).toBe('23P01');
    const still = await db.admin.query('SELECT room_id FROM room_allocations WHERE reservation_room_id = $1', [a.reservationRoomId]);
    expect(still.rows[0].room_id).toBe(rooms[0]);
    await as((tx) => tx.query(`UPDATE reservation_rooms SET room_id = $1 WHERE id = $2`, [rooms[2], a.reservationRoomId]));
    const moved = await db.admin.query('SELECT room_id FROM room_allocations WHERE reservation_room_id = $1', [a.reservationRoomId]);
    expect(moved.rows[0].room_id).toBe(rooms[2]);
    await rawBook(rooms[0]!, '2032-03-01', '2032-03-04'); // l'ancienne chambre est libre
  });

  it('prolonger un séjour est refusé s\'il heurte la réservation suivante', async () => {
    const a = await rawBook(rooms[3]!, '2032-04-01', '2032-04-03');
    await rawBook(rooms[3]!, '2032-04-05', '2032-04-07');
    const refused = await sqlState(as((tx) => tx.query(`UPDATE reservation_rooms SET check_out = '2032-04-06' WHERE id = $1`, [a.reservationRoomId])));
    expect(refused.code).toBe('23P01');
    await as((tx) => tx.query(`UPDATE reservation_rooms SET check_out = '2032-04-05' WHERE id = $1`, [a.reservationRoomId])); // jusqu'à la veille de l'arrivée suivante
  });

  it('un départ anticipé raccourcit l\'allocation et libère les nuits restantes', async () => {
    const a = await rawBook(rooms[0]!, '2032-05-01', '2032-05-10');
    await as((tx) => tx.query(
      `UPDATE reservation_rooms SET status = 'checked_in', actual_check_in = now() WHERE id = $1`, [a.reservationRoomId]));
    await as((tx) => tx.query(`UPDATE reservation_rooms SET check_out = '2032-05-04' WHERE id = $1`, [a.reservationRoomId]));
    await rawBook(rooms[0]!, '2032-05-04', '2032-05-08');
  });

  it('terminer le séjour (check-out) libère la chambre', async () => {
    const a = await rawBook(rooms[1]!, '2032-06-01', '2032-06-03');
    await as((tx) => tx.query(`UPDATE reservation_rooms SET status = 'checked_in', actual_check_in = now() WHERE id = $1`, [a.reservationRoomId]));
    await as((tx) => tx.query(`UPDATE reservation_rooms SET status = 'checked_out', actual_check_out = now() WHERE id = $1`, [a.reservationRoomId]));
    const { rows } = await db.admin.query('SELECT 1 FROM room_allocations WHERE reservation_room_id = $1', [a.reservationRoomId]);
    expect(rows).toHaveLength(0);
  });
});

describe('blocs de chambre (maintenance, hors service)', () => {
  const block = (roomId: string, from: string, to: string | null, reason = 'maintenance') =>
    as((tx) => tx.query(
      `INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, $4, $5) RETURNING id`,
      [H.hotelId, roomId, from, to, reason]));

  it('un bloc ne peut pas recouvrir un séjour existant, et un séjour ne peut pas recouvrir un bloc', async () => {
    await rawBook(rooms[2]!, '2033-01-10', '2033-01-12');
    expect((await sqlState(block(rooms[2]!, '2033-01-11', '2033-01-20'))).code).toBe('23P01');
    await block(rooms[2]!, '2033-01-12', '2033-01-20');
    expect((await sqlState(rawBook(rooms[2]!, '2033-01-15', '2033-01-16'))).code).toBe('23P01');
    await rawBook(rooms[2]!, '2033-01-20', '2033-01-22');
  });

  it('un bloc sans date de fin met la chambre hors service jusqu\'à nouvel ordre ; le supprimer la libère', async () => {
    const { rows } = await block(rooms[3]!, '2033-02-01', null, 'out_of_service');
    expect((await sqlState(rawBook(rooms[3]!, '2040-01-01', '2040-01-03'))).code).toBe('23P01');
    await as((tx) => tx.query('DELETE FROM room_allocations WHERE id = $1', [rows[0].id]));
    await rawBook(rooms[3]!, '2040-01-01', '2040-01-03');
  });

  it('une allocation de séjour ne peut pas être écrite directement (elle est dérivée de la réservation)', async () => {
    const fake = await a_reservation_room();
    const r = await sqlState(as((tx) => tx.query(
      `INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, reservation_room_id) VALUES ($1, $2, 'stay', '2034-01-01', '2034-01-03', $3)`,
      [H.hotelId, rooms[0], fake])));
    expect(r.code).toBe('HM001');
    expect(r.message).toBe('stay_allocation_is_derived');
  });

  async function a_reservation_room(): Promise<string> {
    return (await rawBook(null, '2034-01-01', '2034-01-03')).reservationRoomId;
  }
});

describe('cohérence des données de réservation', () => {
  it('refuse des dates incohérentes, un check-in sans chambre, un total faux, une réservation provisoire sans expiration', async () => {
    const res = randomUUID();
    await as((tx) => tx.query(`INSERT INTO reservations (id, hotel_id, reference, guest_id, currency) VALUES ($1, $2, 'C-1', $3, 'MGA')`, [res, H.hotelId, guest]));
    const ins = (checkIn: string, checkOut: string, room: string | null, status: string, actual: string | null) =>
      as((tx) => tx.query(
        `INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, status, check_in, check_out, actual_check_in) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [H.hotelId, res, cat, room, status, checkIn, checkOut, actual]));
    expect((await sqlState(ins('2035-01-05', '2035-01-05', null, 'pending', null))).code).toBe('23514');
    expect((await sqlState(ins('2035-01-05', '2035-01-03', null, 'pending', null))).code).toBe('23514');
    expect((await sqlState(ins('2035-01-05', '2035-01-07', null, 'checked_in', '2035-01-05T10:00:00Z'))).code).toBe('23514');
    expect((await sqlState(as((tx) => tx.query(
      `INSERT INTO reservations (hotel_id, reference, guest_id, currency, subtotal_amount, total_amount) VALUES ($1, 'C-2', $2, 'MGA', 1000, 999)`, [H.hotelId, guest])))).code).toBe('23514');
    expect((await sqlState(as((tx) => tx.query(
      `INSERT INTO reservations (hotel_id, reference, guest_id, currency, status) VALUES ($1, 'C-3', $2, 'MGA', 'tentative')`, [H.hotelId, guest])))).code).toBe('23514');
  });

  it('la référence est unique par établissement (mais deux hôtels peuvent avoir la même)', async () => {
    const dup = await sqlState(as((tx) => tx.query(
      `INSERT INTO reservations (hotel_id, reference, guest_id, currency) VALUES ($1, 'C-1', $2, 'MGA')`, [H.hotelId, guest])));
    expect(dup.code).toBe('23505');
    const other = await registerHotel(db, { plan: 'starter' });
    const g2 = await seedGuest(db, other);
    await withTenant(db.app, { hotelId: other.hotelId }, (tx) => tx.query(
      `INSERT INTO reservations (hotel_id, reference, guest_id, currency) VALUES ($1, 'C-1', $2, 'MGA')`, [other.hotelId, g2]), ROLE);
  });

  it('le nombre de nuits est calculé par la base ; un client est unique par e-mail dans un hôtel', async () => {
    const r = await rawBook(null, '2036-02-01', '2036-02-08');
    const { rows } = await db.admin.query('SELECT nights FROM reservation_rooms WHERE id = $1', [r.reservationRoomId]);
    expect(rows[0].nights).toBe(7);
    const email = `dup-${randomUUID()}@example.test`;
    await seedGuest(db, H, email);
    expect((await sqlState(seedGuest(db, H, email))).code).toBe('23505');
  });

  it('le verrou optimiste incrémente la version à chaque modification', async () => {
    const r = await rawBook(null, '2036-03-01', '2036-03-03');
    const upd = (v: number) => as((tx) => tx.query(`UPDATE reservations SET internal_notes = 'n' WHERE id = $1 AND version = $2`, [r.reservationId, v]));
    expect((await upd(1)).rowCount).toBe(1);
    expect((await upd(1)).rowCount).toBe(0); // version périmée : conflit détecté, rien n'est écrasé
    expect((await upd(2)).rowCount).toBe(1);
  });
});

describe('statut d\'affichage d\'une chambre : dérivé, jamais désynchronisé', () => {
  const status = async (roomId: string) => (await as((tx) => tx.query('SELECT display_status FROM room_status_today WHERE room_id = $1', [roomId]))).rows[0].display_status as string;
  const today = async () => (await db.admin.query(`SELECT (now() AT TIME ZONE 'Indian/Antananarivo')::date::text AS d`)).rows[0].d as string;
  const plusDays = async (n: number) => (await db.admin.query(`SELECT ((now() AT TIME ZONE 'Indian/Antananarivo')::date + $1::int)::text AS d`, [n])).rows[0].d as string;

  it('suit les séjours, le ménage et les blocs sans synchronisation manuelle', async () => {
    const hotel = await registerHotel(db, { plan: 'starter' });
    const { categoryId, roomIds } = await seedRooms(db, hotel, 2);
    const g = await seedGuest(db, hotel);
    const run = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: hotel.hotelId, userId: hotel.userId }, fn, ROLE);
    const st = async (id: string) => (await run((tx) => tx.query('SELECT display_status FROM room_status_today WHERE room_id = $1', [id]))).rows[0].display_status as string;
    const room = roomIds[0]!;

    expect(await st(room)).toBe('available');

    const t = await today();
    const booking = await bookRoom(db, hotel, { guestId: g, categoryId, roomId: room, checkIn: t, checkOut: await plusDays(2) });
    expect(await st(room)).toBe('reserved');

    await run((tx) => tx.query(`UPDATE reservation_rooms SET status = 'checked_in', actual_check_in = now() WHERE id = $1`, [booking.reservationRoomId]));
    expect(await st(room)).toBe('occupied');

    await run((tx) => tx.query(`UPDATE reservation_rooms SET status = 'checked_out', actual_check_out = now() WHERE id = $1`, [booking.reservationRoomId]));
    await run((tx) => tx.query(`UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = $1`, [room]));
    expect(await st(room)).toBe('to_clean');
    await run((tx) => tx.query(`UPDATE rooms SET housekeeping_status = 'cleaning' WHERE id = $1`, [room]));
    expect(await st(room)).toBe('cleaning');
    await run((tx) => tx.query(`UPDATE rooms SET housekeeping_status = 'inspected' WHERE id = $1`, [room]));
    expect(await st(room)).toBe('available');

    await run((tx) => tx.query(`INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, NULL, 'maintenance')`, [hotel.hotelId, room, t]));
    expect(await st(room)).toBe('maintenance');
    // un bloc futur ne change rien aujourd'hui
    const [d10, d12] = [await plusDays(10), await plusDays(12)];
    await run((tx) => tx.query(`INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, $4, 'out_of_service')`, [hotel.hotelId, roomIds[1], d10, d12]));
    expect(await st(roomIds[1]!)).toBe('available');
  });
});

describe('fuseau horaire de l\'établissement', () => {
  it('refuse un identifiant de fuseau inexistant (dont « Africa/Antananarivo », invalide) et accepte celui de Madagascar', async () => {
    const hotel = await registerHotel(db, { plan: 'starter' });
    const setTz = (tz: string) => withTenant(db.app, { hotelId: hotel.hotelId }, (tx) => tx.query('UPDATE hotel_settings SET timezone = $1', [tz]), ROLE);
    const bad = await sqlState(setTz('Africa/Antananarivo'));
    expect(bad.code).toBe('HM001');
    expect(bad.message).toBe('invalid_timezone');
    expect((await sqlState(setTz('Mars/Olympus'))).code).toBe('HM001');
    await setTz('Indian/Antananarivo');
    await setTz('Europe/Paris');
    const { rows } = await withTenant(db.app, { hotelId: hotel.hotelId }, (tx) => tx.query('SELECT timezone FROM hotel_settings'), ROLE);
    expect(rows[0].timezone).toBe('Europe/Paris');
  });

  it('la valeur par défaut est valide', async () => {
    const { rows } = await db.admin.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'hotel_settings' AND column_name = 'timezone'`);
    expect(rows[0].column_default).toContain('Indian/Antananarivo');
  });
});
