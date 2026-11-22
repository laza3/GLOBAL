import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '@hmp/shared';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const guest = (c: Client, over: Record<string, unknown> = {}) => c.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto', ...over });
const created = async (c: Client, over: Record<string, unknown> = {}) => {
  const res = await guest(c, over);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};

/** Séjour minimal inséré directement (le module Réservations viendra ensuite) pour tester l'historique et les gardes. */
async function stay(h: Registered, guestId: string, status: string, over: { checkIn?: string; checkOut?: string; total?: number } = {}) {
  const [{ id: categoryId }] = await q(t, 'SELECT id FROM room_categories WHERE hotel_id = $1 LIMIT 1', [h.hotelId]);
  const [room] = await q(t, 'SELECT id FROM rooms WHERE hotel_id = $1 LIMIT 1', [h.hotelId]);
  const ref = `T-${Math.random().toString(36).slice(2, 8)}`;
  const total = over.total ?? 300000;
  const [{ id }] = await q(t, "INSERT INTO reservations (hotel_id, reference, guest_id, status, currency, subtotal_amount, total_amount, cancelled_at) VALUES ($1, $2, $3, $4, 'MGA', $5, $5, CASE WHEN $4 = 'cancelled' THEN now() END) RETURNING id", [h.hotelId, ref, guestId, status, total]);
  const needsRoom = ['checked_in', 'checked_out'].includes(status);
  await q(t, `INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, status, check_in, check_out, actual_check_in, actual_check_out)
              VALUES ($1, $2, $3, $4, $5, $6, $7, ${needsRoom ? 'now()' : 'NULL'}, ${status === 'checked_out' ? 'now()' : 'NULL'})`,
    [h.hotelId, id, categoryId, needsRoom ? room.id : null, status, over.checkIn ?? '2030-01-10', over.checkOut ?? '2030-01-13']);
  return id as string;
}
async function withRoom(h: Registered) {
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
  await h.client.post('/api/v1/rooms', { categoryId: cat, number: '101' });
}

describe('création et recherche', () => {
  it('crée, normalise le téléphone, cherche par nom, e-mail et téléphone sous toutes ses formes', async () => {
    const h = await registerHotel(t);
    const id = await created(h.client, { email: 'Hanitra@Example.test', phone: '034 00 000 00', city: 'Nosy Be', country: 'MG', tags: ['famille'], preferences: { chambre: 'calme' } });
    const [row] = await q(t, 'SELECT phone_normalized, email::text AS email FROM guests WHERE id = $1', [id]);
    expect(row).toEqual({ phone_normalized: '261340000000', email: 'Hanitra@Example.test' });
    const find = async (query: string) => (await h.client.get(`/api/v1/guests?q=${encodeURIComponent(query)}`)).body.items.map((g: any) => g.id);
    for (const query of ['rakoto', 'HANITRA', 'hanitra rakoto', 'example.test', '+261 34 00 000 00', '0340000000', '34 00 000']) expect(await find(query), query).toEqual([id]);
    expect(await find('inconnu')).toEqual([]);
    const all = (await h.client.get('/api/v1/guests')).body;
    expect(all).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(all.items[0]).toMatchObject({ firstName: 'Hanitra', lastName: 'Rakoto', city: 'Nosy Be', isVip: false, tags: ['famille'], staysCount: 0 });
  });

  it('valide les champs ; un même e-mail est refusé quelle que soit la casse ; un autre hôtel peut le réutiliser', async () => {
    const h = await registerHotel(t);
    expect((await guest(h.client, { firstName: '' })).status).toBe(422);
    expect((await guest(h.client, { email: 'pas-un-email' })).status).toBe(422);
    expect((await guest(h.client, { country: 'madagascar' })).status).toBe(422);
    expect((await guest(h.client, { birthDate: '2999-01-01' })).status).toBe(422);
    expect((await guest(h.client, { birthDate: '2026-02-31' })).status).toBe(422);
    await created(h.client, { email: 'a@e.test', lastName: 'Un' });
    const dup = await guest(h.client, { email: 'A@E.TEST', lastName: 'Deux', confirmDuplicate: true });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('guest_email_taken'); // même avec confirmation : l'e-mail est unique
    const other = await registerHotel(t);
    expect((await guest(other.client, { email: 'a@e.test' })).status).toBe(201);
  });

  it('signale les doublons probables (téléphone, nom) et laisse confirmer ; /duplicates les liste avant la saisie', async () => {
    const h = await registerHotel(t);
    const first = await created(h.client, { phone: '+261 34 11 111 11', birthDate: '1990-05-05' });
    const same = await guest(h.client, { firstName: 'Autre', lastName: 'Personne', phone: '034 11 111 11' });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('possible_duplicate');
    expect(same.body.error.details[0]).toMatchObject({ id: first, reason: 'phone' });
    const sameName = await guest(h.client, { firstName: 'hanitra', lastName: 'RAKOTO' });
    expect(sameName.body.error.code).toBe('possible_duplicate');
    expect(sameName.body.error.details[0].reason).toBe('name');
    // une date de naissance différente écarte l'homonyme
    expect((await guest(h.client, { firstName: 'Hanitra', lastName: 'Rakoto', birthDate: '1975-01-01' })).status).toBe(201);
    const confirmed = await guest(h.client, { firstName: 'Autre', lastName: 'Personne', phone: '034 11 111 11', confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
    const preview = (await h.client.get('/api/v1/guests/duplicates?firstName=Hanitra&lastName=Rakoto&phone=0341111111')).body.candidates;
    expect(preview.length).toBeGreaterThanOrEqual(1);
    expect((await h.client.get(`/api/v1/guests/duplicates?phone=0341111111&excludeId=${first}`)).body.candidates.map((c: any) => c.id)).not.toContain(first);
  });

  it('pagination, tri, VIP, étiquette', async () => {
    const h = await registerHotel(t);
    for (const [i, n] of ['Zafy', 'Andry', 'Miora'].entries()) await created(h.client, { firstName: n, lastName: n, isVip: i === 1, tags: i === 2 ? ['agence'] : [] });
    const page1 = (await h.client.get('/api/v1/guests?pageSize=2')).body;
    expect(page1.items.map((g: any) => g.lastName)).toEqual(['Andry', 'Miora']);
    expect(page1.total).toBe(3);
    expect((await h.client.get('/api/v1/guests?pageSize=2&page=2')).body.items.map((g: any) => g.lastName)).toEqual(['Zafy']);
    expect((await h.client.get('/api/v1/guests?vip=true')).body.items.map((g: any) => g.lastName)).toEqual(['Andry']);
    expect((await h.client.get('/api/v1/guests?tag=agence')).body.items.map((g: any) => g.lastName)).toEqual(['Miora']);
    expect((await h.client.get('/api/v1/guests?sort=recent')).body.items[0].lastName).toBe('Miora');
    expect((await h.client.get('/api/v1/guests?pageSize=500')).status).toBe(422);
  });
});

describe('fiche, modification, notes', () => {
  it('modifie avec contrôle de version et recalcule le téléphone normalisé ; ignore les champs hors liste blanche', async () => {
    const h = await registerHotel(t);
    const id = await created(h.client, { phone: '034 00 000 00' });
    const { guest: g1 } = (await h.client.get(`/api/v1/guests/${id}`)).body;
    expect(g1.version).toBe(1);
    const other = await registerHotel(t);
    const res = await h.client.patch(`/api/v1/guests/${id}`, { version: 1, phone: '+33 6 12 34 56 78', isVip: true, hotel_id: other.hotelId, anonymized_at: '2020-01-01' });
    expect(res.body.updated.sort()).toEqual(['isVip', 'phone']);
    const [row] = await q(t, 'SELECT phone_normalized, hotel_id, anonymized_at FROM guests WHERE id = $1', [id]);
    expect(row).toMatchObject({ phone_normalized: '33612345678', hotel_id: h.hotelId, anonymized_at: null });
    expect((await h.client.patch(`/api/v1/guests/${id}`, { version: 1, city: 'Obsolète' })).body.error.code).toBe('version_conflict');
    expect((await h.client.patch(`/api/v1/guests/${id}`, { version: 2, phone: null })).status).toBe(200);
    expect((await q(t, 'SELECT phone_normalized FROM guests WHERE id = $1', [id]))[0].phone_normalized).toBeNull();
  });

  it('les notes sont en ajout seul, signées, et la fiche réunit coordonnées, notes, pièces et séjours', async () => {
    const h = await registerHotel(t);
    await withRoom(h);
    const id = await created(h.client);
    expect((await h.client.post(`/api/v1/guests/${id}/notes`, { body: 'Allergique aux fruits de mer' })).status).toBe(201);
    expect((await h.client.post(`/api/v1/guests/${id}/notes`, { body: '   ' })).status).toBe(422);
    await stay(h, id, 'checked_out', { checkIn: '2029-05-01', checkOut: '2029-05-04', total: 450000 });
    await stay(h, id, 'confirmed', { checkIn: '2030-02-01', checkOut: '2030-02-03' });
    await stay(h, id, 'cancelled');
    const d = (await h.client.get(`/api/v1/guests/${id}`)).body;
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]).toMatchObject({ body: 'Allergique aux fruits de mer', author: expect.any(String) });
    expect(d.stays).toHaveLength(3);
    expect(d.stays[0].status).toBe('confirmed'); // la plus récente d'abord
    expect(d.stats).toEqual({ stays: 1, nights: 3, spentByCurrency: [{ currency: 'MGA', amount: 450000 }] });
    expect((await h.client.get('/api/v1/guests?q=rakoto')).body.items[0].staysCount).toBe(1);
    // aucune route ne permet de modifier ou supprimer une note
    expect((await h.client.patch(`/api/v1/guests/${id}/notes/${d.notes[0].id}`, { body: 'x' })).status).toBe(404);
    expect((await h.client.delete(`/api/v1/guests/${id}/notes/${d.notes[0].id}`)).status).toBe(404);
    expect((await h.client.get('/api/v1/guests/00000000-0000-0000-0000-000000000000')).body.error.code).toBe('guest_not_found');
  });
});

describe('pièces d\'identité', () => {
  it('le numéro est chiffré en base, masqué dans la fiche, lisible seulement avec la permission dédiée et chaque lecture est journalisée', async () => {
    const h = await registerHotel(t);
    const id = await created(h.client);
    const doc = await h.client.post(`/api/v1/guests/${id}/documents`, { docType: 'passport', number: 'PA1234567', issuingCountry: 'MG', expiresOn: '2031-01-01' });
    expect(doc.status).toBe(201);
    const [row] = await q(t, 'SELECT number_enc, number_last4, key_version FROM guest_documents WHERE id = $1', [doc.body.id]);
    expect(row.number_enc.toString('utf8')).not.toContain('PA1234567');
    expect(row.number_last4).toBe('4567');
    const detail = (await h.client.get(`/api/v1/guests/${id}`)).body;
    expect(detail.documents[0]).toEqual({ id: doc.body.id, docType: 'passport', last4: '4567', issuingCountry: 'MG', expiresOn: '2031-01-01', createdAt: expect.any(String) });
    expect(JSON.stringify(detail)).not.toContain('PA1234567');

    const reception = await addStaff(t, h.hotelId, 'receptionist');
    expect((await reception.client.get(`/api/v1/guests/${id}/documents/${doc.body.id}/reveal`)).status).toBe(403);
    const before = (await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'guest.document_revealed'", [h.hotelId]))[0].n;
    const shown = await h.client.get(`/api/v1/guests/${id}/documents/${doc.body.id}/reveal`);
    expect(shown.body).toEqual({ number: 'PA1234567' });
    expect(shown.headers['cache-control']).toBe('no-store');
    const after = await q(t, "SELECT summary, after_data::text AS d FROM audit_logs WHERE hotel_id = $1 AND action = 'guest.document_revealed'", [h.hotelId]);
    expect(after).toHaveLength(before + 1);
    expect(JSON.stringify(after)).not.toContain('PA1234567'); // le journal ne contient jamais le numéro

    expect((await h.client.delete(`/api/v1/guests/${id}/documents/${doc.body.id}`)).status).toBe(204);
    expect((await h.client.get(`/api/v1/guests/${id}/documents/${doc.body.id}/reveal`)).status).toBe(404);
    expect((await h.client.post(`/api/v1/guests/${id}/documents`, { docType: 'passport', number: 'x' })).status).toBe(422);
  });
});

describe('fusion, anonymisation, export', () => {
  it('fusionne un doublon : historique réuni, l\'ancienne fiche disparaît des recherches, pas de cycle', async () => {
    const h = await registerHotel(t);
    await withRoom(h);
    const keep = await created(h.client, { firstName: 'Jean', lastName: 'Martin', email: 'jean@e.test' });
    const dup = await created(h.client, { firstName: 'J.', lastName: 'Martin', phone: '034 22 222 22' });
    await h.client.post(`/api/v1/guests/${dup}/notes`, { body: 'Note de la fiche en double' });
    await stay(h, dup, 'checked_out');
    expect((await h.client.post(`/api/v1/guests/${keep}/merge`, { intoId: keep })).status).toBe(409);
    expect((await h.client.post(`/api/v1/guests/${dup}/merge`, { intoId: keep })).status).toBe(200);
    const merged = (await h.client.get(`/api/v1/guests/${keep}`)).body;
    expect(merged.mergedCount).toBe(1);
    expect(merged.stays).toHaveLength(1);
    expect(merged.notes.map((n: any) => n.body)).toEqual(['Note de la fiche en double']);
    expect((await h.client.get('/api/v1/guests?q=Martin')).body.items.map((g: any) => g.id)).toEqual([keep]);
    expect((await h.client.post(`/api/v1/guests/${keep}/merge`, { intoId: dup })).body.error.code).toBe('invalid_state'); // une fiche déjà absorbée ne peut plus recevoir
    expect((await h.client.patch(`/api/v1/guests/${dup}`, { version: 1, city: 'X' })).body.error.code).toBe('invalid_state');
  });

  it('anonymise : les données personnelles, pièces et notes disparaissent ; refusé tant qu\'un séjour est à venir', async () => {
    const h = await registerHotel(t);
    await withRoom(h);
    const id = await created(h.client, { email: 'efface@e.test', phone: '034 33 333 33', address: 'Rue X', birthDate: '1980-01-01', isVip: true, tags: ['vip'] });
    await h.client.post(`/api/v1/guests/${id}/notes`, { body: 'Information personnelle' });
    await h.client.post(`/api/v1/guests/${id}/documents`, { docType: 'national_id', number: 'CIN123456' });
    const future = await stay(h, id, 'confirmed');
    expect((await h.client.post(`/api/v1/guests/${id}/anonymize`, {})).status).toBe(422); // confirmation exigée
    expect((await h.client.post(`/api/v1/guests/${id}/anonymize`, { confirm: true })).body.error.code).toBe('guest_has_active_stays');
    await q(t, "UPDATE reservations SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [future]);
    await q(t, "UPDATE reservation_rooms SET status = 'cancelled' WHERE reservation_id = $1", [future]);
    expect((await h.client.post(`/api/v1/guests/${id}/anonymize`, { confirm: true })).status).toBe(200);
    const [g] = await q(t, 'SELECT * FROM guests WHERE id = $1', [id]);
    expect(g).toMatchObject({ first_name: 'Client', last_name: 'anonymisé', email: null, phone: null, phone_normalized: null, birth_date: null, address: null, is_vip: false, tags: [] });
    expect(g.anonymized_at).not.toBeNull();
    expect((await q(t, 'SELECT count(*)::int AS n FROM guest_documents WHERE guest_id = $1', [id]))[0].n).toBe(0);
    expect((await q(t, 'SELECT body FROM guest_notes WHERE guest_id = $1', [id]))[0].body).toBe('[supprimé]');
    expect((await h.client.get('/api/v1/guests?q=efface')).body.items).toEqual([]);
    expect((await h.client.get('/api/v1/guests')).body.items.map((x: any) => x.id)).not.toContain(id);
    expect((await h.client.patch(`/api/v1/guests/${id}`, { version: 1, city: 'X' })).body.error.code).toBe('invalid_state');
    // l'adresse e-mail est de nouveau disponible
    expect((await guest(h.client, { firstName: 'Nouveau', lastName: 'Client', email: 'efface@e.test' })).status).toBe(201);
    expect((await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'guest.anonymized'", [h.hotelId]))[0].n).toBe(1);
  });

  it('l\'export CSV exige sa permission, exclut les fiches anonymisées et fusionnées, neutralise les formules, et est journalisé', async () => {
    const h = await registerHotel(t);
    await created(h.client, { firstName: '=CMD()', lastName: 'Piège', email: 'piege@e.test' });
    await created(h.client, { firstName: 'Zoé', lastName: 'Éloïse', city: 'Tamatave; centre' });
    const reception = await addStaff(t, h.hotelId, 'receptionist');
    expect((await reception.client.get('/api/v1/guests/export.csv')).status).toBe(403);
    const res = await h.client.get('/api/v1/guests/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="clients-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = res.body as string;
    expect(csv.startsWith('﻿Prénom;Nom;')).toBe(true);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('"Tamatave; centre"');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect((await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'guest.exported'", [h.hotelId]))[0].n).toBe(1);
  });
});

describe('isolation et droits', () => {
  it('un établissement ne voit, ne modifie ni ne lit rien des clients d\'un autre ; la lecture seule suffit pour consulter', async () => {
    const a = await registerHotel(t);
    const b = await registerHotel(t);
    const id = await created(a.client, { email: 'secret@a.test' });
    const doc = (await a.client.post(`/api/v1/guests/${id}/documents`, { docType: 'passport', number: 'PASS99999' })).body.id;
    expect((await b.client.get('/api/v1/guests')).body.total).toBe(0);
    expect((await b.client.get(`/api/v1/guests/${id}`)).status).toBe(404);
    expect((await b.client.patch(`/api/v1/guests/${id}`, { version: 1, city: 'Piraté' })).status).toBe(404);
    expect((await b.client.post(`/api/v1/guests/${id}/notes`, { body: 'x' })).status).toBe(404);
    expect((await b.client.get(`/api/v1/guests/${id}/documents/${doc}/reveal`)).status).toBe(404);
    expect((await b.client.post(`/api/v1/guests/${id}/anonymize`, { confirm: true })).body.error.code).toBe('guest_not_found');
    expect((await b.client.post(`/api/v1/guests/${id}/merge`, { intoId: await created(b.client, { lastName: 'B' }) })).status).toBe(404);
    expect((await b.client.get('/api/v1/guests/duplicates?email=secret@a.test')).body.candidates).toEqual([]);
    expect((await a.client.get(`/api/v1/guests/${id}`)).body.guest.email).toBe('secret@a.test');

    const hk = await addStaff(t, a.hotelId, 'hk_staff');
    expect((await hk.client.get('/api/v1/guests')).status).toBe(403); // le ménage n'a pas accès au fichier clients
    const accountant = await addStaff(t, a.hotelId, 'accountant');
    expect((await accountant.client.get('/api/v1/guests')).status).toBe(200);
    expect((await accountant.client.post('/api/v1/guests', { firstName: 'X', lastName: 'Y' })).status).toBe(403);
    expect((await new Client(t).get('/api/v1/guests')).status).toBe(401);
    expect((await q(t, 'SELECT terms_version FROM users WHERE id = $1', [a.userId]))[0].terms_version).toBe(LEGAL_VERSION);
  });
});
