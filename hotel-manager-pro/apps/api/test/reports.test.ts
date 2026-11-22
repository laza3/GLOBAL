import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const D = (n: number) => addDays('2030-03-04', n);
const TODAY = () => todayIn('Indian/Antananarivo');
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; dlx: string; r101: string; r102: string; r103: string; r201: string; guest: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000, sortOrder: 1 })).body.id;
  const dlx = (await h.client.post('/api/v1/rooms/categories', { code: 'DLX', name: 'Deluxe', baseRate: 200000, sortOrder: 2 })).body.id;
  const mk = async (c: string, n: string) => (await h.client.post('/api/v1/rooms', { categoryId: c, number: n, capacity: 2 })).body.id as string;
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
  return { h, cat, dlx, r101: await mk(cat, '101'), r102: await mk(cat, '102'), r103: await mk(cat, '103'), r201: await mk(dlx, '201'), guest };
}
const book = async (s: Setup, roomId: string, categoryId: string, i: number, o: number, over: Record<string, unknown> = {}) => {
  const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId, roomId, checkIn: D(i), checkOut: D(o), adults: 1 }], ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const perf = async (c: Client, from = D(0), to = D(9), extra = '') => {
  const res = await c.get(`/api/v1/reports/performance?from=${from}&to=${to}${extra}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const premium = (s: Setup) => q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'premium') WHERE hotel_id = $1", [s.h.hotelId]);

describe('performance : occupation, prix moyen, RevPAR', () => {
  it('calcul sur les nuits : vendues, disponibles, revenu, ADR, RevPAR ; options et annulées exclues', async () => {
    const s = await setup(); // 4 chambres, 10 jours = 40 nuits disponibles
    await book(s, s.r101, s.cat, 0, 3);
    await book(s, s.r102, s.cat, 2, 5);
    await book(s, s.r201, s.dlx, 4, 6);
    const opt = await book(s, s.r103, s.cat, 0, 5, { status: 'tentative', tentativeExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const cancelled = await book(s, s.r103, s.cat, 6, 8);
    await s.h.client.post(`/api/v1/reservations/${cancelled}/cancel`, { reason: 'Test' });
    void opt;
    const p = await perf(s.h.client);
    expect(p).toMatchObject({ from: D(0), to: D(9), currency: 'MGA', advanced: false });
    // 3 + 3 nuits Standard (100 000) + 2 nuits Deluxe (200 000) = 8 nuits, 1 000 000 Ar
    expect(p.kpis).toEqual({ roomsSold: 8, roomsAvailable: 40, revenue: 1_000_000, occupancyRate: 0.2, adr: 125000, revpar: 25000 });
    expect(p.daily).toHaveLength(10);
    expect(p.daily.map((d: any) => d.roomsSold)).toEqual([1, 1, 2, 1, 2, 1, 0, 0, 0, 0]);
    expect(p.daily[4]).toEqual({ date: D(4), roomsSold: 2, roomsAvailable: 4, revenue: 100000 + 200000 });
    // gratuit : pas d'analytique avancée
    expect([p.previous, p.byCategory, p.bySource, p.topGuests, p.previousDaily]).toEqual([null, null, null, null, null]);
    expect(p.charges).toEqual([{ kind: 'room', amount: 1_000_000, tax: 0 }]); // l'option non confirmée n'y figure pas
  });

  it('chambres bloquées non disponibles, remises déduites, prix figés ; période vide', async () => {
    const s = await setup();
    const a = await book(s, s.r101, s.cat, 0, 2);
    await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r103, startsOn: D(0), endsOn: D(5), reason: 'maintenance' });
    let p = await perf(s.h.client);
    expect(p.kpis.roomsAvailable).toBe(40 - 5);
    expect(p.daily[0].roomsAvailable).toBe(3);
    expect(p.daily[5].roomsAvailable).toBe(4);
    // remise répartie : le revenu baisse d'autant
    const d = (await s.h.client.get(`/api/v1/reservations/${a}`)).body;
    await s.h.client.patch(`/api/v1/reservations/${a}`, { version: d.version, discount: 30000 });
    p = await perf(s.h.client);
    expect(p.kpis.revenue).toBe(200000 - 30000);
    // un tarif modifié ensuite ne réécrit pas l'historique
    await s.h.client.patch(`/api/v1/rooms/categories/${s.cat}`, { baseRate: 999999 });
    expect((await perf(s.h.client)).kpis.revenue).toBe(170000);
    const empty = await perf(s.h.client, D(100), D(110));
    expect(empty.kpis).toMatchObject({ roomsSold: 0, revenue: 0, occupancyRate: 0, adr: 0, revpar: 0 });
  });

  it('charges par nature (hébergement, restaurant, services) sur la période', async () => {
    const s = await setup();
    const r = await book(s, s.r101, s.cat, 0, 2);
    const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [r]);
    await s.h.client.post(`/api/v1/folios/${f.id}/charges`, { kind: 'service', description: 'Navette', unitAmount: 20000, serviceDate: D(1) });
    const p = await perf(s.h.client);
    expect(p.charges).toEqual([{ kind: 'room', amount: 200000, tax: 0 }, { kind: 'service', amount: 20000, tax: 0 }]);
  });

  it('validation de la période ; défaut = les 30 derniers jours', async () => {
    const s = await setup();
    expect((await s.h.client.get(`/api/v1/reports/performance?from=${D(5)}&to=${D(0)}`)).status).toBe(422);
    expect((await s.h.client.get(`/api/v1/reports/performance?from=${D(0)}&to=${addDays(D(0), 366)}`)).status).toBe(422);
    expect((await s.h.client.get(`/api/v1/reports/performance?from=${D(0)}&to=${addDays(D(0), 365)}`)).status).toBe(200);
    expect((await s.h.client.get('/api/v1/reports/performance?from=2030-02-30')).status).toBe(422);
    const def = (await s.h.client.get('/api/v1/reports/performance')).body;
    expect(def.to).toBe(TODAY());
    expect(def.daily).toHaveLength(30);
  });
});

describe('analytique avancée (formule Premium)', () => {
  it('période précédente, par catégorie, par origine, meilleurs clients', async () => {
    const s = await setup();
    await premium(s);
    const g2 = (await s.h.client.post('/api/v1/guests', { firstName: 'Jean', lastName: 'Randria' })).body.id;
    await book(s, s.r101, s.cat, 0, 3, { source: 'phone' });
    await book(s, s.r201, s.dlx, 1, 3, { guestId: g2, source: 'booking_com' });
    // période précédente : nuits D(-10)..D(-8) réservées directement en base pour comparer (aucune API ne réserve dans le passé)
    const p = await perf(s.h.client, D(0), D(9));
    expect(p.advanced).toBe(true);
    expect(p.kpis).toMatchObject({ roomsSold: 5, revenue: 3 * 100000 + 2 * 200000 });
    expect(p.previous).toMatchObject({ roomsSold: 0, revenue: 0 });
    expect(p.previousDaily).toHaveLength(10);
    expect(p.previousDaily[0].date).toBe(D(-10));
    const cats = Object.fromEntries(p.byCategory.map((c: any) => [c.name, c]));
    expect(cats.Standard).toMatchObject({ rooms: 3, roomsSold: 3, roomsAvailable: 30, revenue: 300000, adr: 100000, occupancyRate: 0.1 });
    expect(cats.Deluxe).toMatchObject({ rooms: 1, roomsSold: 2, roomsAvailable: 10, revenue: 400000, adr: 200000, occupancyRate: 0.2 });
    expect(p.bySource.map((x: any) => [x.source, x.nights, x.revenue, x.stays])).toEqual([['booking_com', 2, 400000, 1], ['phone', 3, 300000, 1]]);
    expect(p.topGuests.map((x: any) => [x.name, x.stays, x.nights, x.revenue])).toEqual([['Jean Randria', 1, 2, 400000], ['Hanitra Rakoto', 1, 3, 300000]]);
    // une chambre bloquée réduit les chambres disponibles de la catégorie
    await s.h.client.post('/api/v1/calendar/blocks', { roomId: s.r103, startsOn: D(0), endsOn: D(4), reason: 'out_of_service' });
    const b = await perf(s.h.client);
    expect(b.byCategory.find((c: any) => c.name === 'Standard').roomsAvailable).toBe(30 - 4);
    // client anonymisé : absent du classement
    await q(t, "UPDATE guests SET anonymized_at = now() WHERE id = $1", [g2]);
    expect((await perf(s.h.client)).topGuests.map((x: any) => x.name)).toEqual(['Hanitra Rakoto']);
  });
});

describe('export, droits, isolation', () => {
  it('CSV quotidien : BOM, séparateur ;, une ligne par jour, journalisé ; formule exports requise', async () => {
    const s = await setup();
    await book(s, s.r101, s.cat, 0, 2);
    const res = await s.h.client.get(`/api/v1/reports/performance.csv?from=${D(0)}&to=${D(3)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`performances-${D(0)}-${D(3)}.csv`);
    const lines = (res.body as string).trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[0].replace(/^\uFEFF/, '')).toBe("Date;Chambres vendues;Chambres disponibles;Taux d'occupation (%);Revenu des nuits;Prix moyen (ADR);RevPAR");
    expect(lines[1]).toBe(`${D(0)};1;4;25,0;100000;100000;25000`);
    expect(lines[3]).toBe(`${D(2)};0;4;0,0;0;0;0`);
    expect(await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'report.exported'", [s.h.hotelId])).toEqual([{ n: 1 }]);
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [s.h.hotelId]);
    expect(code(await s.h.client.get('/api/v1/reports/performance.csv'))).toBe('feature_not_in_plan');
    expect((await s.h.client.get(`/api/v1/reports/performance?from=${D(0)}&to=${D(3)}`)).status).toBe(200); // les indicateurs de base restent disponibles
  });

  it('droits et isolation', async () => {
    const a = await setup();
    await book(a, a.r101, a.cat, 0, 2);
    const recep = await addStaff(t, a.h.hotelId, 'receptionist');
    expect((await recep.client.get('/api/v1/reports/performance')).status).toBe(403);
    const acc = await addStaff(t, a.h.hotelId, 'accountant');
    expect((await acc.client.get(`/api/v1/reports/performance?from=${D(0)}&to=${D(3)}`)).status).toBe(200);
    expect((await acc.client.get('/api/v1/reports/performance.csv')).status).toBe(200);
    const b = await setup();
    expect((await perf(b.h.client)).kpis.roomsSold).toBe(0);
    expect((await new Client(t).get('/api/v1/reports/performance')).status).toBe(401);
  });
});

describe('tableau de bord', () => {
  it('chiffres réels de la journée : chambres, arrivées, encaissé, à encaisser, ménage', async () => {
    const s = await setup();
    const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r101, checkIn: TODAY(), checkOut: addDays(TODAY(), 2), adults: 1 }] });
    const res2 = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r102, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }], status: 'pending' });
    expect(res2.status).toBe(201);
    let d = (await s.h.client.get('/api/v1/dashboard')).body;
    expect(d).toMatchObject({ today: TODAY(), currency: 'MGA' });
    expect(d.rooms).toMatchObject({ total: 4, occupied: 0, occupancyRate: 0 });
    expect(d.rooms.byStatus.reserved).toBe(1);
    expect(d.stays).toMatchObject({ arrivals: 1, arrivalsDone: 0, departures: 0, inHouse: 0, overdue: 0, pendingConfirmation: 1 });
    expect(d.stays.upcomingArrivals).toHaveLength(7);
    expect(d.stays.upcomingArrivals[1]).toMatchObject({ date: addDays(TODAY(), 1), n: 1 });
    expect(d.money).toEqual({ collectedToday: 0, receivables: 300000, receivablesFolios: 2 });
    expect(d.restaurant).toEqual({ salesToday: 0, openOrders: 0 });
    expect(d.housekeeping).toEqual({ dirty: 0, cleaning: 0, issues: 0 });
    // arrivée et encaissement
    await s.h.client.post('/api/v1/reception/check-in', { reservationId: res.body.id });
    const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.body.id]);
    await s.h.client.post(`/api/v1/folios/${f.id}/payments`, { methodCode: 'cash', amount: 120000, currency: 'MGA' });
    await s.h.client.post('/api/v1/maintenance', { roomId: s.r201, title: 'Fuite' });
    d = (await s.h.client.get('/api/v1/dashboard')).body;
    expect(d.rooms).toMatchObject({ occupied: 1, occupancyRate: 0.25 });
    expect(d.stays).toMatchObject({ arrivalsDone: 1, inHouse: 1 });
    expect(d.money).toEqual({ collectedToday: 120000, receivables: 300000 - 120000, receivablesFolios: 2 });
    expect(d.housekeeping.issues).toBe(1);
  });

  it('ne montre à chacun que ce qu\'il a le droit de voir ; formule sans restaurant ni housekeeping', async () => {
    const s = await setup();
    const hk = await addStaff(t, s.h.hotelId, 'hk_staff');
    const d = (await hk.client.get('/api/v1/dashboard')).body;
    expect(d.rooms).toBeTruthy();
    expect(d.housekeeping).toBeTruthy();
    expect([d.stays, d.money, d.restaurant]).toEqual([null, null, null]);
    const acc = await addStaff(t, s.h.hotelId, 'accountant');
    const da = (await acc.client.get('/api/v1/dashboard')).body;
    expect(da.money).toBeTruthy();
    expect([da.rooms, da.restaurant, da.housekeeping]).toEqual([null, null, null]);
    expect(da.stays).toBeTruthy(); // le comptable lit les réservations
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [s.h.hotelId]);
    const starter = (await s.h.client.get('/api/v1/dashboard')).body;
    expect([starter.restaurant, starter.housekeeping]).toEqual([null, null]);
    expect(starter.rooms).toBeTruthy();
    // isolation
    const other = await setup();
    expect((await other.h.client.get('/api/v1/dashboard')).body.money).toEqual({ collectedToday: 0, receivables: 0, receivablesFolios: 0 });
    expect((await new Client(t).get('/api/v1/dashboard')).status).toBe(401);
  });
});
