import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

/** 2030-03-04 est un lundi : les nuits des 8 et 9 mars sont des nuits de week-end (vendredi, samedi). */
const D = (n: number) => addDays('2030-03-04', n);
const TODAY = () => todayIn('Indian/Antananarivo');

interface Setup { h: Registered; cat: string; deluxe: string; r101: string; r102: string; r201: string; guest: string }

/** Établissement prêt à réserver : 2 chambres Standard (101, 102), 1 Deluxe (201, 4 places), un client. */
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000, sortOrder: 1 })).body.id;
  const deluxe = (await h.client.post('/api/v1/rooms/categories', { code: 'DLX', name: 'Deluxe', baseRate: 200000, sortOrder: 2 })).body.id;
  const mk = async (categoryId: string, number: string, capacity: number) => (await h.client.post('/api/v1/rooms', { categoryId, number, capacity })).body.id as string;
  const r101 = await mk(cat, '101', 2);
  const r102 = await mk(cat, '102', 2);
  const r201 = await mk(deluxe, '201', 4);
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
  return { h, cat, deluxe, r101, r102, r201, guest };
}

const line = (s: Setup, over: Record<string, unknown> = {}) => ({ categoryId: s.cat, checkIn: D(0), checkOut: D(3), adults: 2, ...over });
const book = (s: Setup, over: Record<string, unknown> = {}, rooms?: Array<Record<string, unknown>>, client: Client = s.h.client, headers?: Record<string, string>) =>
  client.call('POST', '/api/v1/reservations', { guestId: s.guest, rooms: rooms ?? [line(s)], ...over }, headers);
const booked = async (s: Setup, over: Record<string, unknown> = {}, rooms?: Array<Record<string, unknown>>) => {
  const res = await book(s, over, rooms);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; reference: string; total: number; currency: string };
};
const detail = async (s: Setup, id: string) => {
  const res = await s.h.client.get(`/api/v1/reservations/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const code = (res: { body: any }) => res.body?.error?.code;

describe('création', () => {
  it('affecte la première chambre libre, fige le prix de chaque nuit, crée la note (folio) et trace l\'action', async () => {
    const s = await setup();
    const res = await booked(s, { source: 'phone', specialRequests: 'Lit bébé', depositRequired: 100000 });
    expect(res.reference).toMatch(/^RES-\d{4}-0001$/);
    expect(res).toMatchObject({ total: 300000, currency: 'MGA' });

    const d = await detail(s, res.id);
    expect(d).toMatchObject({ status: 'confirmed', source: 'phone', subtotal: 300000, discount: 0, tax: 0, total: 300000, depositRequired: 100000, amountPaid: 0, balanceDue: 300000, depositSatisfied: false, specialRequests: 'Lit bébé' });
    expect(d.guest).toMatchObject({ firstName: 'Hanitra', lastName: 'Rakoto' });
    expect(d.rooms).toHaveLength(1);
    expect(d.rooms[0]).toMatchObject({ roomId: s.r101, roomNumber: '101', status: 'confirmed', checkIn: D(0), checkOut: D(3), nights: 3, adults: 2, gross: 300000 });
    expect(d.rooms[0].nightly.map((n: any) => n.night)).toEqual([D(0), D(1), D(2)]);
    expect(d.folioId).toBeTruthy();
    expect(d.actions).toMatchObject({ edit: true, confirm: false, cancel: true, noShow: true, addRoom: true, cancelRoom: false });
    expect(d.history[0]).toMatchObject({ action: 'reservation.created' });

    // une allocation est créée automatiquement
    expect(await q(t, 'SELECT room_id FROM room_allocations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ room_id: s.r101 }]);
    // numérotation séquentielle
    expect((await booked(s, {}, [line(s, { checkIn: D(10), checkOut: D(11) })])).reference).toMatch(/-0002$/);
  });

  it('passe à la chambre suivante tant qu\'il en reste, puis refuse ; une chambre imposée déjà prise est refusée', async () => {
    const s = await setup();
    await booked(s);
    const second = await booked(s);
    expect((await detail(s, second.id)).rooms[0].roomNumber).toBe('102');
    const full = await book(s);
    expect(full.status).toBe(409);
    expect(code(full)).toBe('room_not_available');
    expect(code(await book(s, {}, [line(s, { roomId: s.r101 })]))).toBe('room_not_available');
    // aucune réservation partielle n'a été écrite par l'échec
    expect(await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ n: 2 }]);
    // le jour du départ, la chambre est de nouveau vendable (départ exclu)
    expect((await book(s, {}, [line(s, { checkIn: D(3), checkOut: D(5) })])).status).toBe(201);
    // et la veille de l'arrivée aussi
    expect((await book(s, {}, [line(s, { checkIn: D(-2), checkOut: D(0) })])).status).toBe(201);
  });

  it('plusieurs chambres : réservation de groupe, deux chambres de la même catégorie ne se marchent pas dessus', async () => {
    const s = await setup();
    const res = await booked(s, { groupName: 'Famille Rabe' }, [line(s), line(s), line(s, { categoryId: s.deluxe, adults: 3, children: 1 })]);
    const d = await detail(s, res.id);
    expect(d.groupName).toBe('Famille Rabe');
    expect(d.rooms.map((r: any) => r.roomNumber).sort()).toEqual(['101', '102', '201']);
    expect(d.total).toBe(300000 * 2 + 600000);
    // une 4e chambre Standard n'existe plus : toute la réservation est refusée et rien n'est écrit
    const before = (await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId]))[0].n;
    expect(code(await book(s, {}, [line(s, { checkIn: D(20), checkOut: D(22) }), line(s, { checkIn: D(20), checkOut: D(22) }), line(s, { checkIn: D(20), checkOut: D(22) })]))).toBe('room_not_available');
    expect((await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId]))[0].n).toBe(before);
  });

  it('valide dates, capacité, séjour minimal, catégorie, client et acompte', async () => {
    const s = await setup();
    expect(code(await book(s, {}, [line(s, { checkIn: addDays(TODAY(), -1), checkOut: addDays(TODAY(), 1) })]))).toBe('checkin_in_past');
    expect((await book(s, {}, [line(s, { checkOut: D(0) })])).status).toBe(422);
    expect((await book(s, {}, [line(s, { checkOut: addDays(D(0), 400) })])).status).toBe(422);
    expect((await book(s, {}, [line(s, { checkIn: '2030-02-30' })])).status).toBe(422);
    expect((await book(s, {}, [])).status).toBe(422);
    expect(code(await book(s, {}, [line(s, { adults: 3 })]))).toBe('capacity_exceeded');
    expect(code(await book(s, {}, [line(s, { roomId: s.r101, adults: 2, children: 1 })]))).toBe('capacity_exceeded');
    expect((await book(s, {}, [line(s, { roomId: s.r201 })])).status).toBe(422); // chambre d'une autre catégorie
    expect(code(await book(s, { guestId: '00000000-0000-4000-8000-000000000000' }))).toBe('guest_not_found');
    expect(code(await book(s, { depositRequired: 300001 }))).toBe('deposit_exceeds_total');
    expect((await book(s, { depositRequired: 300000 })).status).toBe(201);

    // séjour minimal d'une période
    await s.h.client.post('/api/v1/rooms/rates', { categoryId: s.cat, name: 'Haute saison', startsOn: D(30), endsOn: D(60), nightlyRate: 150000, weekendRate: null, minStay: 3, priority: 1, isActive: true });
    const short = await book(s, {}, [line(s, { checkIn: D(40), checkOut: D(42) })]);
    expect(code(short)).toBe('min_stay_not_met');
    expect(short.body.error.details).toEqual({ minStay: 3 });
    expect((await book(s, {}, [line(s, { checkIn: D(40), checkOut: D(43) })])).status).toBe(201);

    // catégorie désactivée
    await s.h.client.patch(`/api/v1/rooms/categories/${s.deluxe}`, { isActive: false });
    expect(code(await book(s, {}, [line(s, { categoryId: s.deluxe })]))).toBe('category_inactive');
  });

  it('prix : saison, week-end et tarif propre à la chambre ; les prix sont FIGÉS (un tarif modifié ensuite ne change pas la réservation)', async () => {
    const s = await setup();
    const rate = (await s.h.client.post('/api/v1/rooms/rates', { categoryId: s.cat, name: 'Fêtes', startsOn: D(0), endsOn: D(9), nightlyRate: 120000, weekendRate: 180000, minStay: 1, priority: 1, isActive: true })).body.id;
    // lun 4 → dim 10 mars : nuits 4,5,6,7 (semaine) + 8,9 (week-end) = 4×120000 + 2×180000
    const res = await booked(s, {}, [line(s, { checkOut: D(6) })]);
    expect(res.total).toBe(4 * 120000 + 2 * 180000);
    await s.h.client.patch(`/api/v1/rooms/rates/${rate}`, { nightlyRate: 999999 });
    await s.h.client.patch(`/api/v1/rooms/categories/${s.cat}`, { baseRate: 888888 });
    const d = await detail(s, res.id);
    expect(d.total).toBe(4 * 120000 + 2 * 180000);
    expect(d.rooms[0].nightly.map((n: any) => n.rate)).toEqual([120000, 120000, 120000, 120000, 180000, 180000]);
    // tarif propre à la chambre : la 101 a son prix ; la réservation sur la 101 l'utilise
    await s.h.client.patch(`/api/v1/rooms/${s.r102}`, { nightlyRate: 70000, version: 1 });
    expect((await booked(s, {}, [line(s, { roomId: s.r102, checkIn: D(30), checkOut: D(32) })])).total).toBe(140000);
  });

  it('taxes : incluse + taxe de séjour fixe ; total = hors taxe − remise + taxes, détail figé ; la remise est répartie sur les nuits', async () => {
    const s = await setup();
    await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, is_inclusive) VALUES ($1, 'TVA', 'percentage', 2000, true)", [s.h.hotelId]);
    await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, fixed_amount, is_inclusive) VALUES ($1, 'Taxe de séjour', 'fixed_per_person_night', 1500, false)", [s.h.hotelId]);
    const res = await booked(s, { discount: 30000 }); // 3 nuits × 100 000 TTC, remise 30 000
    const d = await detail(s, res.id);
    // TTC 300 000 → hors taxe 250 000 ; remise 30 000 TTC = 25 000 HT ; après remise 225 000 HT ; TVA incluse = 45 000
    expect(d.subtotal).toBe(250000);
    expect(d.discount).toBe(25000);
    expect(d.taxes).toEqual([
      { ruleId: expect.any(String), name: 'TVA', amount: 45000, inclusive: true },
      { ruleId: expect.any(String), name: 'Taxe de séjour', amount: 2 * 3 * 1500, inclusive: false },
    ]);
    expect(d.tax).toBe(45000 + 9000);
    expect(d.total).toBe(d.subtotal - d.discount + d.tax);
    expect(d.total).toBe(270000 + 9000); // prix TTC remisé (300 000 − 30 000) + taxe de séjour
    const [sums] = await q(t, `SELECT sum(rate)::int AS rate, sum(discount)::int AS discount FROM reservation_room_nights WHERE hotel_id = $1`, [s.h.hotelId]);
    expect(sums).toEqual({ rate: 300000, discount: 30000 });
    // modifier les règles ensuite ne réécrit pas la réservation
    await q(t, 'UPDATE tax_rules SET rate_bps = 500 WHERE hotel_id = $1 AND name = $2', [s.h.hotelId, 'TVA']);
    expect((await detail(s, res.id)).tax).toBe(54000);
  });

  it('option (tentative) : exige une échéance future, bloque la chambre, et libère la chambre une fois l\'échéance passée', async () => {
    const s = await setup();
    expect(code(await book(s, { status: 'tentative' }))).toBe('option_expiry_invalid');
    expect(code(await book(s, { status: 'tentative', tentativeExpiresAt: new Date(Date.now() - 60_000).toISOString() }))).toBe('option_expiry_invalid');
    const expires = new Date(Date.now() + 3600_000).toISOString();
    const opt = await booked(s, { status: 'tentative', tentativeExpiresAt: expires }, [line(s, { roomId: s.r101 })]);
    expect(await detail(s, opt.id)).toMatchObject({ status: 'tentative', actions: { confirm: true } });
    expect(code(await book(s, {}, [line(s, { roomId: s.r101 })]))).toBe('room_not_available');

    // l'option arrive à échéance
    await q(t, "UPDATE reservations SET tentative_expires_at = now() - interval '1 minute' WHERE id = $1", [opt.id]);
    const avail = await s.h.client.get(`/api/v1/reservations/availability?checkIn=${D(0)}&checkOut=${D(3)}`);
    expect(avail.body.categories.find((c: any) => c.id === s.cat).freeCount).toBe(2);
    const expired = await detail(s, opt.id);
    expect(expired).toMatchObject({ status: 'cancelled', cancelReason: 'Option expirée' });
    expect(expired.rooms[0].status).toBe('cancelled');
    expect(expired.history[0].action).toBe('reservation.option_expired');
    expect((await book(s, {}, [line(s, { roomId: s.r101 })])).status).toBe(201);

    // confirmer une option supprime son échéance
    const opt2 = await booked(s, { status: 'tentative', tentativeExpiresAt: expires }, [line(s, { checkIn: D(20), checkOut: D(22) })]);
    const confirmed = await s.h.client.post(`/api/v1/reservations/${opt2.id}/confirm`);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', tentativeExpiresAt: null });
    // la tâche planifiée de la plateforme libère aussi les options échues
    const opt3 = await booked(s, { status: 'tentative', tentativeExpiresAt: expires }, [line(s, { checkIn: D(40), checkOut: D(41) })]);
    await q(t, "UPDATE reservations SET tentative_expires_at = now() - interval '1 second' WHERE id = $1", [opt3.id]);
    expect((await q(t, 'SELECT expire_all_tentatives() AS n'))[0].n).toBe(1);
    expect((await q(t, 'SELECT status FROM reservations WHERE id = $1', [opt3.id]))[0].status).toBe('cancelled');
  });
});

describe('anti double réservation', () => {
  it('réservations simultanées sur UNE même chambre : une seule réussit, toutes les autres reçoivent room_not_available', async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 10 }, () => book(s, {}, [line(s, { roomId: s.r101 })])));
    const ok = results.filter((r) => r.status === 201);
    const ko = results.filter((r) => r.status !== 201);
    expect(ok).toHaveLength(1);
    expect(ko.every((r) => r.status === 409 && code(r) === 'room_not_available')).toBe(true);
    expect(await q(t, "SELECT count(*)::int AS n FROM reservation_rooms WHERE hotel_id = $1 AND status = 'confirmed'", [s.h.hotelId])).toEqual([{ n: 1 }]);
    expect(await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ n: 1 }]);
  });

  it('affectation automatique simultanée : autant de succès que de chambres libres, chacune attribuée une seule fois', async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => book(s)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2); // 101 et 102
    expect(results.filter((r) => r.status !== 201).every((r) => code(r) === 'room_not_available')).toBe(true);
    const rooms = await q(t, "SELECT room_id FROM reservation_rooms WHERE hotel_id = $1 AND status = 'confirmed'", [s.h.hotelId]);
    expect(new Set(rooms.map((r) => r.room_id))).toEqual(new Set([s.r101, s.r102]));
  });

  it('des périodes qui se chevauchent partiellement sont refusées sur la même chambre, y compris pendant un déplacement de dates', async () => {
    const s = await setup();
    await booked(s, {}, [line(s, { roomId: s.r101, checkIn: D(0), checkOut: D(3) })]);
    for (const [i, o] of [[-1, 1], [2, 5], [1, 2], [-2, 6]] as const) {
      expect(code(await book(s, {}, [line(s, { roomId: s.r101, checkIn: D(i), checkOut: D(o) })])), `${i}→${o}`).toBe('room_not_available');
    }
    const other = await booked(s, {}, [line(s, { roomId: s.r101, checkIn: D(3), checkOut: D(5) })]);
    const d = await detail(s, other.id);
    // allonger le second séjour vers l'arrière pour empiéter sur le premier est refusé, et rien ne change
    const bad = await s.h.client.patch(`/api/v1/reservations/${other.id}/rooms/${d.rooms[0].id}`, { checkIn: D(2), version: d.version });
    expect(code(bad)).toBe('room_not_available');
    expect((await detail(s, other.id)).rooms[0]).toMatchObject({ checkIn: D(3), checkOut: D(5) });
  });

  it('un blocage de chambre (maintenance) empêche la réservation, et la chambre bloquée n\'est pas proposée', async () => {
    const s = await setup();
    await q(t, "INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, $4, 'maintenance')", [s.h.hotelId, s.r101, D(0), D(2)]);
    expect(code(await book(s, {}, [line(s, { roomId: s.r101 })]))).toBe('room_not_available');
    const res = await booked(s);
    expect((await detail(s, res.id)).rooms[0].roomNumber).toBe('102');
    // blocage sans date de fin
    await q(t, "INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, NULL, 'out_of_service')", [s.h.hotelId, s.r201, D(0)]);
    expect(code(await book(s, {}, [line(s, { categoryId: s.deluxe, checkIn: addDays(D(0), 500), checkOut: addDays(D(0), 502) })]))).toBe('room_not_available');
  });
});

describe('rejeu sécurisé (Idempotency-Key)', () => {
  it('même clé + même contenu = une seule réservation, même réponse ; même clé + autre contenu = refus', async () => {
    const s = await setup();
    const h = { 'idempotency-key': 'abc-123' };
    const a = await book(s, {}, undefined, s.h.client, h);
    const b = await book(s, {}, undefined, s.h.client, h);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ n: 1 }]);
    const other = await book(s, {}, [line(s, { checkIn: D(10), checkOut: D(12) })], s.h.client, h);
    expect(other.status).toBe(422);
    expect(code(other)).toBe('idempotency_key_reused');
    // deux envois simultanés : toujours une seule réservation
    const k = { 'idempotency-key': 'double-clic' };
    const both = await Promise.all([book(s, {}, [line(s, { checkIn: D(20), checkOut: D(22) })], s.h.client, k), book(s, {}, [line(s, { checkIn: D(20), checkOut: D(22) })], s.h.client, k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both[0]!.body.id).toBe(both[1]!.body.id);
    expect(await q(t, 'SELECT count(*)::int AS n FROM reservations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ n: 2 }]);
    // la clé d'un établissement n'a aucun effet sur un autre
    const s2 = await setup();
    const c = await book(s2, {}, undefined, s2.h.client, h);
    expect(c.status).toBe(201);
    expect(c.body.id).not.toBe(a.body.id);
  });
});

describe('modification', () => {
  it('en-tête : champs en liste blanche, contrôle de version, acompte plafonné au total', async () => {
    const s = await setup();
    const res = await booked(s);
    const d = await detail(s, res.id);
    const ok = await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: d.version, source: 'website', internalNotes: 'VIP', specialRequests: null, depositRequired: 150000, groupName: 'Mariage' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ source: 'website', internalNotes: 'VIP', specialRequests: null, depositRequired: 150000, groupName: 'Mariage' });
    // version périmée : refus
    expect(code(await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: d.version, source: 'phone' }))).toBe('version_conflict');
    // acompte > total
    expect(code(await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: ok.body.version, depositRequired: 999999999 }))).toBe('deposit_exceeds_total');
    // champs hors liste blanche ignorés (le statut ne se change pas par ce chemin)
    const sneaky = await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: ok.body.version, status: 'checked_out', totalAmount: 1, source: 'agency' });
    expect(sneaky.status).toBe(200);
    expect(sneaky.body).toMatchObject({ status: 'confirmed', total: 300000, source: 'agency' });
    expect((await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: sneaky.body.version })).status).toBe(422);
  });

  it('remise : recalcul exact du total', async () => {
    const s = await setup();
    const res = await booked(s);
    const d = await detail(s, res.id);
    const p = await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: d.version, discount: 50000 });
    expect(p.body).toMatchObject({ subtotal: 300000, discount: 50000, total: 250000 });
    const [sum] = await q(t, 'SELECT sum(discount)::int AS d FROM reservation_room_nights WHERE hotel_id = $1', [s.h.hotelId]);
    expect(sum.d).toBe(50000);
    const p2 = await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: p.body.version, discount: 0 });
    expect(p2.body.total).toBe(300000);
  });

  it('dates : les nuits conservées gardent leur prix figé, seules les nuits ajoutées prennent le tarif actuel ; le total suit', async () => {
    const s = await setup();
    const res = await booked(s); // 3 nuits à 100 000
    await s.h.client.patch(`/api/v1/rooms/categories/${s.cat}`, { baseRate: 150000 });
    let d = await detail(s, res.id);
    const lineId = d.rooms[0].id;
    // prolongation de 2 nuits
    const ext = await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { checkOut: D(5), version: d.version });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    expect(ext.body.rooms[0].nightly.map((n: any) => n.rate)).toEqual([100000, 100000, 100000, 150000, 150000]);
    expect(ext.body.total).toBe(300000 + 300000);
    // raccourcir par le début : on perd la 1re nuit, les autres gardent leur prix
    const shorten = await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { checkIn: D(1), version: ext.body.version });
    expect(shorten.body.rooms[0]).toMatchObject({ checkIn: D(1), checkOut: D(5), nights: 4 });
    expect(shorten.body.rooms[0].nightly.map((n: any) => n.rate)).toEqual([100000, 100000, 150000, 150000]);
    expect(shorten.body.total).toBe(500000);
    // un acompte supérieur au nouveau total est ramené au total
    d = shorten.body;
    const dep = await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: d.version, depositRequired: 500000 });
    const small = await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { checkOut: D(2), version: dep.body.version });
    expect(small.body).toMatchObject({ total: 100000, depositRequired: 100000 });
    // un nombre de personnes trop élevé pour la chambre est refusé
    expect(code(await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { adults: 3, version: small.body.version }))).toBe('capacity_exceeded');
    // départ avant l'arrivée
    expect((await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { checkOut: D(0), version: small.body.version })).status).toBe(422);
    // aucune modification : réponse correcte, pas de bruit dans l'historique
    const none = await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${lineId}`, { checkOut: D(2), version: small.body.version });
    expect(none.status).toBe(200);
    expect(none.body.history.filter((h: any) => h.action === 'reservation.room_updated').length).toBe(small.body.history.filter((h: any) => h.action === 'reservation.room_updated').length);
  });

  it('changer de chambre : même catégorie garde les prix ; catégorie différente rechiffre tout ; chambre occupée refusée', async () => {
    const s = await setup();
    const a = await booked(s, {}, [line(s, { roomId: s.r101 })]);
    await booked(s, {}, [line(s, { roomId: s.r102 })]);
    const d = await detail(s, a.id);
    // la 102 est prise : refus, rien n'a bougé
    expect(code(await s.h.client.patch(`/api/v1/reservations/${a.id}/rooms/${d.rooms[0].id}`, { roomId: s.r102, version: d.version }))).toBe('room_not_available');
    expect((await detail(s, a.id)).rooms[0].roomNumber).toBe('101');
    // vers la Deluxe 201 : catégorie différente, tout est rechiffré (200 000 × 3)
    const moved = await s.h.client.patch(`/api/v1/reservations/${a.id}/rooms/${d.rooms[0].id}`, { roomId: s.r201, version: d.version });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.rooms[0]).toMatchObject({ roomNumber: '201', categoryName: 'Deluxe', gross: 600000 });
    expect(moved.body.total).toBe(600000);
    // la 101 est de nouveau libre
    expect((await book(s, {}, [line(s, { roomId: s.r101 })])).status).toBe(201);
  });

  it('ajouter et annuler une chambre ; la dernière chambre ne peut être annulée seule', async () => {
    const s = await setup();
    const res = await booked(s);
    let d = await detail(s, res.id);
    const added = await s.h.client.post(`/api/v1/reservations/${res.id}/rooms`, { ...line(s, { categoryId: s.deluxe, adults: 3 }), version: d.version });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.rooms).toHaveLength(2);
    expect(added.body.total).toBe(300000 + 600000);
    expect(added.body.actions.cancelRoom).toBe(true);
    const deluxeLine = added.body.rooms.find((r: any) => r.roomNumber === '201');
    const cancelled = await s.h.client.post(`/api/v1/reservations/${res.id}/rooms/${deluxeLine.id}/cancel`, { version: added.body.version });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.total).toBe(300000);
    expect(cancelled.body.rooms.find((r: any) => r.id === deluxeLine.id).status).toBe('cancelled');
    expect(cancelled.body.actions.cancelRoom).toBe(false);
    const remaining = cancelled.body.rooms.find((r: any) => r.status === 'confirmed');
    expect(code(await s.h.client.post(`/api/v1/reservations/${res.id}/rooms/${remaining.id}/cancel`, { version: cancelled.body.version }))).toBe('last_room_line');
    // la Deluxe libérée est de nouveau réservable
    expect((await book(s, {}, [line(s, { categoryId: s.deluxe })])).status).toBe(201);
    d = await detail(s, res.id);
    expect(d.status).toBe('confirmed');
  });
});

describe('statuts', () => {
  it('en attente → confirmée ; annuler libère la chambre ; on n\'annule pas deux fois ; on ne modifie plus une réservation annulée', async () => {
    const s = await setup();
    const res = await booked(s, { status: 'pending' }, [line(s, { roomId: s.r101 })]);
    expect(await detail(s, res.id)).toMatchObject({ status: 'pending', actions: { confirm: true } });
    expect((await s.h.client.post(`/api/v1/reservations/${res.id}/confirm`)).body.status).toBe('confirmed');
    expect(code(await s.h.client.post(`/api/v1/reservations/${res.id}/confirm`))).toBe('invalid_status_transition');
    expect((await s.h.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'x' })).status).toBe(422);
    const cancelled = await s.h.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'Client malade' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Client malade', total: 300000 });
    expect(cancelled.body.rooms[0].status).toBe('cancelled');
    expect(cancelled.body.actions).toMatchObject({ edit: false, cancel: false, confirm: false });
    expect(code(await s.h.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'encore' }))).toBe('invalid_status_transition');
    expect(code(await s.h.client.patch(`/api/v1/reservations/${res.id}`, { version: cancelled.body.version, source: 'phone' }))).toBe('reservation_not_editable');
    expect(await q(t, 'SELECT count(*)::int AS n FROM room_allocations WHERE hotel_id = $1', [s.h.hotelId])).toEqual([{ n: 0 }]);
    expect((await book(s, {}, [line(s, { roomId: s.r101 })])).status).toBe(201);
    expect(cancelled.body.history.map((h: any) => h.action)).toEqual(['reservation.cancelled', 'reservation.confirmed', 'reservation.created']);
  });

  it('« non présenté » : refusé pour une arrivée à venir, accepté le jour même, libère la chambre', async () => {
    const s = await setup();
    const future = await booked(s);
    expect(code(await s.h.client.post(`/api/v1/reservations/${future.id}/no-show`))).toBe('no_show_too_early');
    const today = await booked(s, {}, [line(s, { checkIn: TODAY(), checkOut: addDays(TODAY(), 2), roomId: s.r102 })]);
    const ns = await s.h.client.post(`/api/v1/reservations/${today.id}/no-show`);
    expect(ns.body).toMatchObject({ status: 'no_show' });
    expect(ns.body.rooms[0].status).toBe('no_show');
    expect(code(await s.h.client.post(`/api/v1/reservations/${today.id}/no-show`))).toBe('invalid_status_transition');
    expect((await book(s, {}, [line(s, { checkIn: TODAY(), checkOut: addDays(TODAY(), 2), roomId: s.r102 })])).status).toBe(201);
  });

  it('une réservation en cours de séjour ne peut être annulée ni confirmée ; seul son départ se modifie', async () => {
    const s = await setup();
    const res = await booked(s, {}, [line(s, { checkIn: TODAY(), checkOut: addDays(TODAY(), 3), roomId: s.r101 })]);
    // la réception n'existe pas encore côté API : on simule l'arrivée comme le fera le module Réception
    await q(t, "UPDATE reservation_rooms SET status = 'checked_in', actual_check_in = now() WHERE reservation_id = $1", [res.id]);
    await q(t, "UPDATE reservations SET status = 'checked_in' WHERE id = $1", [res.id]);
    const d = await detail(s, res.id);
    expect(d.actions).toMatchObject({ edit: true, cancel: false, noShow: false, confirm: false, addRoom: false });
    expect(code(await s.h.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'test' }))).toBe('invalid_status_transition');
    expect(code(await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${d.rooms[0].id}`, { adults: 1, version: d.version }))).toBe('reservation_not_editable');
    const ext = await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${d.rooms[0].id}`, { checkOut: addDays(TODAY(), 5), version: d.version });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    expect(ext.body.rooms[0].nights).toBe(5);
    // départ avant aujourd'hui : refusé
    expect((await s.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${d.rooms[0].id}`, { checkOut: TODAY(), version: ext.body.version })).status).toBe(422);
  });
});

describe('disponibilité', () => {
  it('chambres libres par catégorie avec prix du séjour ; tient compte des capacités, des séjours, de l\'archivage et de la ligne en cours de modification', async () => {
    const s = await setup();
    const url = (extra = '') => `/api/v1/reservations/availability?checkIn=${D(0)}&checkOut=${D(3)}${extra}`;
    let a = (await s.h.client.get(url())).body;
    expect(a).toMatchObject({ nights: 3, adults: 1, children: 0 });
    expect(a.categories.map((c: any) => [c.name, c.freeCount])).toEqual([['Standard', 2], ['Deluxe', 1]]);
    expect(a.categories[0]).toMatchObject({ subtotal: 300000, averageRate: 100000, minStay: 1, minStayRespected: true });
    expect(a.categories[0].rooms.map((r: any) => r.number)).toEqual(['101', '102']);
    // capacité : 3 adultes ne rentrent que dans la Deluxe
    a = (await s.h.client.get(url('&adults=3'))).body;
    expect(a.categories.map((c: any) => [c.name, c.freeCount])).toEqual([['Standard', 0], ['Deluxe', 1]]);
    // séjour existant
    const res = await booked(s, {}, [line(s, { roomId: s.r101 })]);
    a = (await s.h.client.get(url())).body;
    expect(a.categories[0].rooms.map((r: any) => r.number)).toEqual(['102']);
    const d = await detail(s, res.id);
    // en modifiant ce séjour, sa propre chambre reste proposée
    a = (await s.h.client.get(url(`&excludeLineId=${d.rooms[0].id}`))).body;
    expect(a.categories[0].rooms.map((r: any) => r.number)).toEqual(['101', '102']);
    // chambre archivée : plus proposée
    await s.h.client.post(`/api/v1/rooms/${s.r102}/archive`);
    expect((await s.h.client.get(url())).body.categories[0].freeCount).toBe(0);
    // chambre avec tarif propre : le prix proposé est celui de la chambre
    await s.h.client.post(`/api/v1/rooms/${s.r102}/restore`);
    await s.h.client.patch(`/api/v1/rooms/${s.r102}`, { nightlyRate: 80000, version: 3 });
    const withOwn = (await s.h.client.get(url())).body.categories[0].rooms.find((r: any) => r.number === '102');
    expect(withOwn.subtotal).toBe(240000);
    // dates invalides et passées
    expect((await s.h.client.get(`/api/v1/reservations/availability?checkIn=${D(3)}&checkOut=${D(0)}`)).status).toBe(422);
    expect(code(await s.h.client.get(`/api/v1/reservations/availability?checkIn=${addDays(TODAY(), -3)}&checkOut=${addDays(TODAY(), -1)}`))).toBe('checkin_in_past');
  });

  it('signale le séjour minimal non respecté', async () => {
    const s = await setup();
    await s.h.client.post('/api/v1/rooms/rates', { categoryId: s.cat, name: 'Pont', startsOn: D(0), endsOn: D(10), nightlyRate: 130000, weekendRate: null, minStay: 4, priority: 1, isActive: true });
    const a = (await s.h.client.get(`/api/v1/reservations/availability?checkIn=${D(0)}&checkOut=${D(2)}`)).body;
    expect(a.categories[0]).toMatchObject({ minStay: 4, minStayRespected: false, subtotal: 260000 });
  });
});

describe('liste et recherche', () => {
  it('filtre par statut, source, client, période ; recherche par référence, nom et numéro de chambre ; tri et pagination', async () => {
    const s = await setup();
    const g2 = (await s.h.client.post('/api/v1/guests', { firstName: 'Jean', lastName: 'Randria', email: 'jean@example.test' })).body.id;
    const a = await booked(s, { source: 'phone' }, [line(s, { roomId: s.r101 })]);
    const b = await booked(s, { guestId: g2, status: 'pending' }, [line(s, { roomId: s.r102, checkIn: D(10), checkOut: D(12) })]);
    const c = await booked(s, { guestId: g2 }, [line(s, { categoryId: s.deluxe, adults: 3, checkIn: D(20), checkOut: D(21) })]);
    await s.h.client.post(`/api/v1/reservations/${c.id}/cancel`, { reason: 'Changement de plan' });
    const ids = async (query = '') => (await s.h.client.get(`/api/v1/reservations${query}`)).body.items.map((r: any) => r.id);

    expect(await ids()).toEqual([c.id, b.id, a.id]); // plus récentes d'abord
    expect((await s.h.client.get('/api/v1/reservations')).body).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    expect(await ids('?status=pending')).toEqual([b.id]);
    expect((await ids('?status=confirmed,cancelled')).sort()).toEqual([a.id, c.id].sort());
    expect(await ids('?source=phone')).toEqual([a.id]);
    expect((await ids(`?guestId=${g2}`)).sort()).toEqual([b.id, c.id].sort());
    expect(await ids(`?q=${a.reference}`)).toEqual([a.id]);
    expect(await ids('?q=randria')).toHaveLength(2);
    expect(await ids('?q=jean randria')).toHaveLength(2);
    expect(await ids('?q=jean@example')).toHaveLength(2);
    expect(await ids('?q=102')).toEqual([b.id]);
    expect(await ids('?q=zzz')).toEqual([]);
    // période : séjours qui chevauchent [from, to]
    expect(await ids(`?from=${D(11)}&to=${D(15)}`)).toEqual([b.id]);
    expect(await ids(`?from=${D(12)}&to=${D(15)}`)).toEqual([]); // le départ du 12 est exclu
    expect((await ids(`?from=${D(2)}&to=${D(2)}`))).toEqual([a.id]);
    // tri par arrivée
    expect(await ids('?sort=arrival_asc')).toEqual([a.id, b.id, c.id]);
    expect(await ids('?sort=arrival_desc')).toEqual([c.id, b.id, a.id]);
    // pagination
    const p2 = (await s.h.client.get('/api/v1/reservations?pageSize=2&page=2')).body;
    expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(p2.items).toHaveLength(1);
    expect((await s.h.client.get('/api/v1/reservations?status=bidule')).status).toBe(422);
    // contenu d'une ligne
    const row = (await s.h.client.get(`/api/v1/reservations?q=${a.reference}`)).body.items[0];
    expect(row).toMatchObject({ reference: a.reference, status: 'confirmed', guestFirstName: 'Hanitra', checkIn: D(0), checkOut: D(3), roomsCount: 1, roomNumbers: ['101'], adults: 2, total: 300000, balanceDue: 300000, amountPaid: 0, currency: 'MGA' });
  });

  it('le solde et l\'acompte suivent les paiements confirmés de la note', async () => {
    const s = await setup();
    const res = await booked(s, { depositRequired: 100000 });
    const [folio] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.id]);
    await q(t, "INSERT INTO payments (hotel_id, folio_id, kind, method_code, amount, currency, base_amount, status) VALUES ($1, $2, 'deposit', 'cash', 120000, 'MGA', 120000, 'confirmed')", [s.h.hotelId, folio.id]);
    // un paiement en attente n'est PAS compté
    await q(t, "INSERT INTO payments (hotel_id, folio_id, kind, method_code, amount, currency, base_amount, status) VALUES ($1, $2, 'payment', 'cash', 50000, 'MGA', 50000, 'pending')", [s.h.hotelId, folio.id]);
    const d = await detail(s, res.id);
    expect(d).toMatchObject({ amountPaid: 120000, balanceDue: 180000, depositSatisfied: true });
    expect((await s.h.client.get(`/api/v1/reservations?q=${res.reference}`)).body.items[0]).toMatchObject({ amountPaid: 120000, balanceDue: 180000, depositSatisfied: true });
  });
});

describe('droits et isolation', () => {
  it('le personnel housekeeping lit mais ne crée ni ne modifie ; la réception fait tout sauf rien d\'interdit', async () => {
    const s = await setup();
    const res = await booked(s);
    const hk = await addStaff(t, s.h.hotelId, 'hk_manager');
    expect((await hk.client.get('/api/v1/reservations')).status).toBe(200);
    expect((await hk.client.get(`/api/v1/reservations/${res.id}`)).status).toBe(200);
    expect((await book(s, {}, undefined, hk.client)).status).toBe(403);
    expect((await hk.client.post(`/api/v1/reservations/${res.id}/confirm`)).status).toBe(403);
    expect((await hk.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'test' })).status).toBe(403);
    const staff = await addStaff(t, s.h.hotelId, 'hk_staff');
    expect((await staff.client.get('/api/v1/reservations')).status).toBe(403);
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    expect((await book(s, {}, [line(s, { checkIn: D(30), checkOut: D(32) })], reception.client)).status).toBe(201);
    expect((await reception.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'Demande du client' })).status).toBe(200);
    // sans connexion
    expect((await new Client(t).get('/api/v1/reservations')).status).toBe(401);
  });

  it('un autre établissement ne voit, ne modifie ni ne réutilise rien (réservation, client, chambre)', async () => {
    const a = await setup();
    const b = await setup();
    const res = await booked(a);
    const [ra] = await q(t, 'SELECT id FROM reservation_rooms WHERE reservation_id = $1', [res.id]);
    expect((await b.h.client.get(`/api/v1/reservations/${res.id}`)).status).toBe(404);
    expect((await b.h.client.post(`/api/v1/reservations/${res.id}/cancel`, { reason: 'intrusion' })).status).toBe(404);
    expect((await b.h.client.patch(`/api/v1/reservations/${res.id}`, { version: 1, source: 'phone' })).status).toBe(404);
    expect((await b.h.client.patch(`/api/v1/reservations/${res.id}/rooms/${ra.id}`, { version: 1, adults: 1 })).status).toBe(404);
    expect((await b.h.client.get('/api/v1/reservations')).body.total).toBe(0);
    // client et chambre d'un autre établissement
    expect(code(await book(b, { guestId: a.guest }))).toBe('guest_not_found');
    expect((await book(b, {}, [line(b, { categoryId: a.cat })])).status).toBeGreaterThanOrEqual(400);
    expect((await book(b, {}, [line(b, { roomId: a.r101 })])).status).toBeGreaterThanOrEqual(400);
    // chaque établissement a sa propre numérotation
    const resB = await booked(b);
    expect(resB.reference).toBe(res.reference);
  });

  it('la suppression d\'une réservation est impossible, même en SQL direct sous le rôle applicatif', async () => {
    const s = await setup();
    const res = await booked(s);
    const c = await t.tdb.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE hmp_app');
      await c.query("SELECT set_config('app.hotel_id', $1, true)", [s.h.hotelId]);
      await expect(c.query('DELETE FROM reservations WHERE id = $1', [res.id])).rejects.toThrow();
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    expect(await q(t, 'SELECT 1 FROM reservations WHERE id = $1', [res.id])).toHaveLength(1);
  });
});
