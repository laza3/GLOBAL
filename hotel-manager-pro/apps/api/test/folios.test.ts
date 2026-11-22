import { addDays } from '@hmp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addStaff, createTestApp, q, registerHotel, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const D = (n: number) => addDays('2030-03-04', n);
const code = (res: { body: any }) => res.body?.error?.code;

interface Setup { h: Registered; cat: string; r101: string; r102: string; guest: string }
async function setup(): Promise<Setup> {
  const h = await registerHotel(t);
  const cat = (await h.client.post('/api/v1/rooms/categories', { code: 'STD', name: 'Standard', baseRate: 100000 })).body.id;
  const mk = async (n: string) => (await h.client.post('/api/v1/rooms', { categoryId: cat, number: n, capacity: 2 })).body.id as string;
  const guest = (await h.client.post('/api/v1/guests', { firstName: 'Hanitra', lastName: 'Rakoto', email: 'h@client.test' })).body.id;
  return { h, cat, r101: await mk('101'), r102: await mk('102'), guest };
}
/** Réservation de 3 nuits (300 000 Ar) et identifiant de sa note. */
async function stay(s: Setup, over: Record<string, unknown> = {}, i = 0, o = 3) {
  const res = await s.h.client.post('/api/v1/reservations', { guestId: s.guest, rooms: [{ categoryId: s.cat, checkIn: D(i), checkOut: D(o), adults: 2 }], ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [f] = await q(t, 'SELECT id FROM folios WHERE reservation_id = $1', [res.body.id]);
  return { id: res.body.id as string, folio: f.id as string };
}
const folio = async (s: Setup, id: string) => (await s.h.client.get(`/api/v1/folios/${id}`)).body;
const pay = (c: Client, folioId: string, over: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  c.call('POST', `/api/v1/folios/${folioId}/payments`, { methodCode: 'cash', amount: 100000, currency: 'MGA', ...over }, headers);

describe('note du client et charge d\'hébergement', () => {
  it('la charge suit la réservation : création, prolongation, remise, annulation', async () => {
    const s = await setup();
    const r = await stay(s);
    let f = await folio(s, r.folio);
    expect(f).toMatchObject({ currency: 'MGA', reservationReference: expect.stringMatching(/^RES-/), guestName: 'Hanitra Rakoto', chargesTotal: 300000, paymentsTotal: 0, balanceDue: 300000, paymentStatus: 'unpaid', status: 'open' });
    expect(f.charges).toHaveLength(1);
    expect(f.charges[0]).toMatchObject({ kind: 'room', source: 'reservation', amount: 300000, taxAmount: 0 });
    // prolongation d'une nuit
    const d = (await s.h.client.get(`/api/v1/reservations/${r.id}`)).body;
    await s.h.client.patch(`/api/v1/reservations/${r.id}/rooms/${d.rooms[0].id}`, { checkOut: D(4), version: d.version });
    f = await folio(s, r.folio);
    expect(f.charges.filter((c: any) => !c.voidedAt)).toHaveLength(1);
    expect(f).toMatchObject({ chargesTotal: 400000, balanceDue: 400000 });
    // remise
    const d2 = (await s.h.client.get(`/api/v1/reservations/${r.id}`)).body;
    await s.h.client.patch(`/api/v1/reservations/${r.id}`, { version: d2.version, discount: 50000 });
    expect((await folio(s, r.folio)).chargesTotal).toBe(350000);
    // annulation : la charge est annulée
    await s.h.client.post(`/api/v1/reservations/${r.id}/cancel`, { reason: 'Test' });
    f = await folio(s, r.folio);
    expect(f.chargesTotal).toBe(0);
    expect(f.charges[0]).toMatchObject({ voidReason: 'Réservation annulée' });
  });

  it('une option expirée annule aussi la charge ; avec taxes la charge porte le détail', async () => {
    const s = await setup();
    await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, is_inclusive) VALUES ($1, 'TVA', 'percentage', 2000, false)", [s.h.hotelId]);
    const r = await stay(s);
    expect((await folio(s, r.folio)).charges[0]).toMatchObject({ amount: 300000, taxAmount: 60000 });
    expect((await folio(s, r.folio)).chargesTotal).toBe(360000);
    const opt = await stay(s, { status: 'tentative', tentativeExpiresAt: new Date(Date.now() + 3600_000).toISOString() }, 10, 12);
    await q(t, "UPDATE reservations SET tentative_expires_at = now() - interval '1 minute' WHERE id = $1", [opt.id]);
    await s.h.client.get(`/api/v1/reservations/${opt.id}`); // déclenche la libération
    expect((await folio(s, opt.folio)).chargesTotal).toBe(0);
  });

  it('liste des notes avec filtres ; isolation entre établissements', async () => {
    const s = await setup();
    const a = await stay(s);
    await stay(s, {}, 10, 12);
    await pay(s.h.client, a.folio, { amount: 300000 });
    const all = (await s.h.client.get('/api/v1/folios')).body;
    expect(all.total).toBe(2);
    expect((await s.h.client.get('/api/v1/folios?payment=paid')).body.items.map((x: any) => x.id)).toEqual([a.folio]);
    expect((await s.h.client.get('/api/v1/folios?due=true')).body.total).toBe(1);
    expect((await s.h.client.get('/api/v1/folios?q=rakoto')).body.total).toBe(2);
    const other = await setup();
    expect((await other.h.client.get(`/api/v1/folios/${a.folio}`)).status).toBe(404);
    expect((await other.h.client.get('/api/v1/folios')).body.total).toBe(0);
    expect((await pay(other.h.client, a.folio)).status).toBe(404);
  });
});

describe('encaissements', () => {
  it('espèces, acompte, solde ; une référence est exigée hors espèces ; jamais plus que le solde', async () => {
    const s = await setup();
    const r = await stay(s, { depositRequired: 100000 });
    expect((await s.h.client.get(`/api/v1/reservations/${r.id}`)).body.depositSatisfied).toBe(false);
    const dep = await pay(s.h.client, r.folio, { kind: 'deposit', amount: 100000 });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    expect(dep.body).toMatchObject({ baseAmount: 100000, balanceDue: 200000 });
    expect((await s.h.client.get(`/api/v1/reservations/${r.id}`)).body).toMatchObject({ depositSatisfied: true, amountPaid: 100000, balanceDue: 200000 });
    expect(code(await pay(s.h.client, r.folio, { methodCode: 'mvola' }))).toBe('payment_reference_required');
    expect((await pay(s.h.client, r.folio, { methodCode: 'mvola', reference: 'MP240101.1234.A56789' })).status).toBe(201);
    expect(code(await pay(s.h.client, r.folio, { amount: 100001 }))).toBe('folio_payment_exceeds_due');
    expect((await pay(s.h.client, r.folio, { methodCode: 'inconnu' })).status).toBe(422);
    expect((await pay(s.h.client, r.folio, { amount: 0 })).status).toBe(422);
    await s.h.client.patch('/api/v1/payment-methods/card', { isActive: false });
    expect(code(await pay(s.h.client, r.folio, { methodCode: 'card', reference: 'AUTH-1', amount: 1000 }))).toBe('payment_method_unavailable');
    const last = await pay(s.h.client, r.folio, { amount: 100000 });
    expect(last.status).toBe(201);
    const f = await folio(s, r.folio);
    expect(f).toMatchObject({ paymentsTotal: 300000, balanceDue: 0, paymentStatus: 'paid' });
    expect(f.payments.map((p: any) => p.methodLabel)).toEqual(['Espèces', 'MVola', 'Espèces']);
    expect(code(await pay(s.h.client, r.folio, { amount: 1 }))).toBe('folio_payment_exceeds_due');
  });

  it('paiement en euros : taux obligatoire, conservé avec le paiement, contre-valeur dans la devise de la note', async () => {
    const s = await setup();
    const r = await stay(s);
    expect(code(await pay(s.h.client, r.folio, { currency: 'EUR', amount: 2000 }))).toBe('exchange_rate_required');
    // taux saisi sur le paiement
    const p1 = await pay(s.h.client, r.folio, { currency: 'EUR', amount: 2000, exchangeRate: 5000 }); // 20,00 € à 5 000 Ar = 100 000 Ar
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    expect(p1.body.baseAmount).toBe(100000);
    // taux enregistré par l'établissement
    expect((await s.h.client.post('/api/v1/exchange-rates', { baseCurrency: 'EUR', rate: 4900 })).status).toBe(201);
    expect((await s.h.client.post('/api/v1/exchange-rates', { baseCurrency: 'MGA', rate: 1 })).status).toBe(422);
    expect((await s.h.client.get('/api/v1/exchange-rates')).body.rates[0]).toMatchObject({ baseCurrency: 'EUR', quoteCurrency: 'MGA', rate: 4900 });
    const p2 = await pay(s.h.client, r.folio, { currency: 'EUR', amount: 1000 }); // 10 € × 4 900 = 49 000
    expect(p2.body.baseAmount).toBe(49000);
    const f = await folio(s, r.folio);
    expect(f.paymentsTotal).toBe(149000);
    expect(f.payments[1]).toMatchObject({ currency: 'EUR', amount: 1000, exchangeRate: 4900, baseAmount: 49000 });
    // un paiement ne peut pas dépasser le solde, même converti
    expect(code(await pay(s.h.client, r.folio, { currency: 'EUR', amount: 5000 }))).toBe('folio_payment_exceeds_due');
  });

  it('rejeu sécurisé : même clé = un seul encaissement', async () => {
    const s = await setup();
    const r = await stay(s);
    const h = { 'idempotency-key': 'enc-1' };
    const [a, b] = await Promise.all([pay(s.h.client, r.folio, {}, h), pay(s.h.client, r.folio, {}, h)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect((await folio(s, r.folio)).paymentsTotal).toBe(100000);
  });

  it('remboursements : partiel puis total, jamais plus que le paiement, simultanés plafonnés ; paiement immuable', async () => {
    const s = await setup();
    const r = await stay(s);
    const p = await pay(s.h.client, r.folio, { amount: 100000 });
    const refund = (amount: number, reason = 'Erreur de saisie') => s.h.client.post(`/api/v1/payments/${p.body.id}/refund`, { amount, reason });
    expect((await refund(30000)).status).toBe(201);
    expect((await folio(s, r.folio)).paymentsTotal).toBe(70000);
    expect(code(await refund(80000))).toBe('refund_exceeds_payment');
    expect((await refund(70000)).status).toBe(201);
    expect((await folio(s, r.folio)).paymentsTotal).toBe(0);
    expect(code(await refund(1))).toBe('refund_exceeds_payment');
    expect((await s.h.client.post(`/api/v1/payments/${p.body.id}/refund`, { amount: 10, reason: 'x' })).status).toBe(422);
    const f = await folio(s, r.folio);
    expect(f.payments.find((x: any) => x.id === p.body.id).refundedAmount).toBe(100000);
    // simultanés : le total remboursé ne dépasse jamais le paiement
    const p2 = await pay(s.h.client, r.folio, { amount: 100000 });
    const many = await Promise.all(Array.from({ length: 5 }, () => s.h.client.post(`/api/v1/payments/${p2.body.id}/refund`, { amount: 30000, reason: 'Simultané' })));
    expect(many.filter((x) => x.status === 201)).toHaveLength(3);
    expect(many.filter((x) => x.status !== 201).every((x) => code(x) === 'refund_exceeds_payment')).toBe(true);
    // remboursement d'un remboursement refusé
    const ref = f.payments.find((x: any) => x.kind === 'refund');
    expect(code(await s.h.client.post(`/api/v1/payments/${ref.id}/refund`, { amount: 1, reason: 'Absurde' }))).toBe('refund_invalid_target');
    // aucun paiement ne se modifie ni ne se supprime, même en SQL direct
    await expect(q(t, 'UPDATE payments SET amount = 1 WHERE id = $1', [p.body.id])).rejects.toThrow();
    await expect(q(t, 'DELETE FROM payments WHERE id = $1', [p.body.id])).rejects.toThrow();
  });

  it('droits : la réception encaisse mais ne rembourse pas ; le housekeeping n\'a aucun accès', async () => {
    const s = await setup();
    const r = await stay(s);
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    const p = await pay(reception.client, r.folio, { amount: 50000 });
    expect(p.status).toBe(201);
    expect((await reception.client.post(`/api/v1/payments/${p.body.id}/refund`, { amount: 1000, reason: 'Test droits' })).status).toBe(403);
    expect((await s.h.client.post(`/api/v1/payments/${p.body.id}/refund`, { amount: 1000, reason: 'Test droits' })).status).toBe(201);
    const hk = await addStaff(t, s.h.hotelId, 'hk_staff');
    expect((await hk.client.get('/api/v1/folios')).status).toBe(403);
    expect((await pay(hk.client, r.folio)).status).toBe(403);
    const acc = await addStaff(t, s.h.hotelId, 'accountant');
    expect((await acc.client.get('/api/v1/payments')).status).toBe(200);
    expect((await pay(acc.client, r.folio, { amount: 1000 })).status).toBe(201); // le comptable encaisse aussi
    const resto = await addStaff(t, s.h.hotelId, 'restaurant_manager');
    expect((await resto.client.post('/api/v1/folios/' + r.folio + '/charges', { kind: 'service', description: 'Test', unitAmount: 1 })).status).toBe(403);
  });

  it('journal des encaissements : filtres, net encaissé', async () => {
    const s = await setup();
    const r = await stay(s);
    const p = await pay(s.h.client, r.folio, { amount: 100000 });
    await pay(s.h.client, r.folio, { methodCode: 'mvola', reference: 'MV1', amount: 50000 });
    await s.h.client.post(`/api/v1/payments/${p.body.id}/refund`, { amount: 20000, reason: 'Geste commercial' });
    const j = (await s.h.client.get('/api/v1/payments')).body;
    expect(j.total).toBe(3);
    expect(j.netCollected).toBe(130000);
    expect((await s.h.client.get('/api/v1/payments?method=mvola')).body.total).toBe(1);
    expect((await s.h.client.get('/api/v1/payments?kind=refund')).body.items[0]).toMatchObject({ amount: 20000, reason: 'Geste commercial', guestName: 'Hanitra Rakoto' });
  });
});

describe('charges', () => {
  it('service avec taxe, remise, ajustement ; annulation d\'une charge ; la charge d\'hébergement suit la réservation', async () => {
    const s = await setup();
    const tva = (await s.h.client.post('/api/v1/tax-rules', { name: 'TVA', kind: 'percentage', rateBps: 2000, fixedAmount: null, isInclusive: false, appliesTo: ['service'], isActive: true, validFrom: null, validTo: null }));
    expect(tva.status, JSON.stringify(tva.body)).toBe(201);
    const r = await stay(s);
    const add = (body: Record<string, unknown>) => s.h.client.post(`/api/v1/folios/${r.folio}/charges`, body);
    const svc = await add({ kind: 'service', description: 'Blanchisserie', quantity: 2, unitAmount: 5000, taxRuleId: tva.body.id });
    expect(svc.status, JSON.stringify(svc.body)).toBe(201);
    expect((await add({ kind: 'discount', description: 'Geste commercial', unitAmount: 10000 })).status).toBe(201);
    expect((await add({ kind: 'adjustment', description: 'Correction', unitAmount: -2000 })).status).toBe(201);
    expect((await add({ kind: 'fee', description: 'Négatif', unitAmount: -1 })).status).toBe(422);
    const f = await folio(s, r.folio);
    // hébergement 300 000 + blanchisserie 10 000 + 2 000 de taxe − remise 10 000 − correction 2 000
    expect(f.chargesTotal).toBe(300000 + 12000 - 10000 - 2000);
    const laundry = f.charges.find((c: any) => c.description === 'Blanchisserie');
    expect(laundry).toMatchObject({ amount: 10000, taxAmount: 2000, quantity: 2 });
    expect(f.charges.find((c: any) => c.kind === 'discount').amount).toBe(-10000);
    const room = f.charges.find((c: any) => c.kind === 'room');
    expect(code(await s.h.client.post(`/api/v1/folios/${r.folio}/charges/${room.id}/void`, { reason: 'Test' }))).toBe('charge_not_voidable');
    expect((await s.h.client.post(`/api/v1/folios/${r.folio}/charges/${laundry.id}/void`, { reason: 'Saisie en double' })).status).toBe(200);
    expect(code(await s.h.client.post(`/api/v1/folios/${r.folio}/charges/${laundry.id}/void`, { reason: 'Encore' }))).toBe('charge_not_found');
    expect((await folio(s, r.folio)).chargesTotal).toBe(300000 - 10000 - 2000);
  });
});

describe('factures, PDF et avoirs', () => {
  it('émet une facture numérotée sans trou, immuable ; rien à facturer ensuite ; la réservation facturée ne change plus de montant', async () => {
    const s = await setup();
    const r = await stay(s);
    await s.h.client.post(`/api/v1/folios/${r.folio}/charges`, { kind: 'service', description: 'Petit-déjeuner', quantity: 3, unitAmount: 15000 });
    const inv = await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, { dueDays: 7 });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.number).toMatch(/^[A-Z0-9-]+-\d{4}-0001$/);
    expect(inv.body.total).toBe(345000);
    const d = (await s.h.client.get(`/api/v1/invoices/${inv.body.id}`)).body;
    expect(d).toMatchObject({ kind: 'invoice', status: 'issued', currency: 'MGA', subtotal: 345000, tax: 0, total: 345000, reservationReference: expect.stringMatching(/^RES-/) });
    expect(d.lines).toHaveLength(2);
    expect(d.lines.map((l: any) => l.description)).toEqual(expect.arrayContaining(['Petit-déjeuner', expect.stringMatching(/^Hébergement RES-/)]));
    expect(d.snapshot.guest).toMatchObject({ name: 'Hanitra Rakoto', email: 'h@client.test' });
    expect(d.snapshot.hotel.name).toBeTruthy();
    expect(code(await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {}))).toBe('nothing_to_invoice');
    // nouvelle charge → deuxième facture, numéro suivant
    await s.h.client.post(`/api/v1/folios/${r.folio}/charges`, { kind: 'service', description: 'Navette', unitAmount: 20000 });
    const inv2 = await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {});
    expect(inv2.body.number).toMatch(/-0002$/);
    // immuable, même en SQL
    await expect(q(t, 'UPDATE invoices SET total_amount = 1, subtotal_amount = 1 WHERE id = $1', [inv.body.id])).rejects.toThrow();
    await expect(q(t, 'DELETE FROM invoice_lines WHERE invoice_id = $1', [inv.body.id])).rejects.toThrow();
    // la réservation facturée : modifier son montant est refusé ; ne rien changer au montant reste possible
    const res = (await s.h.client.get(`/api/v1/reservations/${r.id}`)).body;
    expect(code(await s.h.client.patch(`/api/v1/reservations/${r.id}/rooms/${res.rooms[0].id}`, { checkOut: D(5), version: res.version }))).toBe('reservation_invoiced');
    expect((await s.h.client.get(`/api/v1/reservations/${r.id}`)).body.total).toBe(300000);
    const ok = await s.h.client.patch(`/api/v1/reservations/${r.id}`, { version: res.version, internalNotes: 'Facturée' });
    expect(ok.status).toBe(200);
    // liste
    const list = (await s.h.client.get('/api/v1/invoices')).body;
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({ guestName: 'Hanitra Rakoto', credited: 0 });
    expect((await s.h.client.get('/api/v1/invoices?q=Rakoto')).body.total).toBe(2);
    expect((await s.h.client.get('/api/v1/invoices?kind=credit_note')).body.total).toBe(0);
  });

  it('avoir partiel puis total, plafonné ; la note du client est créditée ; une facture avec avoir ne s\'annule plus', async () => {
    const s = await setup();
    await q(t, "INSERT INTO tax_rules (hotel_id, name, kind, rate_bps, is_inclusive) VALUES ($1, 'TVA', 'percentage', 2000, false)", [s.h.hotelId]);
    const r = await stay(s); // 300 000 HT + 60 000 TVA = 360 000
    const inv = (await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {})).body;
    expect(inv.total).toBe(360000);
    await pay(s.h.client, r.folio, { amount: 360000 });
    const before = (await folio(s, r.folio)).balanceDue;
    expect(before).toBe(0);
    const credit = await s.h.client.post(`/api/v1/invoices/${inv.id}/credit-notes`, { reason: 'Séjour écourté', amount: 120000 });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    expect(credit.body.number).toMatch(/-AV-\d{4}-0001$/);
    const c = (await s.h.client.get(`/api/v1/invoices/${credit.body.id}`)).body;
    expect(c).toMatchObject({ kind: 'credit_note', total: 120000, subtotal: 100000, tax: 20000, creditForNumber: inv.number });
    // la note est créditée : le client a trop payé de 120 000 (à rembourser)
    expect((await folio(s, r.folio)).chargesTotal).toBe(240000);
    expect(code(await s.h.client.post(`/api/v1/invoices/${inv.id}/credit-notes`, { reason: 'Trop', amount: 250000 }))).toBe('credit_exceeds_invoice');
    expect((await s.h.client.post(`/api/v1/invoices/${inv.id}/credit-notes`, { reason: 'Solde', amount: 240000 })).status).toBe(201);
    expect(code(await s.h.client.post(`/api/v1/invoices/${inv.id}/credit-notes`, { reason: 'Encore' }))).toBe('credit_exceeds_invoice');
    expect(code(await s.h.client.post(`/api/v1/invoices/${credit.body.id}/credit-notes`, { reason: 'Avoir d\'avoir' }))).toBe('credit_note_invalid_target');
    expect(code(await s.h.client.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'Trop tard' }))).toBe('invoice_not_voidable');
    const list = (await s.h.client.get('/api/v1/invoices?kind=invoice')).body;
    expect(list.items[0].credited).toBe(360000);
    // les avoirs n'apparaissent pas comme charge à refacturer
    expect(code(await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {}))).toBe('nothing_to_invoice');
  });

  it('annuler une facture sans avoir : ses charges redeviennent facturables', async () => {
    const s = await setup();
    const r = await stay(s);
    const inv = (await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {})).body;
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    expect((await reception.client.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'Erreur de client' })).status).toBe(403);
    expect((await s.h.client.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'Erreur de client' })).status).toBe(200);
    expect((await s.h.client.get(`/api/v1/invoices/${inv.id}`)).body).toMatchObject({ status: 'void', voidReason: 'Erreur de client' });
    expect(code(await s.h.client.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'Encore' }))).toBe('invoice_not_voidable');
    const again = await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {});
    expect(again.status).toBe(201);
    expect(again.body.number).toMatch(/-0002$/); // le numéro de la facture annulée n'est pas réutilisé
    // facturée de nouveau : son montant ne peut plus changer
    const res = (await s.h.client.get(`/api/v1/reservations/${r.id}`)).body;
    expect((await s.h.client.patch(`/api/v1/reservations/${r.id}`, { version: res.version, discount: 1000 })).status).toBe(409);
  });

  it('PDF : fichier valide, nom, contenu non vide ; refusé hors établissement', async () => {
    const s = await setup();
    const r = await stay(s);
    const inv = (await s.h.client.post(`/api/v1/folios/${r.folio}/invoices`, {})).body;
    const res = await s.h.client.get(`/api/v1/invoices/${inv.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['content-disposition']).toContain(`${inv.number}.pdf`);
    const other = await setup();
    expect((await other.h.client.get(`/api/v1/invoices/${inv.id}/pdf`)).status).toBe(404);
    expect((await new Client(t).get(`/api/v1/invoices/${inv.id}/pdf`)).status).toBe(401);
    expect(await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'invoice.downloaded'", [s.h.hotelId])).toEqual([{ n: 1 }]);
  });
});

describe('taxes et moyens de paiement', () => {
  it('une taxe ne s\'applique qu\'aux nouvelles réservations ; droits ; validation', async () => {
    const s = await setup();
    const before = await stay(s);
    const rule = await s.h.client.post('/api/v1/tax-rules', { name: 'Taxe de séjour', kind: 'fixed_per_person_night', rateBps: null, fixedAmount: 1500, isInclusive: false, appliesTo: ['room'], isActive: true, validFrom: null, validTo: null });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const after = await stay(s, {}, 10, 12);
    expect((await folio(s, before.folio)).chargesTotal).toBe(300000);
    expect((await folio(s, after.folio)).chargesTotal).toBe(200000 + 2 * 2 * 1500);
    expect((await s.h.client.get('/api/v1/tax-rules')).body.taxRules).toHaveLength(1);
    expect((await s.h.client.patch(`/api/v1/tax-rules/${rule.body.id}`, { isActive: false })).status).toBe(200);
    expect((await stay(s, {}, 20, 21)).folio).toBeTruthy();
    expect((await s.h.client.post('/api/v1/tax-rules', { name: 'X', kind: 'percentage', rateBps: null, fixedAmount: null, isInclusive: false, appliesTo: ['room'], isActive: true, validFrom: null, validTo: null })).status).toBe(422);
    const reception = await addStaff(t, s.h.hotelId, 'receptionist');
    expect((await reception.client.get('/api/v1/tax-rules')).status).toBe(200);
    expect((await reception.client.patch(`/api/v1/tax-rules/${rule.body.id}`, { isActive: true })).status).toBe(403);
    const other = await setup();
    expect((await other.h.client.patch(`/api/v1/tax-rules/${rule.body.id}`, { isActive: true })).status).toBe(404);
    expect((await s.h.client.get('/api/v1/payment-methods')).body.methods.map((m: any) => m.code)).toEqual(['cash', 'mvola', 'orange_money', 'airtel_money', 'card', 'bank_transfer']);
  });
});
