import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, addStaff, createPlatformAdmin, createTestApp, enableConnector, platformLogin, q, registerHotel, type Client, type TestApp } from './helpers';

let t: TestApp;
let platform: Client;
beforeAll(async () => {
  t = await createTestApp();
  platform = await platformLogin(t, await createPlatformAdmin(t));
  await enableConnector(platform, 'mvola');
});
afterAll(async () => { await t.close(); });

const subscribe = (c: Client, planCode = 'starter', interval = 'month') => c.post('/api/v1/subscription/change-requests', { planCode, interval });
const declare = (c: Client, invoiceId: string, body: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  c.post(`/api/v1/billing/invoices/${invoiceId}/payments`, { method: 'mvola', reference: 'MP260101.1234.A56789', ...body }, headers);

describe('profil et configuration initiale', () => {
  it('lit et modifie le profil ; chaque modification est tracée dans l\'audit', async () => {
    const reg = await registerHotel(t, { hotelName: 'Hôtel du Lac' });
    const got = await reg.client.get('/api/v1/hotel');
    expect(got.body).toMatchObject({ name: 'Hôtel du Lac', status: 'onboarding', defaultCurrency: 'MGA', timezone: 'Indian/Antananarivo', locale: 'fr', checkInTime: '14:00', checkOutTime: '12:00', invoicePrefix: 'FAC' });
    const upd = await reg.client.patch('/api/v1/hotel', { phone: '+261 34 12 345 67', address: 'Lot II B 12, Antsirabe', taxId: 'NIF 4000123456' });
    expect(upd.status).toBe(200);
    expect(upd.body.updated.sort()).toEqual(['address', 'phone', 'taxId']);
    expect((await reg.client.get('/api/v1/hotel')).body).toMatchObject({ phone: '+261 34 12 345 67', taxId: 'NIF 4000123456' });
    expect((await q(t, "SELECT action FROM audit_logs WHERE hotel_id = $1 AND action = 'hotel.profile_updated'", [reg.hotelId]))).toHaveLength(1);
    expect((await reg.client.patch('/api/v1/hotel', {})).body.error.code).toBe('validation_error');
    expect((await reg.client.patch('/api/v1/hotel', { email: 'pas-un-email' })).body.error.code).toBe('validation_error');
  });

  it('seules les colonnes autorisées sont modifiables : statut et identifiant sont ignorés', async () => {
    const reg = await registerHotel(t);
    const res = await reg.client.patch('/api/v1/hotel', { name: 'Nouveau nom', status: 'active', id: '00000000-0000-0000-0000-000000000000', slug: 'pirate' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual(['name']);
    expect((await q(t, 'SELECT status, slug FROM hotels WHERE id = $1', [reg.hotelId]))[0]).toMatchObject({ status: 'onboarding', slug: reg.slug });
  });

  it('refuse un fuseau inexistant ; accepte la devise tant que la configuration n\'est pas terminée, puis la verrouille', async () => {
    const reg = await registerHotel(t);
    const tz = await reg.client.patch('/api/v1/hotel/settings', { timezone: 'Africa/Antananarivo' });
    expect(tz.status).toBe(422);
    expect(tz.body.error.code).toBe('invalid_timezone');
    expect((await reg.client.patch('/api/v1/hotel/settings', { timezone: 'Europe/Paris', defaultCurrency: 'EUR', invoicePrefix: 'HDL', checkInTime: '15:30' })).status).toBe(200);
    expect((await reg.client.patch('/api/v1/hotel/settings', { invoicePrefix: 'minuscule' })).body.error.code).toBe('validation_error');
    const done = await reg.client.post('/api/v1/hotel/onboarding/complete');
    expect(done.body).toEqual({ status: 'active' });
    const locked = await reg.client.patch('/api/v1/hotel/settings', { defaultCurrency: 'USD' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('currency_locked');
    expect((await reg.client.patch('/api/v1/hotel/settings', { defaultCurrency: 'EUR', locale: 'en' })).status).toBe(200); // même devise : accepté
    expect((await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'hotel.onboarding_completed'", [reg.hotelId]))[0].n).toBe(1);
  });
});

describe('rôles et permissions appliqués par l\'API', () => {
  it('l\'administrateur lit l\'abonnement mais ne peut ni changer de formule ni payer ; le réceptionniste n\'y a pas accès', async () => {
    const reg = await registerHotel(t);
    const admin = await addStaff(t, reg.hotelId, 'admin');
    const recep = await addStaff(t, reg.hotelId, 'receptionist');
    expect((await admin.client.get('/api/v1/subscription')).status).toBe(200);
    const change = await subscribe(admin.client);
    expect(change.status).toBe(403);
    expect(change.body.error.code).toBe('forbidden');
    expect((await recep.client.get('/api/v1/subscription')).status).toBe(403);
    expect((await recep.client.get('/api/v1/billing/invoices')).status).toBe(403);
    expect((await recep.client.get('/api/v1/hotel')).status).toBe(403); // pas settings:read
    expect((await recep.client.patch('/api/v1/hotel', { name: 'Piraté' })).status).toBe(403);
    expect((await admin.client.patch('/api/v1/hotel', { name: 'Renommé par l\'admin' })).status).toBe(200);
  });

  it('un employé de ménage n\'accède à aucune donnée commerciale ni au profil', async () => {
    const reg = await registerHotel(t);
    const hk = await addStaff(t, reg.hotelId, 'hk_staff');
    for (const url of ['/api/v1/subscription', '/api/v1/billing/invoices', '/api/v1/billing/payments', '/api/v1/hotel', '/api/v1/support/tickets']) {
      expect((await hk.client.get(url)).status, url).toBe(403);
    }
    expect((await hk.client.get('/api/v1/me')).body.permissions.sort()).toEqual(['housekeeping:read', 'housekeeping:update_task', 'rooms:read']);
  });

  it('le comptable consulte l\'abonnement et les factures (subscription:read) sans pouvoir les modifier', async () => {
    const reg = await registerHotel(t);
    const acc = await addStaff(t, reg.hotelId, 'accountant');
    expect((await acc.client.get('/api/v1/billing/invoices')).status).toBe(200);
    expect((await subscribe(acc.client)).status).toBe(403);
  });
});

describe('abonnement : changement de formule et paiement manuel validé', () => {
  it('parcours complet : demande → facture → paiement DÉCLARÉ → validation → formule changée', async () => {
    const reg = await registerHotel(t, { hotelName: 'Hôtel Parcours' });
    const before = (await reg.client.get('/api/v1/subscription')).body;
    expect(before.subscription).toMatchObject({ status: 'trialing', planCode: 'business', maxRooms: 30 });
    expect(before.nextInvoiceDue).toBeNull();

    const req = await subscribe(reg.client, 'starter', 'month');
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('approved');
    expect(req.body.invoice.number).toMatch(/^FS-\d{4}-\d{6}$/);

    const invoices = (await reg.client.get('/api/v1/billing/invoices')).body.invoices;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ kind: 'plan_change', status: 'issued', currency: 'MGA', totalAmount: 80000, amountPaid: 0, balanceDue: 80000, paymentStatus: 'unpaid' });
    expect((await reg.client.get('/api/v1/subscription')).body.nextInvoiceDue).toMatchObject({ number: req.body.invoice.number, balanceDue: 80000 });

    const detail = await reg.client.get(`/api/v1/billing/invoices/${invoices[0].id}`);
    expect(detail.body.lines).toHaveLength(1);
    expect(detail.body.lines[0]).toMatchObject({ description: expect.stringContaining('Starter'), unitAmount: 80000 });

    // l'hôtel DÉCLARE son paiement : ce n'est pas un paiement tant qu'il n'est pas validé
    const pay = await declare(reg.client, invoices[0].id);
    expect(pay.status).toBe(201);
    expect(pay.body.payment.status).toBe('awaiting_validation');
    const mid = (await reg.client.get(`/api/v1/billing/invoices/${invoices[0].id}`)).body;
    expect(mid).toMatchObject({ amountPaid: 0, paymentStatus: 'unpaid' });
    expect((await reg.client.get('/api/v1/subscription')).body.subscription).toMatchObject({ planCode: 'business', status: 'trialing' }); // rien n'a changé

    // la plateforme valide après vérification manuelle
    const ok = await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`);
    expect(ok.status).toBe(200);
    expect(ok.body.effects).toEqual(['plan_changed']);

    const after = (await reg.client.get('/api/v1/subscription')).body;
    expect(after.subscription).toMatchObject({ status: 'active', planCode: 'starter', maxRooms: 10, priceAmount: 80000 });
    expect(after.nextInvoiceDue).toBeNull();
    expect((await reg.client.get(`/api/v1/billing/invoices/${invoices[0].id}`)).body).toMatchObject({ amountPaid: 80000, paymentStatus: 'paid' });
    const history = (await reg.client.get('/api/v1/subscription/history')).body;
    expect(history.events.map((e: any) => e.eventType)).toEqual(expect.arrayContaining(['trial_started', 'plan_changed']));
    // les nouvelles limites s'appliquent aussitôt
    expect((await reg.client.get('/api/v1/me')).body.entitlements).toMatchObject({ planCode: 'starter', maxRooms: 10, maxUsers: 3, subscriptionStatus: 'active' });
  });

  it('paiements partiels : la formule ne change qu\'une fois la facture entièrement réglée', async () => {
    const reg = await registerHotel(t);
    const inv = (await subscribe(reg.client, 'starter', 'year')).body.invoice;
    const id = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const p1 = await declare(reg.client, id, { amount: 300000, reference: 'MP-PARTIEL-1' });
    await platform.post(`/api/v1/platform/payments/${p1.body.payment.id}/validate`);
    expect((await reg.client.get(`/api/v1/billing/invoices/${id}`)).body).toMatchObject({ totalAmount: 800000, amountPaid: 300000, balanceDue: 500000, paymentStatus: 'partially_paid' });
    expect((await reg.client.get('/api/v1/subscription')).body.subscription.planCode).toBe('business'); // pas encore
    const over = await declare(reg.client, id, { amount: 600000, reference: 'MP-TROP' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('payment_exceeds_due');
    const p2 = await declare(reg.client, id, { reference: 'MP-SOLDE-2' }); // montant par défaut = solde restant
    expect(p2.body.payment.amount).toBe(500000);
    expect((await platform.post(`/api/v1/platform/payments/${p2.body.payment.id}/validate`)).body.effects).toEqual(['plan_changed']);
    expect((await reg.client.get('/api/v1/subscription')).body.subscription).toMatchObject({ planCode: 'starter', billingInterval: 'year', priceAmount: 800000 });
    expect(inv.number).toBeDefined();
    expect((await declare(reg.client, id)).body.error.code).toBe('invoice_already_paid');
  });

  it('un paiement rejeté ne règle rien et le motif est visible de l\'hôtel', async () => {
    const reg = await registerHotel(t);
    await subscribe(reg.client);
    const id = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const pay = await declare(reg.client, id, { reference: 'MP-INTROUVABLE' });
    const rej = await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/reject`, { reason: 'Référence introuvable dans le relevé MVola' });
    expect(rej.status).toBe(200);
    const detail = (await reg.client.get(`/api/v1/billing/invoices/${id}`)).body;
    expect(detail).toMatchObject({ amountPaid: 0, paymentStatus: 'unpaid' });
    expect(detail.payments[0]).toMatchObject({ status: 'rejected', rejectionReason: 'Référence introuvable dans le relevé MVola' });
    expect((await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`)).body.error.code).toBe('payment_not_awaiting_validation');
    expect((await declare(reg.client, id, { reference: 'MP-CORRIGEE' })).status).toBe(201); // il peut redéclarer
  });

  it('valider deux fois le même paiement est refusé ; les effets ne sont appliqués qu\'une fois', async () => {
    const reg = await registerHotel(t);
    await subscribe(reg.client);
    const id = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const pay = await declare(reg.client, id);
    expect((await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`)).status).toBe(200);
    expect((await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`)).status).toBe(409);
    expect((await q(t, "SELECT count(*)::int AS n FROM subscription_events WHERE hotel_id = $1 AND event_type = 'plan_changed'", [reg.hotelId]))[0].n).toBe(1);
  });

  it('une demande rejouée avec la même clé d\'idempotence ne crée pas de doublon', async () => {
    const reg = await registerHotel(t);
    await subscribe(reg.client);
    const id = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const key = { 'idempotency-key': 'req-2026-11-21-abc' };
    const a = await declare(reg.client, id, { amount: 10000 }, key);
    const b = await declare(reg.client, id, { amount: 10000 }, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.payment.id).toBe(a.body.payment.id);
    expect((await q(t, 'SELECT count(*)::int AS n FROM saas_payments WHERE hotel_id = $1', [reg.hotelId]))[0].n).toBe(1);
  });

  it('refuse un moyen non activé, une référence manquante, et ne simule JAMAIS un paiement en ligne', async () => {
    const reg = await registerHotel(t);
    await subscribe(reg.client);
    const id = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    expect((await declare(reg.client, id, { method: 'orange_money' })).body.error.code).toBe('payment_method_unavailable'); // pas encore configuré
    expect((await declare(reg.client, id, { reference: undefined })).body.error.code).toBe('reference_required');
    // même si un connecteur automatisé était marqué « connecté » sans intégration réelle, aucun paiement n'est inventé
    await q(t, "UPDATE payment_connectors SET status = 'connected', provider = 'psp-demo', connected_at = now(), is_enabled = true WHERE code = 'card'");
    try {
      const card = await declare(reg.client, id, { method: 'card', reference: 'CB-1' });
      expect(card.status).toBe(501);
      expect(card.body.error.code).toBe('provider_not_connected');
      expect((await q(t, "SELECT count(*)::int AS n FROM saas_payments WHERE hotel_id = $1 AND method = 'card'", [reg.hotelId]))[0].n).toBe(0);
    } finally {
      await q(t, "UPDATE payment_connectors SET is_enabled = false, status = 'disabled', connected_at = NULL, provider = NULL WHERE code = 'card'");
    }
  });

  it('ne publie que les moyens activés, avec leurs consignes, et dit clairement que la vérification est manuelle', async () => {
    const reg = await registerHotel(t);
    const m = (await reg.client.get('/api/v1/billing/payment-methods')).body;
    expect(m.methods.map((x: any) => x.code)).toEqual(['mvola']);
    expect(m.methods[0]).toMatchObject({ mode: 'manual', instructions: expect.stringContaining('034 00 000 00') });
    expect(m.notice).toMatch(/vérifié manuellement/);
  });

  it('une formule sur devis (Enterprise) reste en attente ; la plateforme fixe le prix puis facture', async () => {
    const reg = await registerHotel(t);
    const res = await subscribe(reg.client, 'enterprise', 'year');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending', invoice: null });
    expect((await subscribe(reg.client, 'starter')).body.error.code).toBe('plan_change_pending');
    expect((await reg.client.get('/api/v1/subscription')).body.pendingChangeRequest).toMatchObject({ toPlanCode: 'enterprise', status: 'pending' });
    const list = (await platform.get('/api/v1/platform/plan-change-requests?status=pending')).body.requests;
    const mine = list.find((r: any) => r.id === res.body.requestId);
    expect(mine).toMatchObject({ toPlanCode: 'enterprise', isCustomPriced: true });
    expect((await platform.post(`/api/v1/platform/plan-change-requests/${res.body.requestId}/approve`, {})).body.error.code).toBe('price_not_available'); // prix obligatoire
    const ok = await platform.post(`/api/v1/platform/plan-change-requests/${res.body.requestId}/approve`, { priceAmount: 4_800_000, discountAmount: 300_000, notes: 'Contrat 2026 — 60 chambres' });
    expect(ok.status).toBe(201);
    const inv = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0];
    expect(inv).toMatchObject({ totalAmount: 4_500_000, balanceDue: 4_500_000 }); // prix − remise
    const lines = (await reg.client.get(`/api/v1/billing/invoices/${inv.id}`)).body.lines;
    expect(lines.map((l: any) => l.amount)).toEqual([4_800_000, -300_000]);
  });

  it('une demande refusée par la plateforme est tracée ; l\'hôtel peut annuler une demande en attente', async () => {
    const a = await registerHotel(t);
    const reqA = (await subscribe(a.client, 'enterprise')).body.requestId;
    expect((await platform.post(`/api/v1/platform/plan-change-requests/${reqA}/reject`, { notes: 'Merci de nous contacter pour un devis' })).status).toBe(200);
    expect((await a.client.get('/api/v1/subscription')).body.pendingChangeRequest).toBeNull();
    const b = await registerHotel(t);
    const reqB = (await subscribe(b.client, 'enterprise')).body.requestId;
    expect((await b.client.delete(`/api/v1/subscription/change-requests/${reqB}`)).status).toBe(204);
    expect((await b.client.delete(`/api/v1/subscription/change-requests/${reqB}`)).status).toBe(404);
  });

  it('refuse de souscrire à la formule déjà active, à une formule inconnue ou sans tarif dans la devise', async () => {
    const reg = await registerHotel(t);
    expect((await subscribe(reg.client, 'inconnue')).body.error.code).toBe('plan_not_available');
    await q(t, "UPDATE plan_prices SET is_active = false WHERE plan_id = (SELECT id FROM plans WHERE code = 'premium') AND billing_interval = 'month'");
    try {
      expect((await subscribe(reg.client, 'premium', 'month')).body.error.code).toBe('price_not_available');
    } finally {
      await q(t, "UPDATE plan_prices SET is_active = true WHERE plan_id = (SELECT id FROM plans WHERE code = 'premium') AND billing_interval = 'month'");
    }
  });
});

describe('isolation entre établissements via l\'API', () => {
  it('un établissement ne voit ni ne règle les factures, paiements et tickets d\'un autre', async () => {
    const a = await registerHotel(t, { hotelName: 'Hôtel Isolé A' });
    const b = await registerHotel(t, { hotelName: 'Hôtel Isolé B' });
    await subscribe(a.client);
    const invA = (await a.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const payA = (await declare(a.client, invA)).body.payment.id;
    const ticketA = (await a.client.post('/api/v1/support/tickets', { subject: 'Question facture A', message: 'Bonjour' })).body.ticket.id;

    expect((await b.client.get(`/api/v1/billing/invoices/${invA}`)).status).toBe(404);
    expect((await declare(b.client, invA)).body.error.code).toBe('invoice_not_found');
    expect((await b.client.get('/api/v1/billing/invoices')).body.invoices).toEqual([]);
    expect((await b.client.get('/api/v1/billing/payments')).body.payments).toEqual([]);
    expect((await b.client.get(`/api/v1/support/tickets/${ticketA}`)).status).toBe(404);
    expect((await b.client.post(`/api/v1/support/tickets/${ticketA}/messages`, { body: 'Message intrus' })).status).toBe(404);
    expect((await b.client.get('/api/v1/support/tickets')).body.tickets).toEqual([]);
    expect((await b.client.get('/api/v1/subscription/history')).body.events.every((e: any) => e.subscriptionId !== undefined)).toBe(true);
    expect(payA).toBeDefined();
    // aucune écriture de B n'a touché A
    expect((await q(t, 'SELECT count(*)::int AS n FROM saas_payments WHERE hotel_id = $1', [a.hotelId]))[0].n).toBe(1);
    expect((await q(t, 'SELECT count(*)::int AS n FROM support_messages WHERE hotel_id = $1', [b.hotelId]))[0].n).toBe(0);
  });

  it('les sessions des établissements ne donnent accès à aucune route de la plateforme, et inversement', async () => {
    const reg = await registerHotel(t);
    for (const url of ['/api/v1/platform/hotels', '/api/v1/platform/stats', '/api/v1/platform/payments', '/api/v1/platform/settings']) {
      expect((await reg.client.get(url)).status, url).toBe(401);
    }
    // un cookie d'hôtel présenté comme cookie plateforme est refusé (autre table, autre rôle SQL)
    const spoof = new (reg.client.constructor as any)(t, 'hmp_platform_csrf') as Client;
    spoof.jar.set('hmp_platform_session', reg.client.jar.get('hmp_session')!);
    expect((await spoof.get('/api/v1/platform/stats')).status).toBe(401);
    // et un cookie plateforme ne donne accès à aucune donnée d'hôtel
    const admin = new (reg.client.constructor as any)(t) as Client;
    admin.jar.set('hmp_session', platform.jar.get('hmp_platform_session')!);
    expect((await admin.get('/api/v1/me')).status).toBe(401);
  });
});

describe('contrôle d\'accès selon l\'abonnement et le compte', () => {
  it('une route métier est protégée par permission ET par état d\'abonnement', async () => {
    const reg = await registerHotel(t);
    const recep = await addStaff(t, reg.hotelId, 'receptionist');
    expect((await reg.client.post('/api/v1/_test/rooms')).status).toBe(200);
    expect((await recep.client.post('/api/v1/_test/rooms')).body.error.code).toBe('forbidden'); // rooms:manage absent
    expect((await recep.client.get('/api/v1/_test/rooms')).status).toBe(200);
  });

  it('essai terminé : lecture seule (402) mais facturation, profil et assistance restent accessibles', async () => {
    const reg = await registerHotel(t);
    await q(t, "UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour', current_period_start = now() - interval '15 days', current_period_end = now() - interval '1 hour' WHERE hotel_id = $1", [reg.hotelId]);
    const me = (await reg.client.get('/api/v1/me')).body;
    expect(me.access).toMatchObject({ state: 'read_only', reason: 'trial_expired' });
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200); // lecture : permise
    const write = await reg.client.post('/api/v1/_test/rooms');
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe('trial_expired');
    expect(write.body.error.message).toMatch(/données sont conservées/);
    expect((await reg.client.patch('/api/v1/hotel', { phone: '+261 20 22 000 00' })).status).toBe(200); // profil : permis
    expect((await subscribe(reg.client)).status).toBe(201); // se réabonner : permis
    expect((await reg.client.post('/api/v1/support/tickets', { subject: 'Reprise', message: 'Je veux reprendre' })).status).toBe(201);
  });

  it('abonnement payant échu : tolérance de 7 jours (accès complet), puis lecture seule', async () => {
    const reg = await registerHotel(t);
    await q(t, "UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_start = now() - interval '33 days', current_period_end = now() - interval '3 days' WHERE hotel_id = $1", [reg.hotelId]);
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'grace', reason: 'grace_period' });
    expect((await reg.client.post('/api/v1/_test/rooms')).status).toBe(200);
    await q(t, "UPDATE subscriptions SET current_period_end = now() - interval '9 days' WHERE hotel_id = $1", [reg.hotelId]);
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'read_only', reason: 'subscription_expired' });
    expect((await reg.client.post('/api/v1/_test/rooms')).body.error.code).toBe('subscription_expired');
    // la durée de tolérance est un réglage de la plateforme
    expect((await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: 14 })).status).toBe(200);
    try {
      expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('grace');
    } finally {
      await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: 7 });
    }
  });

  it('compte suspendu : plus aucun accès aux données, mais /me et l\'assistance restent joignables', async () => {
    const reg = await registerHotel(t);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/suspend`, { reason: 'Impayé de plus de 60 jours' })).status).toBe(200);
    const blocked = await reg.client.get('/api/v1/_test/rooms');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('hotel_suspended');
    expect((await reg.client.get('/api/v1/hotel')).body.error.code).toBe('hotel_suspended');
    expect((await reg.client.get('/api/v1/billing/invoices')).body.error.code).toBe('hotel_suspended');
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'blocked', reason: 'hotel_suspended' });
    expect((await reg.client.post('/api/v1/support/tickets', { subject: 'Compte suspendu', message: 'Pourquoi ?' })).status).toBe(201);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/reactivate`)).status).toBe(200);
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200);
    const audit = (await platform.get(`/api/v1/platform/audit-logs?hotelId=${reg.hotelId}`)).body.items.map((l: any) => l.action);
    expect(audit).toEqual(expect.arrayContaining(['hotel.suspended', 'hotel.reactivated']));
  });
});

describe('assistance', () => {
  it('ouvre un ticket numéroté, échange avec le support ; les notes internes restent invisibles ; l\'état suit la conversation', async () => {
    const reg = await registerHotel(t);
    const created = await reg.client.post('/api/v1/support/tickets', { subject: 'Je ne peux pas émettre de facture', category: 'technical', priority: 'high', message: 'Le bouton ne répond pas.' });
    expect(created.status).toBe(201);
    expect(created.body.ticket.number).toMatch(/^SUP-\d{6}$/);
    const tid = created.body.ticket.id;
    expect((await reg.client.get('/api/v1/support/tickets')).body.tickets[0]).toMatchObject({ subject: 'Je ne peux pas émettre de facture', status: 'open', priority: 'high' });

    await platform.post(`/api/v1/platform/tickets/${tid}/messages`, { body: 'Note interne : client à jour.', internal: true });
    expect((await reg.client.get(`/api/v1/support/tickets/${tid}`)).body.ticket.status).toBe('open'); // une note interne ne change pas l'état visible
    await platform.post(`/api/v1/platform/tickets/${tid}/messages`, { body: 'Nous regardons, merci.' });
    const view = (await reg.client.get(`/api/v1/support/tickets/${tid}`)).body;
    expect(view.ticket.status).toBe('in_progress');
    expect(view.messages.map((m: any) => m.body)).toEqual(['Le bouton ne répond pas.', 'Nous regardons, merci.']);
    expect(view.messages[1].authorName).toBe('Support Hotel Manager Pro');
    expect((await platform.get(`/api/v1/platform/tickets/${tid}`)).body.messages).toHaveLength(3); // la plateforme voit tout

    await platform.patch(`/api/v1/platform/tickets/${tid}`, { status: 'waiting_customer', assignToMe: true });
    await reg.client.post(`/api/v1/support/tickets/${tid}/messages`, { body: 'Voici une capture.' });
    expect((await reg.client.get(`/api/v1/support/tickets/${tid}`)).body.ticket.status).toBe('open'); // la réponse de l'hôtel rouvre le ticket
    await platform.patch(`/api/v1/platform/tickets/${tid}`, { status: 'closed' });
    expect((await reg.client.post(`/api/v1/support/tickets/${tid}/messages`, { body: 'Encore ?' })).body.error.code).toBe('invalid_state');
  });

  it('valide les champs (sujet trop court, message vide, catégorie inconnue)', async () => {
    const reg = await registerHotel(t);
    for (const body of [{ subject: 'ab', message: 'x' }, { subject: 'Sujet valide', message: '' }, { subject: 'Sujet valide', message: 'x', category: 'inconnue' }]) {
      expect((await reg.client.post('/api/v1/support/tickets', body)).status).toBe(422);
    }
  });

  it('le mot de passe n\'apparaît jamais dans les réponses de l\'API', async () => {
    const reg = await registerHotel(t);
    const bodies = [
      (await reg.client.get('/api/v1/me')).body, (await reg.client.get('/api/v1/hotel')).body, (await reg.client.get('/api/v1/subscription')).body,
    ];
    expect(JSON.stringify(bodies)).not.toMatch(new RegExp(`${PASSWORD}|password|argon2`, 'i'));
  });
});
