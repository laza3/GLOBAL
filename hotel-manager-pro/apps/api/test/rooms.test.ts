import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const TODAY = () => todayIn('Indian/Antananarivo');

async function category(c: Client, code = 'STD', over: Record<string, unknown> = {}) {
  const res = await c.post('/api/v1/rooms/categories', { code, name: `Catégorie ${code}`, baseRate: 100000, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}
const room = (c: Client, categoryId: string, number: string, over: Record<string, unknown> = {}) => c.post('/api/v1/rooms', { categoryId, number, ...over });
const list = async (c: Client, query = '') => (await c.get(`/api/v1/rooms${query}`)).body.rooms as any[];

describe('catégories', () => {
  it('crée, liste avec le nombre de chambres, modifie ; un code est unique par établissement', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client, 'STD', { description: 'Chambre standard' });
    await room(h.client, std, '101');
    await room(h.client, std, '102');
    const cats = (await h.client.get('/api/v1/rooms/categories')).body.categories;
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ code: 'STD', name: 'Catégorie STD', baseRate: 100000, roomsCount: 2, isActive: true });
    expect((await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Doublon', baseRate: 1 })).body.error.code).toBe('category_code_taken');
    expect((await h.client.patch(`/api/v1/rooms/categories/${std}`, { baseRate: 120000, name: 'Standard' })).body.updated.sort()).toEqual(['baseRate', 'name']);
    expect((await h.client.get('/api/v1/rooms/categories')).body.categories[0]).toMatchObject({ name: 'Standard', baseRate: 120000 });
    // un autre établissement peut réutiliser le même code
    const other = await registerHotel(t);
    await category(other.client, 'STD');
  });

  it('valide les champs et ignore tout ce qui n\'est pas dans la liste blanche', async () => {
    const h = await registerHotel(t);
    expect((await h.client.post('/api/v1/rooms/categories', { code: 'pas valide!', name: 'X', baseRate: -5 })).status).toBe(422);
    const std = await category(h.client);
    const other = await registerHotel(t);
    // tentative de déplacer la catégorie dans un autre hôtel / d'écrire une colonne interdite : champs ignorés
    const res = await h.client.patch(`/api/v1/rooms/categories/${std}`, { hotel_id: other.hotelId, hotelId: other.hotelId, name: 'Ok' });
    expect(res.body.updated).toEqual(['name']);
    expect((await q(t, 'SELECT hotel_id FROM room_categories WHERE id = $1', [std]))[0].hotel_id).toBe(h.hotelId);
    expect((await h.client.patch(`/api/v1/rooms/categories/${std}`, {})).status).toBe(422);
  });

  it('la réception peut lire les chambres mais pas les gérer', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    const reception = await addStaff(t, h.hotelId, 'receptionist');
    expect((await reception.client.get('/api/v1/rooms/categories')).status).toBe(200);
    expect((await reception.client.post('/api/v1/rooms/categories', { code: 'X', name: 'Xx', baseRate: 1 })).status).toBe(403);
    expect((await reception.client.post('/api/v1/rooms', { categoryId: std, number: '1' })).status).toBe(403);
    expect((await reception.client.post('/api/v1/rooms/rates', {})).status).toBe(403);
    expect((await new Client(t).get('/api/v1/rooms')).status).toBe(401);
  });
});

describe('chambres', () => {
  it('crée avec des valeurs par défaut, liste avec l\'état du jour ; un numéro est unique', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    const res = await room(h.client, std, '101', { name: 'Vue mer', floor: 1, amenities: ['wifi', 'clim'] });
    expect(res.status).toBe(201);
    const rooms = await list(h.client);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ number: '101', name: 'Vue mer', floor: 1, capacity: 2, beds: 1, categoryName: 'Catégorie STD', nightlyRate: null, baseNightlyRate: 100000, amenities: ['wifi', 'clim'], displayStatus: 'available', isArchived: false, version: 1 });
    expect((await room(h.client, std, '101')).body.error.code).toBe('room_number_taken');
    expect((await room(h.client, std, '  ')).status).toBe(422);
    expect((await room(h.client, std, '102', { capacity: 0 })).status).toBe(422);
    // même numéro dans un autre établissement : autorisé
    const other = await registerHotel(t);
    expect((await room(other.client, await category(other.client), '101')).status).toBe(201);
  });

  it('refuse une catégorie désactivée ou inexistante', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    await h.client.patch(`/api/v1/rooms/categories/${std}`, { isActive: false });
    expect((await room(h.client, std, '1')).body.error.code).toBe('category_inactive');
    expect((await room(h.client, '00000000-0000-0000-0000-000000000000', '1')).status).toBe(404);
  });

  it('création en série : tout ou rien, plage bornée', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    const ok = await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 101, to: 105, floor: 1 });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ created: 5, numbers: ['101', '102', '103', '104', '105'] });
    // un numéro existe déjà dans la plage : AUCUNE chambre n'est créée
    const dup = await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 104, to: 108 });
    expect(dup.body.error.code).toBe('room_number_taken');
    expect(await list(h.client)).toHaveLength(5);
    expect((await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 1, to: 500 })).status).toBe(422);
    expect((await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 9, to: 3 })).status).toBe(422);
    const prefixed = await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 1, to: 2, prefix: 'B' });
    expect(prefixed.body.numbers).toEqual(['B1', 'B2']);
  });

  it('la limite de la formule est appliquée par la base, y compris en série et à la restauration', async () => {
    const h = await registerHotel(t); // essai Business : 30 chambres
    const std = await category(h.client);
    expect((await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 1, to: 30 })).status).toBe(201);
    const over = await room(h.client, std, '31');
    expect(over.status).toBe(402);
    expect(over.body.error.code).toBe('room_limit_reached');
    const bulk = await h.client.post('/api/v1/rooms/bulk', { categoryId: std, from: 100, to: 102 });
    expect(bulk.body.error.code).toBe('room_limit_reached');
    expect(await list(h.client)).toHaveLength(30); // la série refusée n'a rien laissé
    // archiver libère une place ; restaurer la reprend
    const first = (await list(h.client))[0];
    expect((await h.client.post(`/api/v1/rooms/${first.id}/archive`)).status).toBe(200);
    expect((await room(h.client, std, '31')).status).toBe(201);
    expect((await h.client.post(`/api/v1/rooms/${first.id}/restore`)).body.error.code).toBe('room_limit_reached');
  });

  it('modification avec contrôle de version : la deuxième modification obsolète est refusée', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    await room(h.client, std, '101');
    const [r1] = await list(h.client);
    const a = await h.client.patch(`/api/v1/rooms/${r1.id}`, { version: r1.version, name: 'Vue jardin', nightlyRate: 150000 });
    expect(a.status).toBe(200);
    const stale = await h.client.patch(`/api/v1/rooms/${r1.id}`, { version: r1.version, name: 'Écrase tout' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    const [r2] = await list(h.client);
    expect(r2).toMatchObject({ name: 'Vue jardin', nightlyRate: 150000, baseNightlyRate: 150000, version: 2 });
    expect((await h.client.patch(`/api/v1/rooms/${r1.id}`, { name: 'sans version' })).status).toBe(422);
    expect((await h.client.patch('/api/v1/rooms/00000000-0000-0000-0000-000000000000', { version: 1, name: 'x' })).status).toBe(404);
    // le tarif propre peut être retiré (retour au tarif de la catégorie)
    await h.client.patch(`/api/v1/rooms/${r1.id}`, { version: 2, nightlyRate: null });
    expect((await list(h.client))[0]).toMatchObject({ nightlyRate: null, baseNightlyRate: 100000 });
  });

  it('archivage refusé tant qu\'un blocage ou un séjour est à venir ; l\'état du jour suit les blocs', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client);
    await room(h.client, std, '101');
    await room(h.client, std, '102');
    const [a, b] = await list(h.client);
    // bloc de maintenance en cours sur 101, bloc futur sur 102
    await q(t, "INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, $4, 'maintenance')", [h.hotelId, a.id, addDays(TODAY(), -1), addDays(TODAY(), 2)]);
    await q(t, "INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason) VALUES ($1, $2, 'block', $3, $4, 'out_of_service')", [h.hotelId, b.id, addDays(TODAY(), 5), addDays(TODAY(), 8)]);
    const rooms = await list(h.client);
    expect(rooms.find((x) => x.number === '101').displayStatus).toBe('maintenance');
    expect(rooms.find((x) => x.number === '102').displayStatus).toBe('available');
    expect((await list(h.client, '?status=maintenance')).map((x) => x.number)).toEqual(['101']);
    expect((await h.client.post(`/api/v1/rooms/${b.id}/archive`)).body.error.code).toBe('room_has_future_stays');
    await q(t, 'DELETE FROM room_allocations WHERE room_id = $1', [b.id]);
    expect((await h.client.post(`/api/v1/rooms/${b.id}/archive`)).status).toBe(200);
    expect((await list(h.client)).map((x) => x.number)).toEqual(['101']);
    const all = await list(h.client, '?archived=true');
    expect(all.find((x) => x.number === '102')).toMatchObject({ isArchived: true, displayStatus: 'archived' });
    expect((await list(h.client, '?q=101')).map((x) => x.number)).toEqual(['101']);
    expect((await h.client.post(`/api/v1/rooms/${b.id}/archive`)).status).toBe(404); // déjà archivée
  });
});

describe('isolation entre établissements', () => {
  let a: Registered; let b: Registered; let catA: string; let roomA: any;
  beforeAll(async () => {
    a = await registerHotel(t);
    b = await registerHotel(t);
    catA = await category(a.client);
    await room(a.client, catA, '101');
    roomA = (await list(a.client))[0];
    await a.client.post('/api/v1/rooms/rates', { categoryId: catA, name: 'Haute saison', startsOn: '2027-07-01', endsOn: '2027-08-31', nightlyRate: 200000, weekendRate: null, minStay: 1, priority: 0, isActive: true });
  });

  it('B ne voit rien de A', async () => {
    expect(await list(b.client)).toEqual([]);
    expect((await b.client.get('/api/v1/rooms/categories')).body.categories).toEqual([]);
    expect((await b.client.get('/api/v1/rooms/rates')).body.periods).toEqual([]);
  });

  it('B ne peut ni modifier, ni archiver, ni créer dans l\'espace de A', async () => {
    expect((await b.client.patch(`/api/v1/rooms/${roomA.id}`, { version: 1, name: 'Piraté' })).status).toBe(404);
    expect((await b.client.post(`/api/v1/rooms/${roomA.id}/archive`)).status).toBe(404);
    expect((await b.client.patch(`/api/v1/rooms/categories/${catA}`, { name: 'Piraté' })).status).toBe(404);
    expect((await room(b.client, catA, '999')).status).toBe(404);
    expect((await b.client.post('/api/v1/rooms/rates', { categoryId: catA, name: 'Intrus', startsOn: '2027-01-01', endsOn: '2027-01-31', nightlyRate: 1, weekendRate: null, minStay: 1, priority: 0, isActive: true })).status).toBeGreaterThanOrEqual(400);
    expect((await b.client.get(`/api/v1/rooms/pricing?categoryId=${catA}&checkIn=2027-07-10&checkOut=2027-07-12`)).status).toBe(404);
    expect((await a.client.get('/api/v1/rooms')).body.rooms[0].name).toBeNull();
    const [rate] = (await a.client.get('/api/v1/rooms/rates')).body.periods;
    expect((await b.client.delete(`/api/v1/rooms/rates/${rate.id}`)).status).toBe(404);
    expect((await a.client.get('/api/v1/rooms/rates')).body.periods).toHaveLength(1);
  });
});

describe('tarifs saisonniers et devis', () => {
  it('chiffre un séjour nuit par nuit : tarif de base, saison, week-end, tarif de la chambre ; séjour minimal', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client, 'STD', { baseRate: 100000 });
    await room(h.client, std, '101');
    await room(h.client, std, '102', { nightlyRate: 90000 });
    const [r101, r102] = await list(h.client);
    const period = { categoryId: std, name: 'Fêtes', startsOn: '2026-12-01', endsOn: '2026-12-31', nightlyRate: 200000, weekendRate: 260000, minStay: 2, priority: 0, isActive: true };
    expect((await h.client.post('/api/v1/rooms/rates', period)).status).toBe(201);

    // 30/11 (lundi) hors saison ; 1er/12 (mardi) en saison ; vendredi 4 et samedi 5 au tarif week-end
    const q1 = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2026-11-30&checkOut=2026-12-02`)).body;
    expect(q1.nights.map((n: any) => [n.night, n.rate, n.source])).toEqual([['2026-11-30', 100000, 'base'], ['2026-12-01', 200000, 'season']]);
    expect(q1.subtotal).toBe(300000);
    expect(q1.minStayRespected).toBe(true); // la nuit d'arrivée est hors période
    const q2 = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2026-12-03&checkOut=2026-12-07`)).body;
    expect(q2.nights.map((n: any) => n.rate)).toEqual([200000, 260000, 260000, 200000]);
    expect(q2).toMatchObject({ subtotal: 920000, minStay: 2 });
    const short = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2026-12-10&checkOut=2026-12-11`)).body;
    expect(short).toMatchObject({ minStay: 2, minStayRespected: false });
    // le tarif propre de la chambre remplace tout
    const own = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&roomId=${r102.id}&checkIn=2026-12-03&checkOut=2026-12-05`)).body;
    expect(own.nights.map((n: any) => [n.rate, n.source])).toEqual([[90000, 'room'], [90000, 'room']]);
    const noOverride = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&roomId=${r101.id}&checkIn=2026-12-03&checkOut=2026-12-04`)).body;
    expect(noOverride.nights[0].source).toBe('season');
    // dates invalides
    expect((await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2026-12-05&checkOut=2026-12-05`)).status).toBe(422);
    expect((await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2026-02-31&checkOut=2026-03-05`)).status).toBe(422);
  });

  it('une période plus courte et prioritaire l\'emporte ; une période désactivée est ignorée ; modification et suppression', async () => {
    const h = await registerHotel(t);
    const std = await category(h.client, 'STD', { baseRate: 100000 });
    const base = { categoryId: std, weekendRate: null, minStay: 1, isActive: true };
    const large = (await h.client.post('/api/v1/rooms/rates', { ...base, name: 'Haute saison', startsOn: '2027-07-01', endsOn: '2027-08-31', nightlyRate: 200000, priority: 0 })).body.id;
    await h.client.post('/api/v1/rooms/rates', { ...base, name: 'Pic du 14 juillet', startsOn: '2027-07-14', endsOn: '2027-07-16', nightlyRate: 350000, priority: 5 });
    const price = async (night: string) => (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=${night}&checkOut=${addDays(night, 1)}`)).body.nights[0];
    expect(await price('2027-07-15')).toMatchObject({ rate: 350000, periodName: 'Pic du 14 juillet' });
    expect(await price('2027-07-20')).toMatchObject({ rate: 200000, periodName: 'Haute saison' });
    expect((await h.client.patch(`/api/v1/rooms/rates/${large}`, { isActive: false })).status).toBe(200);
    expect(await price('2027-07-20')).toMatchObject({ rate: 100000, source: 'base' });
    expect((await h.client.patch(`/api/v1/rooms/rates/${large}`, { isActive: true, nightlyRate: 210000 })).body.updated.sort()).toEqual(['isActive', 'nightlyRate']);
    expect((await price('2027-07-20')).rate).toBe(210000);
    expect((await h.client.get('/api/v1/rooms/rates')).body.periods.map((p: any) => p.name)).toEqual(['Haute saison', 'Pic du 14 juillet']);
    expect((await h.client.delete(`/api/v1/rooms/rates/${large}`)).status).toBe(204);
    expect((await price('2027-07-20')).source).toBe('base');
    // une période ne peut pas finir avant son début
    expect((await h.client.post('/api/v1/rooms/rates', { ...base, name: 'Inversée', startsOn: '2027-09-10', endsOn: '2027-09-01', nightlyRate: 1, priority: 0 })).status).toBe(422);
  });

  it('modifier un tarif ne change JAMAIS le prix d\'une réservation déjà enregistrée (prix figé par nuit)', async () => {
    // Garantie portée par la table reservation_room_nights : le devis ne lit que les tarifs courants, la réservation (6c) copie les prix
    const h = await registerHotel(t);
    const std = await category(h.client, 'STD', { baseRate: 100000 });
    const before = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2027-03-01&checkOut=2027-03-02`)).body.subtotal;
    await h.client.patch(`/api/v1/rooms/categories/${std}`, { baseRate: 150000 });
    const after = (await h.client.get(`/api/v1/rooms/pricing?categoryId=${std}&checkIn=2027-03-01&checkOut=2027-03-02`)).body.subtotal;
    expect([before, after]).toEqual([100000, 150000]);
  });
});
