import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const TODAY = () => todayIn('Indian/Antananarivo');
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; tva: string; zebu: string; jus: string; table: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/restaurant/categories', { name: 'Plats' })).body.id;
  const [{ id: tva }] = await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, is_inclusive, applies_to) VALUES ($1, 'TVA', 'percentage', 2000, false, '{restaurant}') RETURNING id", [h.hotelId]);
  const zebu = (await h.client.post('/api/v1/restaurant/products', { categoryId: cat, name: 'Romazava', price: 15000, taxRuleId: tva })).body.id;
  const jus = (await h.client.post('/api/v1/restaurant/products', { categoryId: cat, name: 'Jus de fruit', price: 4000 })).body.id;
  const table = (await h.client.post('/api/v1/restaurant/tables', { label: 'T1', seats: 4 })).body.id;
  return { h, cat, tva, zebu, jus, table };
}
const open = (s: Setup, over: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  s.h.client.call('POST', '/api/v1/restaurant/orders', { tableId: s.table, covers: 2, items: [{ productId: s.zebu, quantity: 2 }, { productId: s.jus, quantity: 1 }], ...over }, headers);
const opened = async (s: Setup, over: Record<string, unknown> = {}) => {
  const res = await open(s, over);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; number: string; total: number };
};
const order = async (s: Setup, id: string) => (await s.h.client.get(`/api/v1/restaurant/orders/${id}`)).body;

describe('carte et tables', () => {
  it('catégories, plats, tables ; un plat retiré n\'est plus proposé ; noms uniques', async () => {
    const s = await setup();
    const menu = (await s.h.client.get('/api/v1/restaurant/menu')).body;
    expect(menu.categories.map((c: any) => c.name)).toEqual(['Plats']);
    expect(menu.products.map((p: any) => [p.name, p.price, p.taxName])).toEqual([['Jus de fruit', 4000, null], ['Romazava', 15000, 'TVA']]);
    expect(code(await s.h.client.post('/api/v1/restaurant/categories', { name: 'Plats' }))).toBe('menu_category_taken');
    expect(code(await s.h.client.post('/api/v1/restaurant/tables', { label: 'T1', seats: 2 }))).toBe('table_label_taken');
    await s.h.client.patch(`/api/v1/restaurant/products/${s.jus}`, { isActive: false });
    expect((await s.h.client.get('/api/v1/restaurant/menu')).body.products).toHaveLength(1);
    expect((await s.h.client.get('/api/v1/restaurant/menu?all=true')).body.products).toHaveLength(2);
    expect(code(await open(s, { items: [{ productId: s.jus, quantity: 1 }] }))).toBe('product_unavailable');
    expect((await s.h.client.patch(`/api/v1/restaurant/products/${s.zebu}`, { price: -1 })).status).toBe(422);
    expect((await s.h.client.post('/api/v1/restaurant/products', { name: 'X', price: 100 })).status).toBe(422);
  });
});

describe('commandes', () => {
  it('addition avec taxe, prix figés ; une table = une commande en cours ; ajouter, annuler une ligne, servir', async () => {
    const s = await setup();
    const o = await opened(s);
    expect(o.number).toMatch(/^CMD-\d{4}-0001$/);
    // 2 × 15 000 (+20 %) + 4 000 = 36 000 + 6 000 de TVA = 40 000
    expect(o.total).toBe(30000 + 6000 + 4000);
    let d = await order(s, o.id);
    expect(d).toMatchObject({ status: 'open', subtotal: 34000, tax: 6000, total: 40000, tableLabel: 'T1', covers: 2 });
    expect(d.items.map((i: any) => [i.name, i.quantity, i.unitPrice, i.taxAmount])).toEqual(expect.arrayContaining([['Romazava', 2, 15000, 6000], ['Jus de fruit', 1, 4000, 0]]));
    expect(code(await open(s))).toBe('table_busy');
    expect((await s.h.client.get('/api/v1/restaurant/tables')).body.tables[0]).toMatchObject({ busy: true, orderNumber: o.number, orderTotal: 40000 });
    // le prix de la carte change : l'addition existante ne bouge pas
    await s.h.client.patch(`/api/v1/restaurant/products/${s.zebu}`, { price: 99999, name: 'Romazava royal' });
    expect((await order(s, o.id)).total).toBe(40000);
    // ajout d'un plat au nouveau prix
    d = (await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/items`, { items: [{ productId: s.jus, quantity: 2, notes: 'sans glace' }] })).body;
    expect(d.total).toBe(48000);
    // ligne annulée
    const jusLine = d.items.find((i: any) => i.notes === 'sans glace');
    d = (await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/items/${jusLine.id}/cancel`)).body;
    expect(d.total).toBe(40000);
    expect(d.items.find((i: any) => i.id === jusLine.id).status).toBe('cancelled');
    d = (await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/serve`)).body;
    expect(d.status).toBe('served');
    expect(d.items.filter((i: any) => i.status === 'served')).toHaveLength(2);
    // un plat ajouté après service repasse la commande « en cours »
    expect((await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/items`, { items: [{ productId: s.jus, quantity: 1 }] })).body.status).toBe('open');
    expect((await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/items`, { items: [] })).status).toBe(422);
  });

  it('taxe incluse dans le prix : l\'addition reste le prix TTC', async () => {
    const s = await setup();
    const [{ id: incl }] = await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, is_inclusive, applies_to) VALUES ($1, 'TVA incluse', 'percentage', 2000, true, '{restaurant}') RETURNING id", [s.h.hotelId]);
    const plat = (await s.h.client.post('/api/v1/restaurant/products', { name: 'Zebu grillé', price: 12000, taxRuleId: incl })).body.id;
    const o = await opened(s, { items: [{ productId: plat, quantity: 3 }] });
    expect(o.total).toBe(36000);
    expect(await order(s, o.id)).toMatchObject({ subtotal: 30000, tax: 6000, total: 36000 });
    // la règle change ensuite : l'addition ne se réinterprète pas
    await q(t, 'UPDATE tax_rules SET is_inclusive = false, rate_bps = 500 WHERE id = $1', [incl]);
    const d = (await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/items`, { items: [{ productId: s.jus, quantity: 1 }] })).body;
    expect(d.total).toBe(40000);
  });

  it('création rejouable (Idempotency-Key) ; vente au comptoir sans table ; validation', async () => {
    const s = await setup();
    const k = { 'idempotency-key': 'cmd-1' };
    const [a, b] = await Promise.all([open(s, {}, k), open(s, {}, k)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect((await q(t, 'SELECT count(*)::int AS n FROM orders WHERE hotel_id = $1', [s.h.hotelId]))[0].n).toBe(1);
    expect((await open(s, { tableId: null })).status).toBe(201);
    expect((await open(s, { tableId: null })).status).toBe(201);
    expect((await open(s, { items: [{ productId: s.jus, quantity: 0 }] })).status).toBe(422);
    expect((await open(s, { covers: 0 })).status).toBe(422);
    expect((await open(s, { tableId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const list = (await s.h.client.get('/api/v1/restaurant/orders?status=active')).body;
    expect(list.total).toBe(3);
    expect(list.items[0]).toMatchObject({ currency: 'MGA' });
    expect((await s.h.client.get('/api/v1/restaurant/orders?q=T1')).body.total).toBe(1);
  });
});

describe('encaissement à table', () => {
  it('espèces ou Mobile Money (référence exigée), montant exact, une seule fois ; la table se libère', async () => {
    const s = await setup();
    const o = await opened(s);
    const pay = (body: Record<string, unknown>) => s.h.client.post(`/api/v1/restaurant/orders/${o.id}/pay`, { methodCode: 'cash', amount: 40000, ...body });
    expect(code(await pay({ amount: 39999 }))).toBe('order_amount_mismatch');
    expect(code(await pay({ methodCode: 'mvola' }))).toBe('payment_reference_required');
    const ok = await pay({ methodCode: 'mvola', reference: 'MP260101.9999.B12345' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'paid', paidWith: 'mvola' });
    expect(code(await pay({}))).toBe('order_not_editable');
    expect((await s.h.client.get('/api/v1/restaurant/tables')).body.tables[0].busy).toBe(false);
    expect((await open(s)).status).toBe(201);
    // le paiement apparaît au journal des encaissements ? (commande : hors note, donc hors journal des notes)
    const [p] = await q(t, 'SELECT order_id, folio_id, base_amount FROM payments WHERE hotel_id = $1', [s.h.hotelId]);
    expect(p).toMatchObject({ order_id: o.id, folio_id: null, base_amount: 40000 });
    const sum = (await s.h.client.get('/api/v1/restaurant/summary')).body;
    expect(sum).toMatchObject({ currency: 'MGA', sales: { count: 1, total: 40000, paidAtTable: 40000, postedToRooms: 0 }, active: { count: 1 } });
  });

  it('annulation avec motif ; une commande encaissée ne s\'annule plus', async () => {
    const s = await setup();
    const o = await opened(s);
    expect((await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/cancel`, { reason: 'x' })).status).toBe(422);
    const c = await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/cancel`, { reason: 'Client parti' });
    expect(c.body).toMatchObject({ status: 'cancelled' });
    expect(c.body.notes).toContain('Client parti');
    const o2 = await opened(s);
    await s.h.client.post(`/api/v1/restaurant/orders/${o2.id}/pay`, { methodCode: 'cash', amount: 40000 });
    expect(code(await s.h.client.post(`/api/v1/restaurant/orders/${o2.id}/cancel`, { reason: 'Trop tard' }))).toBe('order_not_editable');
    expect((await s.h.client.get('/api/v1/restaurant/summary')).body.cancelled).toBe(1);
  });
});

describe('imputation à la chambre', () => {
  async function inHouse(s: Setup) {
    const cat = (await s.h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
    await s.h.client.post('/api/v1/rooms', { categoryId: cat, number: '101', capacity: 2 });
    const guest = (await s.h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
    const res = await s.h.client.post('/api/v1/reservations', { guestId: guest, rooms: [{ categoryId: cat, checkIn: TODAY(), checkOut: addDays(TODAY(), 2), adults: 1 }] });
    await s.h.client.post('/api/v1/reception/check-in', { reservationId: res.body.id });
    const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.body.id]);
    return { reservationId: res.body.id as string, folio: f.id as string, guest, cat };
  }

  it('la commande devient une charge de la note, une seule fois ; refusée si le client n\'est pas en séjour', async () => {
    const s = await setup();
    const stay = await inHouse(s);
    expect((await s.h.client.get('/api/v1/restaurant/in-house')).body.guests).toEqual([{ reservationId: stay.reservationId, reference: expect.stringMatching(/^RES-/), roomNumber: '101', guestName: 'Hanitra Rakoto' }]);
    const o = await opened(s);
    const posted = await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/post-to-room`, { reservationId: stay.reservationId });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body).toMatchObject({ status: 'posted_to_room', folioId: stay.folio, guestName: 'Hanitra Rakoto' });
    const folio = (await s.h.client.get(`/api/v1/folios/${stay.folio}`)).body;
    const charge = folio.charges.find((c: any) => c.kind === 'restaurant');
    expect(charge).toMatchObject({ description: `Restaurant ${o.number}`, amount: 34000, taxAmount: 6000, source: 'restaurant_order' });
    expect(folio.chargesTotal).toBe(200000 + 40000);
    // pas deux fois
    expect(code(await s.h.client.post(`/api/v1/restaurant/orders/${o.id}/post-to-room`, { reservationId: stay.reservationId }))).toBe('order_not_editable');
    // l'hébergement ET le restaurant se facturent ensemble
    const inv = (await s.h.client.post(`/api/v1/folios/${stay.folio}/invoices`, {})).body;
    expect(inv.total).toBe(240000);
    // client non arrivé / inconnu
    const future = (await s.h.client.post('/api/v1/reservations', { guestId: stay.guest, rooms: [{ categoryId: stay.cat, checkIn: addDays(TODAY(), 5), checkOut: addDays(TODAY(), 6), adults: 1 }] })).body.id;
    const o2 = await opened(s);
    expect(code(await s.h.client.post(`/api/v1/restaurant/orders/${o2.id}/post-to-room`, { reservationId: future }))).toBe('order_target_not_in_house');
    expect(code(await s.h.client.post(`/api/v1/restaurant/orders/${o2.id}/post-to-room`, { reservationId: '00000000-0000-4000-8000-000000000000' }))).toBe('order_target_not_in_house');
    expect((await order(s, o2.id)).status).toBe('open');
  });
});

describe('droits, formule, isolation', () => {
  it('rôles : le responsable restaurant gère carte et commandes ; la réception ne voit rien ; la formule Starter est refusée', async () => {
    const s = await setup();
    const resto = await addStaff(t, s.h.hotelId, 'restaurant_manager');
    const recep = await addStaff(t, s.h.hotelId, 'receptionist');
    expect((await resto.client.post('/api/v1/restaurant/products', { name: 'Café', price: 2000 })).status).toBe(201);
    expect((await resto.client.post('/api/v1/restaurant/orders', { covers: 1, items: [{ productId: s.jus, quantity: 1 }] })).status).toBe(201);
    expect((await recep.client.get('/api/v1/restaurant/menu')).status).toBe(403);
    expect((await recep.client.post('/api/v1/restaurant/orders', { covers: 1, items: [{ productId: s.jus, quantity: 1 }] })).status).toBe(403);
    const hk = await addStaff(t, s.h.hotelId, 'hk_manager');
    expect((await hk.client.get('/api/v1/restaurant/tables')).status).toBe(403);
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [s.h.hotelId]);
    const refused = await s.h.client.get('/api/v1/restaurant/menu');
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe('feature_not_in_plan');
  });

  it('un autre établissement ne voit ni ne touche rien', async () => {
    const a = await setup();
    const o = await opened(a);
    const b = await setup();
    expect((await b.h.client.get(`/api/v1/restaurant/orders/${o.id}`)).status).toBe(404);
    expect((await b.h.client.post(`/api/v1/restaurant/orders/${o.id}/serve`)).status).toBe(404);
    expect((await b.h.client.post(`/api/v1/restaurant/orders/${o.id}/pay`, { methodCode: 'cash', amount: 40000 })).status).toBe(404);
    expect(code(await open(b, { items: [{ productId: a.zebu, quantity: 1 }] }))).toBe('product_unavailable');
    expect((await b.h.client.patch(`/api/v1/restaurant/products/${a.zebu}`, { price: 1 })).status).toBe(404);
    expect((await b.h.client.get('/api/v1/restaurant/orders')).body.total).toBe(0);
    expect((await new Client(t).get('/api/v1/restaurant/menu')).status).toBe(401);
  });
});
