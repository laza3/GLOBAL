import { addDays, todayIn } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const TODAY = () => todayIn('Indian/Antananarivo');
const code = (res: { body: any }) => res.body?.error?.code;

async function setup() {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/finances/categories', { name: 'Électricité', kind: 'overhead' })).body.id as string;
  const cat2 = (await h.client.post('/api/v1/finances/categories', { name: 'Fournitures' })).body.id as string;
  return { h, cat, cat2 };
}
const expense = (c: Client, categoryId: string, over: Record<string, unknown> = {}) =>
  c.post('/api/v1/finances/expenses', { categoryId, description: 'Facture JIRAMA', supplier: 'JIRAMA', amount: 250000, incurredOn: TODAY(), paidOn: null, methodCode: null, ...over });

describe('catégories et dépenses', () => {
  it('catégories uniques ; dépenses : saisie, validation, filtres, total de la sélection, à payer', async () => {
    const { h, cat, cat2 } = await setup();
    expect(code(await h.client.post('/api/v1/finances/categories', { name: 'Électricité' }))).toBe('expense_category_taken');
    expect((await h.client.get('/api/v1/finances/categories')).body.categories.map((c: any) => `${c.name}:${c.kind}`).sort()).toEqual(['Fournitures:expense', 'Électricité:overhead']);
    const a = await expense(h.client, cat);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    await expense(h.client, cat2, { description: 'Savons', supplier: 'Grossiste', amount: 40000, incurredOn: addDays(TODAY(), -3), paidOn: addDays(TODAY(), -3), methodCode: 'cash' });
    await expense(h.client, cat2, { description: '=SOMME(A1)', supplier: null, amount: 1000, incurredOn: addDays(TODAY(), -40) });
    expect((await expense(h.client, cat, { amount: 0 })).status).toBe(422);
    expect((await expense(h.client, cat, { incurredOn: '2026-02-30' })).status).toBe(422);
    expect((await expense(h.client, cat, { paidOn: addDays(TODAY(), -1) })).status).toBe(422);
    expect((await expense(h.client, cat, { methodCode: 'inconnu', paidOn: TODAY() })).status).toBe(422);
    expect((await expense(h.client, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const all = (await h.client.get('/api/v1/finances/expenses')).body;
    expect(all).toMatchObject({ total: 3, sum: 291000, unpaidSum: 251000 });
    expect(all.items[0]).toMatchObject({ description: 'Facture JIRAMA', categoryName: 'Électricité', currency: 'MGA', paidOn: null });
    expect((await h.client.get(`/api/v1/finances/expenses?from=${addDays(TODAY(), -5)}`)).body).toMatchObject({ total: 2, sum: 290000 });
    expect((await h.client.get(`/api/v1/finances/expenses?categoryId=${cat2}`)).body.total).toBe(2);
    expect((await h.client.get('/api/v1/finances/expenses?unpaid=true')).body.total).toBe(2);
    expect((await h.client.get('/api/v1/finances/expenses?q=jirama')).body.total).toBe(1);
    expect((await h.client.get('/api/v1/finances/expenses?pageSize=1&page=3')).body.items).toHaveLength(1);
  });

  it('modifier (marquer payée), supprimer avec trace ; inconnu → 404', async () => {
    const { h, cat } = await setup();
    const e = (await expense(h.client, cat)).body.id;
    expect((await h.client.patch(`/api/v1/finances/expenses/${e}`, { paidOn: TODAY(), methodCode: 'bank_transfer' })).status).toBe(200);
    expect((await h.client.get('/api/v1/finances/expenses')).body.items[0]).toMatchObject({ paidOn: TODAY(), methodCode: 'bank_transfer' });
    expect((await h.client.patch(`/api/v1/finances/expenses/${e}`, {})).status).toBe(422);
    expect((await h.client.delete(`/api/v1/finances/expenses/${e}`)).status).toBe(200);
    expect(code(await h.client.delete(`/api/v1/finances/expenses/${e}`))).toBe('expense_not_found');
    expect(code(await h.client.patch(`/api/v1/finances/expenses/${e}`, { amount: 5 }))).toBe('expense_not_found');
    const log = await q(t, "SELECT summary FROM audit_logs WHERE hotel_id = $1 AND action = 'finance.expense_deleted'", [h.hotelId]);
    expect(log[0].summary).toContain('Facture JIRAMA');
  });
});

describe('synthèse', () => {
  it('encaissé par moyen (notes et restaurant, remboursements déduits), dépenses par catégorie, résultat, créances', async () => {
    const { h, cat, cat2 } = await setup();
    // séjour de 300 000 payé 200 000 en espèces puis 100 000 en MVola ; 50 000 remboursés
    const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto' })).body.id;
    const rc = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
    await h.client.post('/api/v1/rooms', { categoryId: rc, number: '101', capacity: 2 });
    const res = await h.client.post('/api/v1/reservations', { guestId: guest, rooms: [{ categoryId: rc, checkIn: addDays(TODAY(), 10), checkOut: addDays(TODAY(), 13), adults: 1 }] });
    const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.body.id]);
    const cash = (await h.client.post(`/api/v1/folios/${f.id}/payments`, { methodCode: 'cash', amount: 200000, currency: 'MGA' })).body.id;
    await h.client.post(`/api/v1/folios/${f.id}/payments`, { methodCode: 'mvola', amount: 100000, currency: 'MGA', reference: 'MP1' });
    await h.client.post(`/api/v1/payments/${cash}/refund`, { amount: 50000, reason: 'Geste' });
    // une commande de restaurant encaissée à table
    const prod = (await h.client.post('/api/v1/restaurant/products', { name: 'Plat', price: 20000 })).body.id;
    const order = (await h.client.post('/api/v1/restaurant/orders', { covers: 1, items: [{ productId: prod, quantity: 1 }] })).body.id;
    await h.client.post(`/api/v1/restaurant/orders/${order}/pay`, { methodCode: 'cash', amount: 20000 });
    // dépenses : 250 000 payée, 40 000 à payer
    await expense(h.client, cat, { paidOn: TODAY(), methodCode: 'cash' });
    await expense(h.client, cat2, { description: 'Savons', amount: 40000 });
    const s = (await h.client.get('/api/v1/finances/summary')).body;
    expect(s).toMatchObject({ currency: 'MGA', to: TODAY() });
    expect(s.from).toBe(`${TODAY().slice(0, 7)}-01`);
    expect(s.collected).toMatchObject({ gross: 320000, refunded: 50000, net: 270000 });
    expect(s.collected.byMethod.map((m: any) => [m.code, m.collected, m.refunded])).toEqual([['cash', 220000, 50000], ['mvola', 100000, 0]]);
    expect(s.expenses).toMatchObject({ total: 290000, paid: 250000, unpaid: 40000 });
    expect(s.expenses.byCategory.map((c: any) => [c.name, c.total, c.paid])).toEqual([['Électricité', 250000, 250000], ['Fournitures', 40000, 0]]);
    expect(s.cashResult).toBe(270000 - 250000);
    expect(s.receivables).toEqual({ total: 300000 - 250000, folios: 1 });
    expect(s.payables).toEqual({ total: 40000, count: 1 });
    expect(s.daily.at(-1)).toMatchObject({ day: TODAY(), collected: 270000, spent: 290000 });
    expect(s.daily).toHaveLength(Number(TODAY().slice(8)));
    // période sans activité
    const empty = (await h.client.get(`/api/v1/finances/summary?from=${addDays(TODAY(), -400)}&to=${addDays(TODAY(), -380)}`)).body;
    expect(empty).toMatchObject({ cashResult: 0, collected: { net: 0 }, expenses: { total: 0 } });
    expect((await h.client.get(`/api/v1/finances/summary?from=${TODAY()}&to=${addDays(TODAY(), -1)}`)).status).toBe(422);
    expect((await h.client.get(`/api/v1/finances/summary?from=${addDays(TODAY(), -500)}&to=${TODAY()}`)).status).toBe(422);
  });
});

describe('export, droits, formule, isolation', () => {
  it('export CSV : BOM, séparateur ;, formule neutralisée, journalisé ; refusé sans la formule exports', async () => {
    const { h, cat } = await setup();
    await expense(h.client, cat, { description: '=CMD|calc', supplier: 'Dupont; fils' });
    const res = await h.client.get('/api/v1/finances/expenses.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('﻿Date;Catégorie;Description')).toBe(true);
    expect(res.body).toContain("'=CMD|calc");
    expect(res.body).toContain('"Dupont; fils"');
    expect(await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'finance.exported'", [h.hotelId])).toEqual([{ n: 1 }]);
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [h.hotelId]);
    expect(code(await h.client.get('/api/v1/finances/expenses.csv'))).toBe('feature_not_in_plan');
    expect(code(await h.client.get('/api/v1/finances/summary'))).toBe('feature_not_in_plan');
  });

  it('le comptable gère les finances ; la réception n\'y a pas accès ; un autre établissement ne voit rien', async () => {
    const { h, cat } = await setup();
    const acc = await addStaff(t, h.hotelId, 'accountant');
    expect((await expense(acc.client, cat, { description: 'Par le comptable' })).status).toBe(201);
    const recep = await addStaff(t, h.hotelId, 'receptionist');
    expect((await recep.client.get('/api/v1/finances/summary')).status).toBe(403);
    expect((await expense(recep.client, cat)).status).toBe(403);
    const other = await registerHotel(t);
    expect((await other.client.get('/api/v1/finances/expenses')).body.total).toBe(0);
    const e = (await h.client.get('/api/v1/finances/expenses')).body.items[0].id;
    expect(code(await other.client.delete(`/api/v1/finances/expenses/${e}`))).toBe('expense_not_found');
    expect((await other.client.post('/api/v1/finances/expenses', { categoryId: cat, description: 'Intrus', supplier: null, amount: 10, incurredOn: TODAY(), paidOn: null, methodCode: null })).status).toBe(404);
    expect((await new Client(t).get('/api/v1/finances/summary')).status).toBe(401);
  });
});
