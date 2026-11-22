import { addDays } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const D = (n: number) => addDays('2030-03-04', n);
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; r101: string; r102: string; r103: string; guest: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
  const mk = async (number: string) => (await h.client.post('/api/v1/rooms', { categoryId: cat, number, capacity: 2 })).body.id as string;
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
  return { h, cat, r101: await mk('101'), r102: await mk('102'), r103: await mk('103'), guest };
}
const book = async (s: Setup, roomId: string, i: number, o: number, over: Record<string, unknown> = {}) => {
  const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId, checkIn: D(i), checkOut: D(o), adults: 2 }], ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const grid = async (s: Setup, query = '') => {
  const res = await s.h.client.get(`/api/v1/calendar?from=${D(0)}&days=10${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe('grille', () => {
  it('chambres, séjours et occupation de chaque nuit', async () => {
    const s = await setup();
    await book(s, s.r101, 0, 3);
    await book(s, s.r102, 2, 6, { status: 'pending' });
    const g = await grid(s);
    expect(g).toMatchObject({ from: D(0), to: D(10), days: 10 });
    expect(g.rooms.map((r: any) => r.number)).toEqual(['101', '102', '103']);
    expect(g.rooms[0]).toMatchObject({ categoryName: 'Standard', capacity: 2 });
    const stays = g.items.filter((i: any) => i.kind === 'stay');
    expect(stays).toHaveLength(2);
    expect(stays[0]).toMatchObject({ roomId: s.r101, startsOn: D(0), endsOn: D(3), guestName: 'Hanitra Rakoto', status: 'confirmed', balanceDue: 300000, currency: 'MGA' });
    expect(stays[1]).toMatchObject({ roomId: s.r102, status: 'pending' });
    expect(g.occupancy).toHaveLength(10);
    // nuits : 0,1 → 101 ; 2 → 101 + 102 ; 3,4,5 → 102 ; ensuite personne
    expect(g.occupancy.map((o: any) => o.occupied)).toEqual([1, 1, 2, 1, 1, 1, 0, 0, 0, 0]);
    expect(g.occupancy[0]).toMatchObject({ date: D(0), total: 3, blocked: 0 });
  });

  it('une période partielle ne montre que ce qui la touche ; départ le premier jour exclu ; défaut = aujourd\'hui', async () => {
    const s = await setup();
    await book(s, s.r101, -3, 0); // part le jour même du début de grille : pas dans la grille
    await book(s, s.r102, -2, 2); // chevauche le début
    const g = await grid(s);
    expect(g.items.map((i: any) => i.roomId)).toEqual([s.r102]);
    expect(g.occupancy.map((o: any) => o.occupied).slice(0, 3)).toEqual([1, 1, 0]);
    const def = (await s.h.client.get('/api/v1/calendar')).body;
    expect(def.days).toBe(14);
    expect(def.from).toBe(def.today);
    expect((await s.h.client.get('/api/v1/calendar?days=200')).status).toBe(422);
  });

  it('un séjour terminé reste visible dans le passé ; une réservation annulée disparaît', async () => {
    const s = await setup();
    const done = await book(s, s.r101, 0, 2);
    await q(t, "UPDATE reservation_rooms SET status = 'checked_out', actual_check_in = now() - interval '2 days', actual_check_out = now() WHERE reservation_id = $1", [done]);
    const gone = await book(s, s.r102, 0, 2);
    await s.h.client.post(`/api/v1/reservations/${gone}/cancel`, { reason: 'Test' });
    const g = await grid(s);
    expect(g.items.map((i: any) => [i.roomId, i.status])).toEqual([[s.r101, 'checked_out']]);
  });

  it('filtre par catégorie ; les chambres archivées n\'apparaissent pas', async () => {
    const s = await setup();
    const dlx = (await s.h.client.post('/api/v1/rooms/categories', { code: 'DLX', name: 'Deluxe', baseRate: 200000 })).body.id;
    await s.h.client.post('/api/v1/rooms', { categoryId: dlx, number: '201', capacity: 4 });
    await s.h.client.post(`/api/v1/rooms/${s.r103}/archive`);
    expect((await grid(s)).rooms.map((r: any) => r.number).sort()).toEqual(['101', '102', '201']);
    expect((await grid(s, `&categoryId=${dlx}`)).rooms.map((r: any) => r.number)).toEqual(['201']);
  });

  it('isolation : un autre établissement ne voit rien', async () => {
    const a = await setup();
    await book(a, a.r101, 0, 2);
    const b = await setup();
    const g = await grid(b);
    expect(g.items).toEqual([]);
    expect(g.rooms).toHaveLength(3);
    expect(g.rooms.some((r: any) => [a.r101, a.r102, a.r103].includes(r.id))).toBe(false);
  });
});

describe('blocages', () => {
  it('bloquer une chambre la retire de la vente, se voit dans la grille et se lève', async () => {
    const s = await setup();
    const blocked = await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r101, startsOn: D(1), endsOn: D(4), reason: 'maintenance', notes: 'Fuite salle de bain' });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(201);
    const g = await grid(s);
    expect(g.items.find((i: any) => i.kind === 'block')).toMatchObject({ roomId: s.r101, startsOn: D(1), endsOn: D(4), reason: 'maintenance', notes: 'Fuite salle de bain' });
    expect(g.occupancy.map((o: any) => o.blocked).slice(0, 5)).toEqual([0, 1, 1, 1, 0]);
    // plus vendable sur ces nuits
    expect(code(await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r101, checkIn: D(2), checkOut: D(3), adults: 1 }] }))).toBe('room_not_available');
    const avail = (await s.h.client.get(`/api/v1/reservations/availability?checkIn=${D(2)}&checkOut=${D(3)}`)).body;
    expect(avail.categories[0].rooms.map((r: any) => r.number)).toEqual(['102', '103']);
    // fin de maintenance anticipée, puis levée
    expect((await s.h.client.patch(`/api/v1/calendar/blocks/${blocked.body.id}`, { endsOn: D(2) })).status).toBe(200);
    expect((await grid(s)).items.find((i: any) => i.kind === 'block').endsOn).toBe(D(2));
    expect((await s.h.client.patch(`/api/v1/calendar/blocks/${blocked.body.id}`, { endsOn: D(1) })).status).toBe(422);
    expect((await s.h.client.delete(`/api/v1/calendar/blocks/${blocked.body.id}`)).status).toBe(200);
    expect((await s.h.client.delete(`/api/v1/calendar/blocks/${blocked.body.id}`)).status).toBe(404);
    expect((await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r101, checkIn: D(2), checkOut: D(3), adults: 1 }] })).status).toBe(201);
  });

  it('refuse de bloquer une chambre occupée ; blocage sans fin permis ; dates invalides refusées', async () => {
    const s = await setup();
    await book(s, s.r101, 2, 4);
    const clash = await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r101, startsOn: D(3), endsOn: D(6), reason: 'out_of_service' });
    expect(clash.status).toBe(409);
    expect(code(clash)).toBe('room_not_available');
    expect((await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r101, startsOn: D(4), endsOn: null, reason: 'out_of_service' })).status).toBe(201);
    expect((await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r102, startsOn: D(4), endsOn: D(4), reason: 'other' })).status).toBe(422);
    expect((await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r102, startsOn: D(4), endsOn: D(5), reason: 'vacances' })).status).toBe(422);
    expect((await s.h.client.post('/api/v1/calendar/blocks', { roomId: '00000000-0000-4000-8000-000000000000', startsOn: D(4), endsOn: D(5), reason: 'other' })).status).toBe(404);
    // un blocage sans fin apparaît jusqu'au bout de la grille
    const block = (await grid(s)).items.find((i: any) => i.kind === 'block');
    expect(block.endsOn).toBeNull();
    // une chambre ne s'archive pas tant qu'un blocage futur existe
    expect(code(await s.h.client.post(`/api/v1/rooms/${s.r101}/archive`))).toBe('room_has_future_stays');
  });

  it('droits : la réception bloque, le housekeeping lit seulement ; un autre établissement ne touche pas aux blocages', async () => {
    const s = await setup();
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    const hk = await addStaff(t, s.h.hotelId, 'hk_manager');
    expect((await hk.client.get('/api/v1/calendar')).status).toBe(200);
    expect((await hk.client.post('/api/v1/calendar/blocks', { roomId: s.r101, startsOn: D(1), endsOn: D(2), reason: 'maintenance' })).status).toBe(403);
    const ok = await reception.client.post('/api/v1/calendar/blocks', { roomId: s.r101, startsOn: D(1), endsOn: D(2), reason: 'maintenance' });
    expect(ok.status).toBe(201);
    const other = await setup();
    expect((await other.h.client.delete(`/api/v1/calendar/blocks/${ok.body.id}`)).status).toBe(404);
    expect((await other.h.client.patch(`/api/v1/calendar/blocks/${ok.body.id}`, { endsOn: D(5) })).status).toBe(404);
    const staff = await addStaff(t, s.h.hotelId, 'accountant');
    expect((await staff.client.get('/api/v1/calendar')).status).toBe(403);
    expect(await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'room.blocked'", [s.h.hotelId])).toEqual([{ n: 1 }]);
  });
});

describe('déplacer un séjour', () => {
  it('vers une autre chambre ou d\'autres dates, avec prix conservés et refus si occupé', async () => {
    const s = await setup();
    const res = await book(s, s.r101, 0, 3);
    await book(s, s.r103, 0, 3);
    const [line] = await q(t, 'SELECT id FROM reservation_rooms WHERE reservation_id = $1', [res]);
    const moved = await s.h.client.post(`/api/v1/calendar/stays/${line.id}/move`, { roomId: s.r102 });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ reservationId: res, changed: ['roomId'] });
    expect((await grid(s)).items.find((i: any) => i.reservationId === res).roomId).toBe(s.r102);
    expect(code(await s.h.client.post(`/api/v1/calendar/stays/${line.id}/move`, { roomId: s.r103 }))).toBe('room_not_available');
    const later = await s.h.client.post(`/api/v1/calendar/stays/${line.id}/move`, { checkIn: D(5), checkOut: D(7) });
    expect(later.status).toBe(200);
    expect((await s.h.client.get(`/api/v1/reservations/${res}`)).body).toMatchObject({ total: 200000, rooms: [{ checkIn: D(5), checkOut: D(7), roomNumber: '102' }] });
    expect((await s.h.client.post(`/api/v1/calendar/stays/${line.id}/move`, {})).status).toBe(422);
    const hk = await addStaff(t, s.h.hotelId, 'hk_manager');
    expect((await hk.client.post(`/api/v1/calendar/stays/${line.id}/move`, { roomId: s.r101 })).status).toBe(403);
    const other = await setup();
    expect((await other.h.client.post(`/api/v1/calendar/stays/${line.id}/move`, { roomId: other.r101 })).status).toBe(404);
  });
});
