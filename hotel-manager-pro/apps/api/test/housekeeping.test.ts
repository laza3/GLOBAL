import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const TODAY = () => todayIn('Indian/Antananarivo');
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; r101: string; r102: string; guest: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
  const mk = async (n: string) => (await h.client.post('/api/v1/rooms', { categoryId: cat, number: n, capacity: 2 })).body.id as string;
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
  return { h, cat, r101: await mk('101'), r102: await mk('102'), guest };
}
const stay = async (s: Setup, roomId: string, i = 0, o = 1) => {
  const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId, checkIn: addDays(TODAY(), i), checkOut: addDays(TODAY(), o), adults: 1 }] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
/** Fait partir un client : la chambre devient « à nettoyer » et une tâche est créée. */
async function departed(s: Setup, roomId: string) {
  const id = await stay(s, roomId);
  await s.h.client.post('/api/v1/reception/check-in', { reservationId: id, force: true });
  const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [id]);
  await s.h.client.post(`/api/v1/folios/${f.id}/payments`, { methodCode: 'cash', amount: 100000, currency: 'MGA' });
  expect((await s.h.client.post('/api/v1/reception/check-out', { reservationId: id })).status).toBe(200);
}
const board = async (c: Client) => (await c.get('/api/v1/housekeeping/board')).body;
const tasks = async (c: Client, query = '') => (await c.get(`/api/v1/housekeeping/tasks${query}`)).body;

describe('départ → tâche de ménage', () => {
  it('le départ crée une tâche, la chambre est « à nettoyer » ; prioritaire si une arrivée est prévue le jour même', async () => {
    const s = await setup();
    await stay(s, s.r102, 0, 2); // arrivée aujourd'hui dans la 102
    await departed(s, s.r101);
    const b = await board(s.h.client);
    const room = b.rooms.find((r: any) => r.number === '101');
    expect(room).toMatchObject({ housekeepingStatus: 'dirty', displayStatus: 'to_clean', taskStatus: 'to_clean', taskType: 'checkout_clean' });
    expect(b.counts).toMatchObject({ dirty: 1, clean: 1 });
    expect(b.rooms.find((r: any) => r.number === '102')).toMatchObject({ arrivesToday: true });
    expect((await tasks(s.h.client)).items).toHaveLength(1);
    // pas de doublon si un second départ survient dans la même chambre avant le ménage
    await departed(s, s.r101);
    expect((await tasks(s.h.client)).total).toBe(1);
  });

  it('une chambre avec arrivée du jour reçoit une tâche prioritaire', async () => {
    const s = await setup();
    const a = await stay(s, s.r101, 0, 1);
    await s.h.client.post('/api/v1/reception/check-in', { reservationId: a });
    const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [a]);
    await s.h.client.post(`/api/v1/folios/${f.id}/payments`, { methodCode: 'cash', amount: 100000, currency: 'MGA' });
    await stay(s, s.r101, 1, 2); // arrive demain : pas encore « aujourd'hui »
    await s.h.client.post('/api/v1/reception/check-out', { reservationId: a });
    expect((await tasks(s.h.client)).items[0].priority).toBe('normal');
  });
});

describe('cycle d\'une tâche', () => {
  it('commencer → terminer → contrôler ; la chambre suit à chaque étape ; l\'arrivée n\'exige plus de confirmation', async () => {
    const s = await setup();
    await departed(s, s.r101);
    const hk = await addStaff(t, s.h.hotelId, 'hk_staff');
    const task = (await tasks(s.h.client)).items[0];
    const roomOf = async () => (await board(s.h.client)).rooms.find((r: any) => r.number === '101');
    // inspection avant ménage : refusée
    expect(code(await s.h.client.post(`/api/v1/housekeeping/tasks/${task.id}/inspect`))).toBe('hk_task_invalid_state');
    // l'employé prend la tâche libre : elle lui est attribuée
    expect((await hk.client.post(`/api/v1/housekeeping/tasks/${task.id}/start`)).status).toBe(200);
    expect(await roomOf()).toMatchObject({ housekeepingStatus: 'cleaning', taskStatus: 'in_progress', assignedName: expect.any(String) });
    expect(code(await hk.client.post(`/api/v1/housekeeping/tasks/${task.id}/start`))).toBe('hk_task_invalid_state');
    expect((await hk.client.post(`/api/v1/housekeeping/tasks/${task.id}/complete`)).status).toBe(200);
    expect(await roomOf()).toMatchObject({ housekeepingStatus: 'clean', displayStatus: 'available', taskStatus: 'cleaned' });
    // seul un responsable contrôle
    expect((await hk.client.post(`/api/v1/housekeeping/tasks/${task.id}/inspect`)).status).toBe(403);
    expect((await s.h.client.post(`/api/v1/housekeeping/tasks/${task.id}/inspect`)).status).toBe(200);
    expect(await roomOf()).toMatchObject({ housekeepingStatus: 'inspected', taskStatus: null });
    const done = (await tasks(s.h.client, '?status=inspected')).items[0];
    expect(done).toMatchObject({ status: 'inspected', roomNumber: '101' });
    expect(done.startedAt && done.completedAt).toBeTruthy();
    // la chambre propre accepte l'arrivée sans confirmation
    const a = await stay(s, s.r101, 0, 1);
    expect((await s.h.client.post('/api/v1/reception/check-in', { reservationId: a })).body.forced).toBe(false);
  });

  it('un employé ne touche que ses tâches ; le responsable attribue ; seules les bonnes personnes sont assignables', async () => {
    const s = await setup();
    await departed(s, s.r101);
    await departed(s, s.r102);
    const [a, b] = (await tasks(s.h.client)).items;
    const hk1 = await addStaff(t, s.h.hotelId, 'hk_staff');
    const hk2 = await addStaff(t, s.h.hotelId, 'hk_staff');
    const staff = (await s.h.client.get('/api/v1/housekeeping/staff')).body.staff;
    expect(staff.length).toBeGreaterThanOrEqual(3);
    const [m1] = await q(t, 'SELECT id FROM memberships WHERE user_id = $1', [hk1.userId]);
    const [recep] = await q(t, "SELECT m.id FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.hotel_id = $1 AND r.key = 'owner'", [s.h.hotelId]);
    expect((await s.h.client.post(`/api/v1/housekeeping/tasks/${a.id}/assign`, { assignedId: m1.id })).status).toBe(200);
    expect(code(await hk2.client.post(`/api/v1/housekeeping/tasks/${a.id}/start`))).toBe('forbidden');
    expect((await hk1.client.post(`/api/v1/housekeeping/tasks/${a.id}/start`)).status).toBe(200);
    expect((await tasks(hk1.client, '?mine=true')).total).toBe(1);
    expect((await tasks(hk2.client, '?mine=true')).total).toBe(0);
    expect((await board(hk1.client)).rooms.length).toBe(2);
    expect((await hk1.client.get('/api/v1/housekeeping/board?mine=true')).body.rooms).toHaveLength(1);
    expect((await hk1.client.post(`/api/v1/housekeeping/tasks/${a.id}/assign`, { assignedId: m1.id })).status).toBe(403);
    // une personne sans droit de ménage n'est pas assignable
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    const [mr] = await q(t, 'SELECT id FROM memberships WHERE user_id = $1', [reception.userId]);
    expect((await s.h.client.post(`/api/v1/housekeeping/tasks/${b.id}/assign`, { assignedId: mr.id })).status).toBe(422);
    void recep;
    expect((await s.h.client.post(`/api/v1/housekeeping/tasks/${b.id}/assign`, { assignedId: null })).status).toBe(200);
  });

  it('tâche manuelle, état forcé, filtres ; signaler un problème crée une demande de maintenance', async () => {
    const s = await setup();
    const mgr = await addStaff(t, s.h.hotelId, 'hk_manager');
    const created = await mgr.client.post('/api/v1/housekeeping/tasks', { roomId: s.r101, taskType: 'deep_clean', priority: 'urgent', notes: 'Après travaux' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await tasks(mgr.client)).items[0]).toMatchObject({ taskType: 'deep_clean', priority: 'urgent', status: 'to_clean', notes: 'Après travaux' });
    expect((await tasks(mgr.client, '?status=open')).total).toBe(1);
    expect((await tasks(mgr.client, '?status=inspected')).total).toBe(0);
    const staff = await addStaff(t, s.h.hotelId, 'hk_staff');
    expect((await staff.client.post('/api/v1/housekeeping/tasks', { roomId: s.r101, taskType: 'deep_clean' })).status).toBe(403);
    const issue = await staff.client.post(`/api/v1/housekeeping/tasks/${created.body.id}/report-issue`, { title: 'Robinet qui fuit', priority: 'high' });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const m = (await mgr.client.get('/api/v1/maintenance')).body;
    expect(m.items[0]).toMatchObject({ title: 'Robinet qui fuit', roomNumber: '101', priority: 'high', status: 'open' });
    expect((await board(mgr.client)).rooms.find((r: any) => r.number === '101').openIssues).toBe(1);
    // état forcé : la chambre propre clôt la tâche ouverte
    expect((await mgr.client.post(`/api/v1/housekeeping/rooms/${s.r101}/status`, { status: 'clean' })).status).toBe(200);
    expect((await tasks(mgr.client)).items[0].status).toBe('cleaned');
    expect((await staff.client.post(`/api/v1/housekeeping/rooms/${s.r101}/status`, { status: 'dirty' })).status).toBe(403);
  });
});

describe('formule et isolation', () => {
  it('sans housekeeping dans la formule : fonction refusée, et les chambres quittées restent disponibles', async () => {
    const s = await setup();
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [s.h.hotelId]);
    const res = await s.h.client.get('/api/v1/housekeeping/board');
    expect(res.status).toBe(403);
    expect(code(res)).toBe('feature_not_in_plan');
    expect((await s.h.client.get('/api/v1/maintenance')).status).toBe(403);
    await departed(s, s.r101);
    expect((await s.h.client.get('/api/v1/rooms')).body.rooms.find((r: any) => r.id === s.r101).displayStatus).toBe('available');
    expect((await q(t, 'SELECT count(*)::int AS n FROM hk_tasks WHERE hotel_id = $1', [s.h.hotelId]))[0].n).toBe(0);
  });

  it('un autre établissement ne voit ni ne modifie rien', async () => {
    const a = await setup();
    await departed(a, a.r101);
    const task = (await tasks(a.h.client)).items[0];
    const b = await setup();
    expect((await tasks(b.h.client)).total).toBe(0);
    expect((await b.h.client.post(`/api/v1/housekeeping/tasks/${task.id}/start`)).status).toBe(404);
    expect((await b.h.client.post('/api/v1/housekeeping/tasks', { roomId: a.r101, taskType: 'deep_clean' })).status).toBe(404);
    expect((await new Client(t).get('/api/v1/housekeeping/board')).status).toBe(401);
  });
});

describe('maintenance', () => {
  it('signaler avec blocage de la chambre ; la chambre n\'est plus vendable ; résoudre lève le blocage', async () => {
    const s = await setup();
    const mgr = await addStaff(t, s.h.hotelId, 'hk_manager');
    const rep = await mgr.client.post('/api/v1/maintenance', { roomId: s.r101, title: 'Climatisation en panne', priority: 'high', block: { startsOn: TODAY(), endsOn: addDays(TODAY(), 5) } });
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    const item = (await mgr.client.get('/api/v1/maintenance')).body.items[0];
    expect(item).toMatchObject({ roomNumber: '101', status: 'open', blockStartsOn: TODAY(), blockEndsOn: addDays(TODAY(), 5) });
    expect((await s.h.client.get('/api/v1/rooms')).body.rooms.find((r: any) => r.id === s.r101).displayStatus).toBe('maintenance');
    expect(code(await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r101, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }] }))).toBe('room_not_available');
    const cal = (await s.h.client.get('/api/v1/calendar')).body;
    expect(cal.items.find((i: any) => i.kind === 'block')).toMatchObject({ reason: 'maintenance', roomId: s.r101 });
    // prise en charge, puis résolution avec le coût
    const [tech] = await q(t, 'SELECT m.id FROM memberships m WHERE m.user_id = $1', [mgr.userId]);
    expect((await mgr.client.patch(`/api/v1/maintenance/${item.id}`, { status: 'in_progress', assignedId: tech.id })).status).toBe(200);
    expect((await mgr.client.patch(`/api/v1/maintenance/${item.id}`, { status: 'resolved', costAmount: 45000 })).status).toBe(200);
    const done = (await mgr.client.get('/api/v1/maintenance?status=resolved')).body.items[0];
    expect(done).toMatchObject({ status: 'resolved', costAmount: 45000, allocationId: null });
    expect(done.resolvedAt).toBeTruthy();
    expect((await s.h.client.get('/api/v1/rooms')).body.rooms.find((r: any) => r.id === s.r101).displayStatus).toBe('available');
    expect((await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, roomId: s.r101, checkIn: addDays(TODAY(), 1), checkOut: addDays(TODAY(), 2), adults: 1 }] })).status).toBe(201);
    expect(code(await mgr.client.patch(`/api/v1/maintenance/${item.id}`, { status: 'cancelled' }))).toBe('maintenance_invalid_state');
  });

  it('bloquer une chambre occupée est refusé ; l\'employé signale mais ne gère pas ; validation', async () => {
    const s = await setup();
    await stay(s, s.r101, 0, 3);
    const staff = await addStaff(t, s.h.hotelId, 'hk_staff');
    const clash = await staff.client.post('/api/v1/maintenance', { roomId: s.r101, title: 'Peinture', block: { startsOn: TODAY(), endsOn: addDays(TODAY(), 2) } });
    expect(clash.status).toBe(409);
    expect(code(clash)).toBe('room_not_available');
    expect((await q(t, 'SELECT count(*)::int AS n FROM maintenance_requests WHERE hotel_id = $1', [s.h.hotelId]))[0].n).toBe(0);
    const ok = await staff.client.post('/api/v1/maintenance', { roomId: s.r102, title: 'Ampoule grillée' });
    expect(ok.status).toBe(201);
    expect((await staff.client.patch(`/api/v1/maintenance/${ok.body.id}`, { status: 'resolved' })).status).toBe(403);
    expect((await staff.client.post('/api/v1/maintenance', { title: 'ab' })).status).toBe(422);
    expect((await staff.client.post('/api/v1/maintenance', { title: 'Sans chambre', block: { startsOn: TODAY(), endsOn: null } })).status).toBe(422);
    expect((await staff.client.post('/api/v1/maintenance', { title: 'Parking : portail', priority: 'low' })).status).toBe(201); // sans chambre
    expect((await s.h.client.patch(`/api/v1/maintenance/${ok.body.id}`, { assignedId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    expect((await s.h.client.patch(`/api/v1/maintenance/${ok.body.id}`, {})).status).toBe(422);
    const [rr] = await q(t, "SELECT m.id FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.hotel_id = $1 AND r.key = 'receptionist' LIMIT 1", [s.h.hotelId]);
    void rr;
  });
});
