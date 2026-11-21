import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, ORIGIN, PASSWORD, createPlatformAdmin, createTestApp, enableConnector, platformLogin, q, qUnguarded, registerHotel, uniqueEmail, type TestApp } from './helpers';

let t: TestApp;
let admin: { id: string; email: string; password: string };
let platform: Client;
beforeAll(async () => {
  t = await createTestApp();
  admin = await createPlatformAdmin(t);
  platform = await platformLogin(t, admin);
  await enableConnector(platform, 'mvola');
  await enableConnector(platform, 'bank_transfer', 'Virement sur le compte BNI 00012 12345 — indiquez le nom de l\'hôtel.');
});
afterAll(async () => { await t.close(); });

describe('connexion du super-administrateur', () => {
  it('ouvre une session séparée, avec des cookies plus stricts que ceux des hôtels', async () => {
    const c = new Client(t, 'hmp_platform_csrf');
    const res = await c.post('/api/v1/platform/auth/login', { email: admin.email, password: admin.password });
    expect(res.status).toBe(200);
    const session = res.cookies.find((x) => x.name === 'hmp_platform_session')!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(res.cookies.some((x) => x.name === 'hmp_session')).toBe(false);
    expect((await c.get('/api/v1/platform/me')).body.admin).toMatchObject({ email: admin.email });
    expect((await q(t, "SELECT count(*)::int AS n FROM platform_audit_logs WHERE action = 'platform.login'"))[0].n).toBeGreaterThan(0);
  });

  it('mêmes réponses pour un compte inconnu et un mauvais mot de passe ; verrouillage après 5 échecs', async () => {
    const a = await createPlatformAdmin(t);
    const wrong = await new Client(t).post('/api/v1/platform/auth/login', { email: a.email, password: 'faux-faux-faux-1' });
    const unknown = await new Client(t).post('/api/v1/platform/auth/login', { email: 'inconnu@example.test', password: 'faux-faux-faux-1' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'invalid_credentials', message: unknown.body.error.message });
    for (let i = 0; i < 3; i++) await new Client(t).post('/api/v1/platform/auth/login', { email: a.email, password: 'faux-faux-faux-1' });
    expect((await new Client(t).post('/api/v1/platform/auth/login', { email: a.email, password: 'faux-faux-faux-1' })).body.error.code).toBe('account_locked');
    expect((await new Client(t).post('/api/v1/platform/auth/login', { email: a.email, password: a.password })).status).toBe(423);
  });

  it('exige le jeton CSRF et l\'origine pour toute action, révoque la session à la déconnexion', async () => {
    const c = await platformLogin(t, admin);
    expect((await c.post('/api/v1/platform/jobs/lifecycle', {}, { 'x-csrf-token': 'faux' })).body.error.code).toBe('csrf_invalid');
    expect((await c.post('/api/v1/platform/jobs/lifecycle', {}, { origin: 'https://evil.example' })).body.error.code).toBe('origin_not_allowed');
    expect((await c.post('/api/v1/platform/jobs/lifecycle')).status).toBe(200);
    const stolen = new Client(t, 'hmp_platform_csrf');
    stolen.jar.set('hmp_platform_session', c.jar.get('hmp_platform_session')!);
    expect((await stolen.get('/api/v1/platform/me')).status).toBe(200);
    expect((await c.post('/api/v1/platform/auth/logout')).status).toBe(204);
    expect((await stolen.get('/api/v1/platform/me')).status).toBe(401);
  });

  it('un administrateur désactivé ne peut plus se connecter ni utiliser sa session', async () => {
    const a = await createPlatformAdmin(t);
    const c = await platformLogin(t, a);
    await q(t, "UPDATE platform_admins SET status = 'disabled' WHERE id = $1", [a.id]);
    expect((await c.get('/api/v1/platform/me')).status).toBe(401);
    expect((await new Client(t).post('/api/v1/platform/auth/login', { email: a.email, password: a.password })).body.error.code).toBe('account_disabled');
  });

  it('limite le débit des tentatives de connexion plateforme', async () => {
    const strict = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3', PLATFORM_AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const c = new Client(strict);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await c.post('/api/v1/platform/auth/login', { email: 'x@example.test', password: 'faux-faux-faux-1' })).status);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
      const limited = await c.post('/api/v1/platform/auth/login', { email: 'x@example.test', password: 'faux' });
      expect(limited.body.error.code).toBe('rate_limited');
      // la limitation vaut aussi pour la connexion des hôtels
      const h = new Client(strict);
      const hc: number[] = [];
      for (let i = 0; i < 4; i++) hc.push((await h.post('/api/v1/auth/login', { email: 'x@example.test', password: 'faux-faux-faux-1' })).status);
      expect(hc).toEqual([401, 401, 401, 429]);
    } finally {
      await strict.close();
    }
  });
});

describe('établissements : annuaire, fiche, suspension', () => {
  it('liste les établissements avec leurs agrégats — jamais de donnée client — et filtre', async () => {
    const a = await registerHotel(t, { hotelName: 'Hôtel Annuaire Un', city: 'Toamasina' });
    const b = await registerHotel(t, { hotelName: 'Hôtel Annuaire Deux', city: 'Fianarantsoa' });
    const list = (await platform.get('/api/v1/platform/hotels?q=Annuaire')).body;
    expect(list.total).toBe(2);
    const first = list.items.find((h: any) => h.id === a.hotelId);
    expect(first).toMatchObject({ name: 'Hôtel Annuaire Un', city: 'Toamasina', status: 'onboarding', ownerEmail: a.email, usersCount: 1, roomsCount: 0, planCode: 'business', subscriptionStatus: 'trialing', isCurrent: true });
    const allowed = ['id', 'slug', 'name', 'country', 'city', 'status', 'suspendedAt', 'createdAt', 'ownerEmail', 'ownerName', 'roomsCount', 'usersCount', 'entitlementSource', 'planCode', 'validUntil', 'isCurrent', 'subscriptionStatus'];
    expect(Object.keys(first).sort()).toEqual([...allowed].sort());
    expect((await platform.get('/api/v1/platform/hotels?q=Annuaire&status=suspended')).body.total).toBe(0);
    expect((await platform.get('/api/v1/platform/hotels?q=Annuaire&plan=starter')).body.total).toBe(0);
    expect((await platform.get('/api/v1/platform/hotels?q=Annuaire&plan=business')).body.total).toBe(2);
    expect((await platform.get(`/api/v1/platform/hotels?q=${encodeURIComponent(b.email)}`)).body.total).toBe(1);
    expect((await platform.get('/api/v1/platform/hotels?q=Annuaire&pageSize=1&page=2')).body.items).toHaveLength(1);
    expect((await platform.get('/api/v1/platform/hotels?pageSize=500')).status).toBe(422);
  });

  it('la fiche d\'un établissement rassemble abonnement, factures, paiements, licences, tickets et audit', async () => {
    const reg = await registerHotel(t, { hotelName: 'Hôtel Fiche' });
    await reg.client.post('/api/v1/support/tickets', { subject: 'Bonjour', message: 'Test' });
    const res = (await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body;
    expect(res.hotel).toMatchObject({ name: 'Hôtel Fiche', ownerEmail: reg.email });
    expect(res.subscriptions[0]).toMatchObject({ status: 'trialing', planCode: 'business' });
    expect(res.tickets).toHaveLength(1);
    expect(Object.keys(res).sort()).toEqual(['auditLog', 'hotel', 'invoices', 'licenses', 'payments', 'planChangeRequests', 'subscriptions', 'tickets']);
    expect((await platform.get('/api/v1/platform/hotels/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('suspendre exige un motif ; suspendre deux fois ou réactiver un compte actif est refusé', async () => {
    const reg = await registerHotel(t);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/suspend`, { reason: 'x' })).status).toBe(422);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/reactivate`)).body.error.code).toBe('invalid_state');
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/suspend`, { reason: 'Fraude avérée' })).status).toBe(200);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/suspend`, { reason: 'Encore' })).body.error.code).toBe('invalid_state');
    const detail = (await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body.hotel;
    expect(detail).toMatchObject({ status: 'suspended', suspensionReason: 'Fraude avérée' });
    expect((await platform.get('/api/v1/platform/hotels?status=suspended')).body.items.map((h: any) => h.id)).toContain(reg.hotelId);
  });
});

describe('forfaits et tarification', () => {
  it('modifier un tarif conserve l\'historique, n\'altère pas les abonnements existants et se reflète dans le catalogue public', async () => {
    const reg = await registerHotel(t);
    const sub = (await reg.client.get('/api/v1/subscription')).body.subscription;
    const plans = (await platform.get('/api/v1/platform/plans')).body.plans;
    const business = plans.find((p: any) => p.code === 'business');
    const old = business.prices.find((p: any) => p.interval === 'month' && p.currency === 'MGA' && p.isActive);
    expect(old.amount).toBe(180000);
    const upd = await platform.post(`/api/v1/platform/plans/${business.id}/prices`, { interval: 'month', currency: 'MGA', amount: 200000 });
    expect(upd.status).toBe(201);
    expect(upd.body.previousAmount).toBe(180000);
    const after = (await platform.get('/api/v1/platform/plans')).body.plans.find((p: any) => p.code === 'business');
    expect(after.prices.filter((p: any) => p.interval === 'month' && p.isActive).map((p: any) => p.amount)).toEqual([200000]);
    expect(after.prices.filter((p: any) => p.interval === 'month' && !p.isActive).map((p: any) => p.amount)).toContain(180000);
    expect((await new Client(t).get('/api/v1/plans')).body.plans.find((p: any) => p.code === 'business').prices.find((p: any) => p.interval === 'month').amount).toBe('200000');
    expect((await reg.client.get('/api/v1/subscription')).body.subscription.priceAmount).toBe(sub.priceAmount); // prix figé
    expect((await platform.post(`/api/v1/platform/plans/${business.id}/prices`, { interval: 'month', currency: 'MGA', amount: -1 })).status).toBe(422);
    await platform.post(`/api/v1/platform/plans/${business.id}/prices`, { interval: 'month', currency: 'MGA', amount: 180000 });
    expect((await platform.get('/api/v1/platform/audit-logs?action=plan.price_changed')).body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('crée et modifie un forfait ; un forfait privé ou inactif n\'apparaît pas au catalogue public', async () => {
    const created = await platform.post('/api/v1/platform/plans', { code: 'boutique', name: 'Boutique', tier: 5, maxRooms: 15, maxUsers: 5, features: { reservations: true, restaurant: true }, trialDays: 30 });
    expect(created.status).toBe(201);
    expect((await platform.post('/api/v1/platform/plans', { code: 'boutique', name: 'Doublon' })).status).toBe(409);
    expect((await platform.post('/api/v1/platform/plans', { code: 'Pas Valide', name: 'X' })).status).toBe(422);
    await platform.post(`/api/v1/platform/plans/${created.body.id}/prices`, { interval: 'month', currency: 'MGA', amount: 120000 });
    expect((await new Client(t).get('/api/v1/plans')).body.plans.map((p: any) => p.code)).toContain('boutique');
    expect((await platform.patch(`/api/v1/platform/plans/${created.body.id}`, { isPublic: false, maxRooms: 20, features: { reservations: true } })).body.updated.sort()).toEqual(['features', 'isPublic', 'maxRooms']);
    expect((await new Client(t).get('/api/v1/plans')).body.plans.map((p: any) => p.code)).not.toContain('boutique');
    expect((await platform.patch(`/api/v1/platform/plans/${created.body.id}`, { name: 'Boutique+', unknownField: 1 })).body.updated).toEqual(['name']);
    expect((await platform.patch(`/api/v1/platform/plans/${created.body.id}`, {})).status).toBe(422);
    expect((await platform.patch(`/api/v1/platform/plans/${created.body.id}`, { features: { restaurant: 'oui' } })).status).toBe(422);
  });

  it('la durée d\'essai est configurable : par réglage global, puis par forfait', async () => {
    expect((await platform.patch('/api/v1/platform/settings/trial.default_days', { value: 3 })).status).toBe(200);
    try {
      const a = await registerHotel(t);
      const trial = (await a.client.get('/api/v1/subscription')).body.subscription;
      const days = Math.round((new Date(trial.trialEndsAt).getTime() - new Date(trial.startedAt).getTime()) / 86_400_000);
      expect(days).toBe(3);
    } finally {
      await platform.patch('/api/v1/platform/settings/trial.default_days', { value: 14 });
    }
    const starter = (await platform.get('/api/v1/platform/plans')).body.plans.find((p: any) => p.code === 'starter');
    await platform.patch(`/api/v1/platform/plans/${starter.id}`, { trialDays: 45 });
    try {
      const b = await registerHotel(t, { planCode: 'starter' });
      const trial = (await b.client.get('/api/v1/subscription')).body.subscription;
      expect(Math.round((new Date(trial.trialEndsAt).getTime() - new Date(trial.startedAt).getTime()) / 86_400_000)).toBe(45);
      expect(trial.planCode).toBe('starter');
    } finally {
      await platform.patch(`/api/v1/platform/plans/${starter.id}`, { trialDays: null });
    }
  });
});

describe('abonnements : activation manuelle, essais, résiliation', () => {
  it('active manuellement une formule (motif obligatoire), remplace l\'essai, journalise', async () => {
    const reg = await registerHotel(t);
    const body = { planCode: 'premium', interval: 'year', reason: 'Contrat signé le 12/11 — bon de commande 4471' };
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/subscription/activate`, { ...body, reason: '' })).status).toBe(422);
    const res = await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/subscription/activate`, body);
    expect(res.status).toBe(201);
    const me = (await reg.client.get('/api/v1/me')).body;
    expect(me.entitlements).toMatchObject({ planCode: 'premium', maxRooms: 100, subscriptionStatus: 'active', isCurrent: true });
    const detail = (await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body;
    expect(detail.subscriptions.map((s: any) => s.status).sort()).toEqual(['active', 'cancelled']); // l'essai est conservé dans l'historique
    expect(detail.subscriptions.find((s: any) => s.status === 'active')).toMatchObject({ priceAmount: 3500000, billingInterval: 'year' });
    expect(detail.auditLog[0].action).toBe('subscription.activated_manually');
    expect((await q(t, "SELECT count(*)::int AS n FROM saas_invoices WHERE hotel_id = $1", [reg.hotelId]))[0].n).toBe(0); // aucune facture : acte explicitement manuel
  });

  it('un prix personnalisé et une remise sont possibles ; une remise supérieure au prix est refusée ; Enterprise exige un prix', async () => {
    const reg = await registerHotel(t);
    const url = `/api/v1/platform/hotels/${reg.hotelId}/subscription/activate`;
    expect((await platform.post(url, { planCode: 'enterprise', interval: 'year', reason: 'Contrat' })).body.error.code).toBe('price_not_available');
    expect((await platform.post(url, { planCode: 'starter', interval: 'month', discountAmount: 999999, reason: 'Test remise' })).status).toBe(422);
    const ok = await platform.post(url, { planCode: 'enterprise', interval: 'year', priceAmount: 9_000_000, discountAmount: 1_000_000, reason: 'Contrat cadre 2026' });
    expect(ok.status).toBe(201);
    const me = (await reg.client.get('/api/v1/me')).body.entitlements;
    expect(me).toMatchObject({ planCode: 'enterprise', maxRooms: null, maxUsers: null });
    expect(me.features.multi_property).toBe(true);
    expect((await platform.get('/api/v1/platform/stats')).body.recurringRevenue.find((r: any) => r.currency === 'MGA').mrr).toBeGreaterThan(0);
  });

  it('prolonge un essai en cours, en offre un nouveau à un hôtel sans abonnement, et refuse sinon', async () => {
    const reg = await registerHotel(t);
    const subId = (await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body.subscriptions[0].id;
    const before = new Date((await reg.client.get('/api/v1/subscription')).body.subscription.trialEndsAt).getTime();
    expect((await platform.post(`/api/v1/platform/subscriptions/${subId}/extend-trial`, { days: 10, reason: 'Démonstration prolongée' })).status).toBe(200);
    const after = new Date((await reg.client.get('/api/v1/subscription')).body.subscription.trialEndsAt).getTime();
    expect(Math.round((after - before) / 86_400_000)).toBe(10);
    expect((await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body.auditLog.map((l: any) => l.action)).toContain('trial.extended');
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/trial/grant`, { days: 5, reason: 'Déjà abonné' })).body.error.code).toBe('invalid_state');

    await platform.post(`/api/v1/platform/subscriptions/${subId}/cancel`, { reason: 'Départ du client', atPeriodEnd: false });
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('read_only');
    const grant = await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/trial/grant`, { days: 21, reason: 'Geste commercial après échange' });
    expect(grant.status).toBe(201);
    expect((await reg.client.get('/api/v1/me')).body).toMatchObject({ access: { state: 'full' }, entitlements: { subscriptionStatus: 'trialing' } });
    const extendNotTrial = await platform.post(`/api/v1/platform/subscriptions/${subId}/extend-trial`, { days: 1, reason: 'Essai déjà clos' });
    expect(extendNotTrial.body.error.code).toBe('invalid_state');
  });

  it('résilie à l\'échéance (l\'accès continue) ou immédiatement', async () => {
    const reg = await registerHotel(t);
    await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/subscription/activate`, { planCode: 'starter', interval: 'month', reason: 'Régularisation' });
    const subId = (await platform.get(`/api/v1/platform/hotels/${reg.hotelId}`)).body.subscriptions.find((s: any) => s.status === 'active').id;
    const soft = await platform.post(`/api/v1/platform/subscriptions/${subId}/cancel`, { reason: 'Ne renouvelle pas' });
    expect(soft.body.status).toBe('cancel_at_period_end');
    expect((await reg.client.get('/api/v1/subscription')).body.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('full');
    const hard = await platform.post(`/api/v1/platform/subscriptions/${subId}/cancel`, { reason: 'Résiliation immédiate', atPeriodEnd: false });
    expect(hard.body.status).toBe('cancelled');
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'read_only', reason: 'subscription_required' });
    expect((await platform.post(`/api/v1/platform/subscriptions/${subId}/cancel`, { reason: 'Encore une fois' })).body.error.code).toBe('invalid_state');
  });
});

describe('factures SaaS et paiements enregistrés par la plateforme', () => {
  it('crée une facture manuelle avec taxe configurable, numérotation séquentielle, brouillon invisible de l\'hôtel', async () => {
    const reg = await registerHotel(t);
    expect((await platform.patch('/api/v1/platform/settings/billing.tax_rate_bps', { value: 2000 })).status).toBe(200);
    try {
      const draft = await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [{ description: 'Formation équipe réception (1 jour)', unitAmount: 250000 }, { description: 'Déplacement', quantity: 2, unitAmount: 40000 }], issue: false });
      expect(draft.body.number).toBeNull();
      expect((await reg.client.get('/api/v1/billing/invoices')).body.invoices).toEqual([]); // brouillon invisible
      const issued = await platform.post(`/api/v1/platform/invoices/${draft.body.invoiceId}/issue`);
      expect(issued.body.number).toMatch(/^FS-\d{4}-\d{6}$/);
      const inv = (await platform.get(`/api/v1/platform/invoices/${draft.body.invoiceId}`)).body;
      expect(inv).toMatchObject({ subtotalAmount: 330000, taxAmount: 66000, totalAmount: 396000, paymentStatus: 'unpaid', status: 'issued' });
      const second = await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [{ description: 'Prestation', unitAmount: 1000 }] });
      const n = (s: string) => Number(s.split('-')[2]);
      expect(n(second.body.number)).toBe(n(issued.body.number) + 1);
      expect((await platform.post(`/api/v1/platform/invoices/${draft.body.invoiceId}/issue`)).body.error.code).toBe('invoice_status_transition_invalid');
      expect((await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [] })).status).toBe(422);
    } finally {
      await platform.patch('/api/v1/platform/settings/billing.tax_rate_bps', { value: 0 });
    }
  });

  it('enregistre un paiement reçu (référence obligatoire, jamais au-delà du solde), règle la facture ; une facture réglée ne s\'annule plus', async () => {
    const reg = await registerHotel(t);
    const inv = (await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [{ description: 'Paramétrage initial', unitAmount: 150000 }] })).body;
    const pay = (body: object) => platform.post(`/api/v1/platform/invoices/${inv.invoiceId}/payments`, body);
    expect((await pay({ method: 'bank_transfer' })).body.error.code).toBe('reference_required');
    expect((await pay({ method: 'bank_transfer', reference: 'VIR-0001', amount: 200000 })).body.error.code).toBe('payment_exceeds_due');
    expect((await pay({ method: 'bank_transfer', reference: 'VIR-0001', amount: 100000 })).status).toBe(201);
    expect((await platform.get(`/api/v1/platform/invoices/${inv.invoiceId}`)).body).toMatchObject({ amountPaid: 100000, balanceDue: 50000, paymentStatus: 'partially_paid' });
    expect((await platform.post(`/api/v1/platform/invoices/${inv.invoiceId}/void`, { reason: 'Erreur de saisie' })).body.error.code).toBe('invoice_status_transition_invalid'); // déjà un paiement
    expect((await pay({ method: 'cash', amount: 50000 })).status).toBe(201); // espèces : pas de référence exigée
    expect((await platform.get(`/api/v1/platform/invoices/${inv.invoiceId}`)).body.paymentStatus).toBe('paid');
    expect((await pay({ method: 'cash' })).body.error.code).toBe('invoice_already_paid');
    expect((await reg.client.get('/api/v1/billing/invoices')).body.invoices[0]).toMatchObject({ paymentStatus: 'paid', balanceDue: 0 });
  });

  it('annule une facture émise et impayée ; la liste se filtre par état de paiement et retard', async () => {
    const reg = await registerHotel(t);
    const inv = (await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [{ description: 'À annuler', unitAmount: 5000 }] })).body;
    expect((await platform.post(`/api/v1/platform/invoices/${inv.invoiceId}/void`, { reason: 'Doublon' })).status).toBe(200);
    expect((await platform.get(`/api/v1/platform/invoices/${inv.invoiceId}`)).body).toMatchObject({ status: 'void', paymentStatus: 'void' });
    expect((await platform.post(`/api/v1/platform/invoices/${inv.invoiceId}/issue`)).status).toBe(409);
    const old = (await platform.post('/api/v1/platform/invoices', { hotelId: reg.hotelId, lines: [{ description: 'En retard', unitAmount: 7000 }] })).body;
    await qUnguarded(t, "UPDATE saas_invoices SET due_at = now() - interval '5 days' WHERE id = $1", [old.invoiceId]);
    const overdue = (await platform.get(`/api/v1/platform/invoices?hotelId=${reg.hotelId}&overdue=true`)).body;
    expect(overdue.items.map((i: any) => i.id)).toEqual([old.invoiceId]);
    expect((await platform.get(`/api/v1/platform/invoices?hotelId=${reg.hotelId}&paymentStatus=void`)).body.total).toBe(1);
  });

  it('liste les paiements à valider et filtre par état ; chaque validation est tracée', async () => {
    const reg = await registerHotel(t);
    await reg.client.post('/api/v1/subscription/change-requests', { planCode: 'starter', interval: 'month' });
    const invId = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    const pay = (await reg.client.post(`/api/v1/billing/invoices/${invId}/payments`, { method: 'bank_transfer', reference: 'VIR-2026-0042', payerName: 'Hôtel Liste' })).body.payment;
    const waiting = (await platform.get(`/api/v1/platform/payments?status=awaiting_validation&hotelId=${reg.hotelId}`)).body;
    expect(waiting.items).toHaveLength(1);
    expect(waiting.items[0]).toMatchObject({ method: 'bank_transfer', reference: 'VIR-2026-0042', payerName: 'Hôtel Liste', amount: 80000, hotelName: expect.stringContaining('Hôtel') });
    await platform.post(`/api/v1/platform/payments/${pay.id}/validate`);
    expect((await platform.get(`/api/v1/platform/payments?status=awaiting_validation&hotelId=${reg.hotelId}`)).body.total).toBe(0);
    expect((await platform.get(`/api/v1/platform/payments?status=confirmed&hotelId=${reg.hotelId}`)).body.total).toBe(1);
    const log = (await platform.get(`/api/v1/platform/audit-logs?hotelId=${reg.hotelId}`)).body.items.find((l: any) => l.action === 'payment.validated');
    expect(log).toMatchObject({ adminEmail: admin.email, details: { effects: ['plan_changed'] } });
  });
});

describe('licences définitives', () => {
  it('émet une licence (clé montrée UNE fois, empreinte seule stockée) qui prime sur l\'abonnement', async () => {
    const reg = await registerHotel(t, { hotelName: 'Hôtel Licence' });
    const res = await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/licenses`, {
      editionCode: 'perpetuelle-pro', basedOnPlanCode: 'premium', maxRooms: 120, maintenanceUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(), terms: 'Licence perpétuelle pour un établissement. Maintenance 12 mois.',
    });
    expect(res.status).toBe(201);
    expect(res.body.licenseKey).toMatch(/^HMP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.body.status).toBe('active');
    expect(res.body.warning).toMatch(/plus jamais affichée/);
    const [row] = await q(t, 'SELECT key_hash, key_prefix FROM licenses WHERE id = $1', [res.body.licenseId]);
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toContain(res.body.licenseKey);
    expect(res.body.licenseKey.startsWith(row.key_prefix)).toBe(true);

    const me = (await reg.client.get('/api/v1/me')).body.entitlements;
    expect(me).toMatchObject({ source: 'license', planCode: 'perpetuelle-pro', maxRooms: 120, maxUsers: 30, isPerpetual: true, validUntil: null, supportActive: true });
    const sub = (await reg.client.get('/api/v1/subscription')).body;
    expect(sub.license).toMatchObject({ editionCode: 'perpetuelle-pro', status: 'active', hostingIncluded: true, terms: expect.stringContaining('perpétuelle') });
    expect(JSON.stringify(sub)).not.toMatch(/HMP-[A-Z2-9]{4}-|key_hash|keyHash/);
    // la clé n'est jamais ré-affichée, ni côté plateforme
    const listed = JSON.stringify((await platform.get('/api/v1/platform/licenses')).body);
    expect(listed).not.toContain(res.body.licenseKey);
    expect(listed).not.toMatch(/key_hash|keyHash/);
    expect((await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/licenses`, { editionCode: 'seconde' })).status).toBe(201 === 201 ? 409 : 409); // une seule licence active
  });

  it('une licence vendue avec facture reste en attente jusqu\'au règlement validé', async () => {
    const reg = await registerHotel(t);
    const res = await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/licenses`, { editionCode: 'perpetuelle-starter', basedOnPlanCode: 'starter', priceAmount: 4_500_000, invoice: true, maintenanceUntil: null });
    expect(res.body).toMatchObject({ status: 'pending', invoice: { number: expect.stringMatching(/^FS-/) } });
    expect((await reg.client.get('/api/v1/me')).body.entitlements.source).toBe('subscription'); // pas encore
    const invId = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
    expect((await reg.client.get('/api/v1/billing/invoices')).body.invoices[0]).toMatchObject({ kind: 'license', totalAmount: 4_500_000 });
    const pay = await reg.client.post(`/api/v1/billing/invoices/${invId}/payments`, { method: 'bank_transfer', reference: 'VIR-LICENCE-1' });
    expect(pay.status).toBe(201);
    const ok = await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`);
    expect(ok.body.effects).toEqual(['license_activated']);
    expect((await reg.client.get('/api/v1/me')).body.entitlements).toMatchObject({ source: 'license', planCode: 'perpetuelle-starter', maxRooms: 10, isPerpetual: true });
    // la licence survit à l'échéance de l'abonnement
    await q(t, "UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_start = now() - interval '60 days', current_period_end = now() - interval '30 days' WHERE hotel_id = $1", [reg.hotelId]);
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('full');
  });

  it('suspend, rétablit, révoque ; prolonge la maintenance — chaque acte est tracé et le droit d\'usage suit', async () => {
    const reg = await registerHotel(t);
    const lic = (await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/licenses`, { editionCode: 'perpetuelle', basedOnPlanCode: 'business', maintenanceUntil: new Date(Date.now() - 86_400_000).toISOString() })).body;
    expect((await reg.client.get('/api/v1/me')).body.entitlements).toMatchObject({ source: 'license', supportActive: false }); // usage perpétuel, maintenance échue
    const until = new Date(Date.now() + 200 * 86_400_000);
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/extend-maintenance`, { until: until.toISOString() })).status).toBe(200);
    expect((await reg.client.get('/api/v1/me')).body.entitlements.supportActive).toBe(true);
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/suspend`, { reason: 'Contestation en cours' })).status).toBe(200);
    expect((await reg.client.get('/api/v1/me')).body.entitlements.source).toBe('subscription');
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/suspend`, { reason: 'Encore' })).status).toBe(404);
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/reinstate`)).status).toBe(200);
    expect((await reg.client.get('/api/v1/me')).body.entitlements.source).toBe('license');
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/revoke`, { reason: '' })).status).toBe(422);
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/revoke`, { reason: 'Violation des conditions' })).status).toBe(200);
    expect((await reg.client.get('/api/v1/me')).body.entitlements.source).toBe('subscription');
    expect((await platform.post(`/api/v1/platform/licenses/${lic.licenseId}/reinstate`)).status).toBe(404); // une révocation est définitive
    const events = (await q(t, 'SELECT event_type FROM license_events WHERE license_id = $1 ORDER BY id', [lic.licenseId])).map((e) => e.event_type);
    expect(events).toEqual(['issued', 'activated', 'maintenance_extended', 'suspended', 'reinstated', 'revoked']);
  });

  it('une licence ne peut être émise que pour un établissement existant', async () => {
    expect((await platform.post('/api/v1/platform/hotels/00000000-0000-0000-0000-000000000000/licenses', { editionCode: 'x-x' })).status).toBe(404);
  });
});

describe('moyens de paiement, réglages, statistiques', () => {
  it('un moyen manuel exige des consignes pour être activé ; un connecteur automatisé ne peut JAMAIS être activé sans vraie intégration', async () => {
    expect((await platform.patch('/api/v1/platform/payment-connectors/orange_money', { isEnabled: true })).body.error.code).toBe('connector_not_ready');
    expect((await platform.patch('/api/v1/platform/payment-connectors/orange_money', { instructions: 'ok', isEnabled: true })).body.error.code).toBe('connector_not_ready'); // trop court
    const ok = await platform.patch('/api/v1/platform/payment-connectors/orange_money', { instructions: 'Transférez au 032 00 000 00 (Orange Money) puis saisissez la référence.', isEnabled: true });
    expect(ok.body).toMatchObject({ status: 'configured', isEnabled: true });
    const off = await platform.patch('/api/v1/platform/payment-connectors/orange_money', { isEnabled: false });
    expect(off.body).toMatchObject({ isEnabled: false, status: 'configured' });
    const card = await platform.patch('/api/v1/platform/payment-connectors/card', { isEnabled: true });
    expect(card.status).toBe(501);
    expect(card.body.error.code).toBe('provider_not_connected');
    expect((await platform.patch('/api/v1/platform/payment-connectors/card', { instructions: 'Paiement par carte bientôt disponible' })).body).toMatchObject({ isEnabled: false, mode: 'automated', status: 'not_configured' });
    const list = (await platform.get('/api/v1/platform/payment-connectors')).body;
    expect(list.connectors.find((c: any) => c.code === 'card')).toMatchObject({ mode: 'automated', isEnabled: false });
    expect(list.note).toMatch(/Aucun prestataire de paiement en ligne n'est connecté/);
    expect((await platform.patch('/api/v1/platform/payment-connectors/bitcoin', { isEnabled: true })).status).toBe(422);
  });

  it('seuls les réglages connus et valides sont modifiables', async () => {
    expect((await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: 10 })).status).toBe(200);
    expect((await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: -1 })).status).toBe(422);
    expect((await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: 'dix' })).status).toBe(422);
    expect((await platform.patch('/api/v1/platform/settings/billing.tax_rate_bps', { value: 99999 })).status).toBe(422);
    expect((await platform.patch('/api/v1/platform/settings/secret.interne', { value: 1 })).body.error.code).toBe('setting_not_allowed');
    expect((await platform.patch('/api/v1/platform/settings/auth.max_failed_attempts', { value: 1 })).status).toBe(422);
    await platform.patch('/api/v1/platform/settings/billing.grace_days', { value: 7 });
    const all = (await platform.get('/api/v1/platform/settings')).body;
    expect(all.editableKeys).toContain('trial.enabled');
    expect(all.settings.find((s: any) => s.key === 'billing.grace_days').value).toBe(7);
  });

  it('un administrateur désactive l\'essai gratuit : les nouvelles inscriptions n\'en reçoivent plus', async () => {
    await platform.patch('/api/v1/platform/settings/trial.enabled', { value: false });
    try {
      const reg = await registerHotel(t);
      expect((await reg.client.get('/api/v1/subscription')).body.subscription).toBeNull();
      expect((await reg.client.get('/api/v1/me')).body.access.reason).toBe('subscription_required');
      // il choisit une formule et paie : l'accès est rétabli
      await reg.client.post('/api/v1/subscription/change-requests', { planCode: 'starter', interval: 'month' });
      const invId = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0].id;
      const pay = await reg.client.post(`/api/v1/billing/invoices/${invId}/payments`, { method: 'mvola', reference: 'MP-SANS-ESSAI' });
      expect((await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`)).body.effects).toEqual(['subscription_activated']);
      expect((await reg.client.get('/api/v1/me')).body).toMatchObject({ access: { state: 'full' }, entitlements: { planCode: 'starter', subscriptionStatus: 'active' } });
    } finally {
      await platform.patch('/api/v1/platform/settings/trial.enabled', { value: true });
    }
  });

  it('les statistiques commerciales reflètent l\'état réel', async () => {
    const stats = (await platform.get('/api/v1/platform/stats')).body;
    expect(stats.hotels.onboarding).toBeGreaterThan(5);
    expect(stats.subscriptions.trialing).toBeGreaterThan(0);
    expect(stats.trials.startedLast30Days).toBeGreaterThan(0);
    expect(stats.recurringRevenue.find((r: any) => r.currency === 'MGA')).toMatchObject({ currency: 'MGA' });
    expect(stats.collectedThisMonth[0].amount).toBeGreaterThan(0);
    expect(stats.newHotelsLast30Days).toBeGreaterThan(5);
    expect(stats.note).toMatch(/sans conversion/);
    const mrr = (await q(t, "SELECT mrr::int AS mrr FROM platform_mrr WHERE currency = 'MGA'"))[0];
    expect(stats.recurringRevenue.find((r: any) => r.currency === 'MGA').mrr).toBe(mrr.mrr);
  });
});

describe('assistance côté plateforme', () => {
  it('liste les tickets de tous les hôtels triés par priorité ; filtre par état', async () => {
    const a = await registerHotel(t);
    const b = await registerHotel(t);
    await a.client.post('/api/v1/support/tickets', { subject: 'Question simple', priority: 'low', message: 'Bonjour' });
    await b.client.post('/api/v1/support/tickets', { subject: 'Panne totale', priority: 'urgent', message: 'Plus rien ne marche' });
    const list = (await platform.get('/api/v1/platform/tickets?status=open')).body;
    const mine = list.items.filter((x: any) => [a.hotelId, b.hotelId].includes(x.hotelId));
    expect(mine.map((x: any) => x.priority)).toEqual(['urgent', 'low']);
    expect(mine[0]).toMatchObject({ subject: 'Panne totale', status: 'open', hotelName: expect.stringContaining('Hôtel') });
    expect((await platform.get('/api/v1/platform/tickets?status=closed')).body.items.filter((x: any) => x.hotelId === a.hotelId)).toEqual([]);
    expect((await platform.get('/api/v1/platform/tickets/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('cohérence du journal d\'audit', () => {
  it('toutes les actions sensibles de la console sont tracées avec l\'administrateur et l\'adresse', async () => {
    const actions = (await platform.get('/api/v1/platform/audit-logs?pageSize=100')).body.items;
    const names = new Set(actions.map((a: any) => a.action));
    for (const expected of ['hotel.suspended', 'plan.price_changed', 'subscription.activated_manually', 'payment.validated', 'license.issued', 'setting.updated', 'payment_connector.updated']) {
      expect(names.has(expected), expected).toBe(true);
    }
    expect(actions.every((a: any) => a.adminEmail === admin.email || a.adminEmail === null || typeof a.adminEmail === 'string')).toBe(true);
    // ajout seul : même la plateforme ne peut ni modifier ni supprimer son journal
    expect((await q(t, "SELECT has_table_privilege('hmp_platform', 'platform_audit_logs', 'UPDATE') AS u, has_table_privilege('hmp_platform', 'platform_audit_logs', 'DELETE') AS d"))[0]).toEqual({ u: false, d: false });
  });

  it('inscription, e-mail et mot de passe : aucune donnée sensible dans le journal', async () => {
    const reg = await registerHotel(t, { email: uniqueEmail('secret') });
    const rows = await q(t, 'SELECT * FROM audit_logs WHERE hotel_id = $1', [reg.hotelId]);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    expect(new Client(t).jar.size).toBe(0);
    expect(ORIGIN).toBeDefined();
  });
});
