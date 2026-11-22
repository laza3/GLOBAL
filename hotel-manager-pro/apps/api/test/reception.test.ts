import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const TODAY = () => todayIn('Indian/Antananarivo');
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; r101: string; r102: string; r103: string; guest: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
  const mk = async (n: string) => (await h.client.post('/api/v1/rooms', { categoryId: cat, number: n, capacity: 2 })).body.id as string;
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
  return { h, cat, r101: await mk('101'), r102: await mk('102'), r103: await mk('103'), guest };
}
/** Séjour arrivant aujourd'hui (par défaut 3 nuits, 300 000 Ar). */
async function arrival(s: Setup, over: Record<string, unknown> = {}, rooms?: Array<Record<string, unknown>>) {
  const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: rooms ?? [{ categoryId: s.cat, checkIn: TODAY(), checkOut: addDays(TODAY(), 3), adults: 2 }], ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.body.id]);
  return { id: res.body.id as string, folio: f.id as string };
}
const checkIn = (c: Client, reservationId: string, extra: Record<string, unknown> = {}) => c.post('/api/v1/reception/check-in', { reservationId, ...extra });
const checkOut = (c: Client, reservationId: string, extra: Record<string, unknown> = {}) => c.post('/api/v1/reception/check-out', { reservationId, ...extra });
const pay = (c: Client, folio: string, amount: number) => c.post(`/api/v1/folios/${folio}/payments`, { methodCode: 'cash', amount, currency: 'MGA' });
const roomStatus = async (s: Setup, roomId: string) => (await s.h.client.get('/api/v1/rooms')).body.rooms.find((r: any) => r.id === roomId).displayStatus;

describe('journée à la réception', () => {
  it('arrivées, départs, clients en séjour, avec leurs compteurs', async () => {
    const s = await setup();
    const a = await arrival(s);
    await arrival(s, {}, [{ categoryId: s.cat, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }]);
    let o = (await s.h.client.get('/api/v1/reception/overview')).body;
    expect(o.date).toBe(TODAY());
    expect(o.counts).toMatchObject({ arrivals: 1, arrivalsDone: 0, departures: 0, inHouse: 0, overdue: 0 });
    expect(o.arrivals[0]).toMatchObject({ reference: expect.stringMatching(/^RES-/), guestName: 'Hanitra Rakoto', roomNumber: '101', status: 'confirmed', balanceDue: 300000, housekeepingStatus: 'clean', checkIn: TODAY() });
    expect((await s.h.client.get(`/api/v1/reception/overview?date=${addDays(TODAY(), 1)}`)).body.counts.arrivals).toBe(1);
    await checkIn(s.h.client, a.id);
    o = (await s.h.client.get('/api/v1/reception/overview')).body;
    expect(o.counts).toMatchObject({ arrivals: 1, arrivalsDone: 1, inHouse: 1 });
    expect(o.inHouse[0].status).toBe('checked_in');
    const dep = (await s.h.client.get(`/api/v1/reception/overview?date=${addDays(TODAY(), 3)}`)).body;
    expect(dep.counts.departures).toBe(1);
    expect(dep.departures[0].roomNumber).toBe('101');
  });
});

describe('arrivée', () => {
  it('seulement à partir du jour d\'arrivée, réservation ferme ; chambre à nettoyer refusée sauf confirmation ; une seule fois', async () => {
    const s = await setup();
    const future = await arrival(s, {}, [{ categoryId: s.cat, checkIn: addDays(TODAY(), 2), checkOut: addDays(TODAY(), 4), adults: 1 }]);
    expect(code(await checkIn(s.h.client, future.id))).toBe('checkin_too_early');
    const opt = await arrival(s, { status: 'tentative', tentativeExpiresAt: new Date(Date.now() + 3600_000).toISOString() }, [{ categoryId: s.cat, roomId: s.r102, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 }]);
    expect(code(await checkIn(s.h.client, opt.id))).toBe('invalid_status_transition'); // une option se confirme d'abord
    const a = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 2), adults: 2 }]);
    await q(t, "UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = $1", [s.r101]);
    const blocked = await checkIn(s.h.client, a.id);
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('room_not_ready');
    expect(blocked.body.error.details).toEqual({ rooms: ['101'] });
    const forced = await checkIn(s.h.client, a.id, { force: true });
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(forced.body).toMatchObject({ status: 'checked_in', forced: true });
    expect(await roomStatus(s, s.r101)).toBe('occupied');
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(d).toMatchObject({ status: 'checked_in', actions: { cancel: false, noShow: false } });
    expect(d.rooms[0].actualCheckIn).toBeTruthy();
    expect(code(await checkIn(s.h.client, a.id))).toBe('invalid_status_transition');
    expect(d.history.map((h: any) => h.action)).toContain('reception.checked_in');
    // l'arrivée confirmée d'une autre réservation sur une chambre propre passe sans confirmation
    const b = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r103, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 }]);
    expect((await checkIn(s.h.client, b.id)).body.forced).toBe(false);
  });

  it('réservation de plusieurs chambres : une chambre à la fois ou toutes', async () => {
    const s = await setup();
    const a = await arrival(s, {}, [
      { categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 },
      { categoryId: s.cat, roomId: s.r102, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 },
    ]);
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    const one = await s.h.client.post('/api/v1/reception/check-in', { lineIds: [d.rooms[0].id] });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.checkedIn).toHaveLength(1);
    expect((await s.h.client.get(`/api/v1/reservations/${a.id}`)).body.status).toBe('checked_in');
    const rest = await checkIn(s.h.client, a.id);
    expect(rest.body.checkedIn).toHaveLength(1);
    expect((await s.h.client.post('/api/v1/reception/check-in', {})).status).toBe(422);
  });
});

describe('départ', () => {
  it('refusé tant qu\'il reste un solde ; accepté avec confirmation (tracé) ; soldé : note clôturée et chambre à nettoyer', async () => {
    const s = await setup();
    const a = await arrival(s);
    await checkIn(s.h.client, a.id);
    const refused = await checkOut(s.h.client, a.id);
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('balance_outstanding');
    expect(refused.body.error.details).toEqual({ due: 300000, currency: 'MGA' });
    await pay(s.h.client, a.folio, 300000);
    const ok = await checkOut(s.h.client, a.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'checked_out', unpaid: 0, folioClosed: true });
    expect(await roomStatus(s, s.r101)).toBe('to_clean');
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(d).toMatchObject({ status: 'checked_out', actions: { edit: false, cancel: false } });
    expect(d.rooms[0].actualCheckOut).toBeTruthy();
    expect((await s.h.client.get(`/api/v1/folios/${a.folio}`)).body.status).toBe('closed');
    expect((await s.h.client.post(`/api/v1/folios/${a.folio}/charges`, { kind: 'service', description: 'Tardif', unitAmount: 1000 })).status).toBe(409);
    expect(code(await checkOut(s.h.client, a.id))).toBe('invalid_status_transition');
    // avec solde impayé : confirmation explicite, tracée, la note reste ouverte pour encaisser plus tard
    const b = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r102, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 }]);
    await checkIn(s.h.client, b.id);
    const unpaid = await checkOut(s.h.client, b.id, { allowUnpaid: true });
    expect(unpaid.body).toMatchObject({ unpaid: 100000, folioClosed: false });
    expect((await s.h.client.get(`/api/v1/folios/${b.folio}`)).body.status).toBe('open');
    expect((await s.h.client.get(`/api/v1/reservations/${b.id}`)).body.history.map((h: any) => h.action)).toContain('reception.checked_out_unpaid');
    expect((await pay(s.h.client, b.folio, 100000)).status).toBe(201);
  });

  it('plusieurs chambres : le solde ne se contrôle qu\'au dernier départ', async () => {
    const s = await setup();
    const a = await arrival(s, {}, [
      { categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 },
      { categoryId: s.cat, roomId: s.r102, checkIn: TODAY(), checkOut: addDays(TODAY(), 1), adults: 1 },
    ]);
    await checkIn(s.h.client, a.id);
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    const first = await s.h.client.post('/api/v1/reception/check-out', { lineIds: [d.rooms[0].id] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.status).toBe('checked_in'); // l'autre chambre est encore occupée
    expect(first.body.folioClosed).toBe(false);
    expect(code(await s.h.client.post('/api/v1/reception/check-out', { lineIds: [d.rooms[1].id] }))).toBe('balance_outstanding');
    await pay(s.h.client, a.folio, 200000);
    expect((await s.h.client.post('/api/v1/reception/check-out', { lineIds: [d.rooms[1].id] })).body).toMatchObject({ status: 'checked_out', folioClosed: true });
  });

  it('départ anticipé : les nuits non occupées sont retirées de la réservation ; refusé si déjà facturée', async () => {
    const s = await setup();
    const a = await arrival(s);
    const d0 = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    // le client est arrivé hier : on recule l'arrivée (simulation d'un séjour déjà entamé)
    await q(t, "UPDATE reservation_rooms SET check_in = check_in - 1 WHERE reservation_id = $1", [a.id]);
    await q(t, "INSERT INTO reservation_room_nights (hotel_id, reservation_room_id, night, rate) VALUES ($1, $2, $3, 100000)", [s.h.hotelId, d0.rooms[0].id, addDays(TODAY(), -1)]);
    await q(t, "UPDATE reservations SET subtotal_amount = 400000, total_amount = 400000 WHERE id = $1", [a.id]);
    await checkIn(s.h.client, a.id);
    await pay(s.h.client, a.folio, 100000);
    const out = await checkOut(s.h.client, a.id, { shorten: true });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ status: 'checked_out', unpaid: 0 });
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(d.rooms[0]).toMatchObject({ checkOut: TODAY(), nights: 1 });
    expect(d.total).toBe(100000);
    // déjà facturée : il faut d'abord un avoir
    const b = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r102, checkIn: TODAY(), checkOut: addDays(TODAY(), 3), adults: 1 }]);
    const db = (await s.h.client.get(`/api/v1/reservations/${b.id}`)).body;
    await q(t, "UPDATE reservation_rooms SET check_in = check_in - 1 WHERE reservation_id = $1", [b.id]);
    await q(t, "INSERT INTO reservation_room_nights (hotel_id, reservation_room_id, night, rate) VALUES ($1, $2, $3, 100000)", [s.h.hotelId, db.rooms[0].id, addDays(TODAY(), -1)]);
    await q(t, "UPDATE reservations SET subtotal_amount = 400000, total_amount = 400000 WHERE id = $1", [b.id]);
    await q(t, "UPDATE folio_charges SET amount = 400000, unit_amount = 400000 WHERE source_ref = $1", [b.id]);
    await checkIn(s.h.client, b.id);
    expect((await s.h.client.post(`/api/v1/folios/${b.folio}/invoices`, {})).status).toBe(201);
    expect(code(await checkOut(s.h.client, b.id, { shorten: true, allowUnpaid: true }))).toBe('reservation_invoiced');
    expect((await s.h.client.get(`/api/v1/reservations/${b.id}`)).body.status).toBe('checked_in'); // rien n'a changé
  });
});

describe('changement de chambre', () => {
  it('le jour de l\'arrivée : simple changement ; en cours de séjour : le séjour est scindé, les nuits à venir gardent leur prix', async () => {
    const s = await setup();
    const a = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 3), adults: 2 }]);
    await checkIn(s.h.client, a.id);
    const d = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    const same = await s.h.client.post('/api/v1/reception/change-room', { lineId: d.rooms[0].id, roomId: s.r101 });
    expect(code(same)).toBe('room_change_same');
    const moved = await s.h.client.post('/api/v1/reception/change-room', { lineId: d.rooms[0].id, roomId: s.r102, reason: 'Bruit' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ from: '101', to: '102' });
    let r = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]).toMatchObject({ roomNumber: '102', status: 'checked_in' });
    expect(await roomStatus(s, s.r101)).toBe('to_clean');
    // en cours de séjour : on recule l'arrivée d'un jour pour avoir une nuit déjà passée
    await q(t, "UPDATE reservation_rooms SET check_in = check_in - 1 WHERE reservation_id = $1", [a.id]);
    await q(t, "INSERT INTO reservation_room_nights (hotel_id, reservation_room_id, night, rate) VALUES ($1, $2, $3, 90000)", [s.h.hotelId, d.rooms[0].id, addDays(TODAY(), -1)]);
    const split = await s.h.client.post('/api/v1/reception/change-room', { lineId: d.rooms[0].id, roomId: s.r103 });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    r = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(r.rooms).toHaveLength(2);
    const old = r.rooms.find((x: any) => x.roomNumber === '102');
    const next = r.rooms.find((x: any) => x.roomNumber === '103');
    expect(old).toMatchObject({ status: 'checked_out', checkOut: TODAY(), nights: 1 });
    expect(old.nightly.map((n: any) => n.rate)).toEqual([90000]); // la nuit passée garde son prix
    expect(next).toMatchObject({ status: 'checked_in', checkIn: TODAY(), checkOut: addDays(TODAY(), 3), nights: 3 });
    expect(next.nightly.map((n: any) => n.rate)).toEqual([100000, 100000, 100000]);
    expect(r.status).toBe('checked_in');
    expect(await roomStatus(s, s.r102)).toBe('to_clean');
    expect(await roomStatus(s, s.r103)).toBe('occupied');
    // la chambre quittée est de nouveau vendable, la nouvelle ne l'est plus
    expect((await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r102, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }] })).status).toBe(201);
    expect(code(await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r103, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }] }))).toBe('room_not_available');
  });

  it('refuse une chambre occupée, trop petite, ou un séjour qui n\'est pas en cours', async () => {
    const s = await setup();
    const a = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 2), adults: 2 }]);
    const b = await arrival(s, {}, [{ categoryId: s.cat, roomId: s.r102, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 3), adults: 1 }]);
    const da = (await s.h.client.get(`/api/v1/reservations/${a.id}`)).body;
    expect(code(await s.h.client.post('/api/v1/reception/change-room', { lineId: da.rooms[0].id, roomId: s.r103 }))).toBe('invalid_status_transition'); // pas encore arrivé
    await checkIn(s.h.client, a.id);
    expect(code(await s.h.client.post('/api/v1/reception/change-room', { lineId: da.rooms[0].id, roomId: s.r102 }))).toBe('room_not_available');
    void b;
    expect((await s.h.client.post('/api/v1/reception/change-room', { lineId: da.rooms[0].id, roomId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });
});

describe('droits et isolation', () => {
  it('la réception fait tout ; le housekeeping consulte sans enregistrer ; un autre établissement ne voit rien', async () => {
    const s = await setup();
    const a = await arrival(s);
    const hk = await addStaff(t, s.h.hotelId, 'hk_manager');
    expect((await hk.client.get('/api/v1/reception/overview')).status).toBe(200);
    expect((await checkIn(hk.client, a.id)).status).toBe(403);
    const acc = await addStaff(t, s.h.hotelId, 'accountant');
    expect((await checkOut(acc.client, a.id)).status).toBe(403);
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    expect((await checkIn(reception.client, a.id)).status).toBe(200);
    const other = await setup();
    expect((await checkIn(other.h.client, a.id)).status).toBe(404);
    expect((await other.h.client.get('/api/v1/reception/overview')).body.counts.arrivals).toBe(0);
    expect((await new Client(t).get('/api/v1/reception/overview')).status).toBe(401);
  });
});
