import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, createPlatformAdmin, createTestApp, enableConnector, platformLogin, q, registerHotel, type TestApp } from './helpers';

/**
 * Cycle de vie des abonnements. Le temps est piloté par `t.setNow` (l'horloge de l'application) : on avance au fil des
 * échéances sans toucher aux données, exactement comme le ferait le calendrier réel.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;

let t: TestApp;
let platform: Client;
beforeAll(async () => {
  t = await createTestApp();
  platform = await platformLogin(t, await createPlatformAdmin(t));
  await enableConnector(platform, 'mvola');
});
afterAll(async () => { await t.close(); });
afterEach(() => t.setNow(null));

type Reg = Awaited<ReturnType<typeof registerHotel>>;

const activate = async (reg: Reg, planCode = 'starter', interval: 'month' | 'year' = 'month') => {
  const res = await platform.post(`/api/v1/platform/hotels/${reg.hotelId}/subscription/activate`, { planCode, interval, reason: 'Contrat de test du cycle de vie' });
  expect(res.status).toBe(201);
};
const runJob = async () => {
  const res = await platform.post('/api/v1/platform/jobs/lifecycle');
  expect(res.status).toBe(200);
  return res.body as { trialsExpired: number; cancelledAtPeriodEnd: number; pastDue: number; expired: number; renewalInvoices: number };
};
const liveSub = async (reg: Reg) =>
  (await q(t, "SELECT id, status, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end FROM subscriptions WHERE hotel_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [reg.hotelId]))[0]!;
const invoices = (reg: Reg) => q(t, "SELECT id, status, kind, total_amount, period_start, period_end FROM saas_invoices WHERE hotel_id = $1 AND kind = 'subscription' ORDER BY created_at, id", [reg.hotelId]);
const events = async (reg: Reg) => (await q(t, 'SELECT event_type FROM subscription_events WHERE hotel_id = $1 ORDER BY id', [reg.hotelId])).map((e) => e.event_type as string);
const snapshot = async (reg: Reg) => ({
  sub: await liveSub(reg),
  invoices: (await invoices(reg)).map((i) => [i.id, i.status]),
  events: await events(reg),
});
/** Rejouer la tâche ne change RIEN pour cet établissement (les compteurs globaux dépendent des autres tests du fichier). */
async function jobChangesNothingFor(reg: Reg) {
  const before = await snapshot(reg);
  await runJob();
  expect(await snapshot(reg)).toEqual(before);
}
const at = (d: Date, deltaMs: number) => new Date(d.getTime() + deltaMs);
const mutate = (reg: Reg) => reg.client.post('/api/v1/_test/rooms', {});

/** Le client déclare un virement ; la plateforme le valide (validation humaine). */
async function payLatestInvoice(reg: Reg, reference: string) {
  const inv = (await reg.client.get('/api/v1/billing/invoices')).body.invoices.find((i: any) => i.paymentStatus !== 'paid' && i.status === 'issued');
  const pay = await reg.client.post(`/api/v1/billing/invoices/${inv.id}/payments`, { method: 'mvola', reference });
  expect(pay.status).toBe(201);
  const ok = await platform.post(`/api/v1/platform/payments/${pay.body.payment.id}/validate`);
  expect(ok.status).toBe(200);
  return ok.body.effects as string[];
}

describe('fin de l\'essai gratuit', () => {
  it('un essai en cours n\'est pas touché ; à l\'échéance il expire, l\'accès passe en lecture seule, l\'historique le garde, et rejouer ne change rien', async () => {
    const reg = await registerHotel(t);
    await jobChangesNothingFor(reg);
    expect((await liveSub(reg)).status).toBe('trialing');

    const end = new Date((await liveSub(reg)).trial_ends_at);
    t.setNow(at(end, -HOUR));
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('full');
    t.setNow(at(end, HOUR));
    // les droits sont calculés à partir des dates : l'accès est coupé même avant que la tâche ne s'exécute
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'read_only', reason: 'trial_expired' });

    // lecture seule : les données restent consultables, aucune écriture
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200);
    const before = await mutate(reg);
    expect(before.status).toBe(402);
    expect(before.body.error.code).toBe('trial_expired');

    expect((await runJob()).trialsExpired).toBeGreaterThanOrEqual(1);
    expect((await liveSub(reg)).status).toBe('expired');
    expect(await events(reg)).toEqual(['trial_started', 'expired']);
    await jobChangesNothingFor(reg);
    // une fois l'essai clos et enregistré, il n'y a plus d'abonnement en cours
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'read_only', reason: 'subscription_required' });
    expect((await mutate(reg)).body.error.code).toBe('subscription_required');
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200);
  });

  it('l\'hôtel qui paie après l\'essai retrouve l\'accès complet (nouvel abonnement actif, essai conservé dans l\'historique)', async () => {
    const reg = await registerHotel(t);
    const end = new Date((await liveSub(reg)).trial_ends_at);
    t.setNow(at(end, 2 * DAY));
    await runJob();
    expect((await mutate(reg)).status).toBe(402);

    expect((await reg.client.post('/api/v1/subscription/change-requests', { planCode: 'starter', interval: 'month' })).status).toBe(201);
    expect(await payLatestInvoice(reg, 'MP-APRES-ESSAI')).toEqual(['subscription_activated']);
    expect((await reg.client.get('/api/v1/me')).body).toMatchObject({ access: { state: 'full' }, entitlements: { planCode: 'starter', subscriptionStatus: 'active' } });
    expect((await mutate(reg)).status).toBe(200);
  });
});

describe('renouvellement', () => {
  it('émet UNE facture de renouvellement 7 jours avant l\'échéance, jamais avant, jamais en double — même si la tâche tourne toutes les heures', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);

    t.setNow(at(end, -10 * DAY));
    await runJob();
    expect(await invoices(reg)).toHaveLength(0);

    t.setNow(at(end, -6 * DAY));
    expect((await runJob()).renewalInvoices).toBeGreaterThanOrEqual(1);
    const [inv] = await invoices(reg);
    expect(inv).toMatchObject({ status: 'issued', total_amount: 80000 });
    expect(new Date(inv.period_start).getTime()).toBe(end.getTime()); // la période suivante démarre à l'échéance
    for (let h = 1; h <= 5; h++) {
      t.setNow(at(end, -6 * DAY + h * HOUR));
      await jobChangesNothingFor(reg);
    }
    expect(await invoices(reg)).toHaveLength(1);
    expect((await reg.client.get('/api/v1/billing/invoices')).body.invoices.map((i: any) => i.id)).toContain(inv.id); // visible par l'hôtel

    // appel manuel depuis la console : refusé tant qu'une facture couvre déjà la prochaine période
    const sub = await liveSub(reg);
    expect((await platform.post(`/api/v1/platform/subscriptions/${sub.id}/renew`)).body.error.code).toBe('invalid_state');
  });

  it('le règlement validé prolonge l\'abonnement d\'une période exactement à partir de l\'ancienne échéance et applique l\'effet une seule fois', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);
    t.setNow(at(end, -5 * DAY));
    await runJob();

    expect(await payLatestInvoice(reg, 'MP-RENOUV-1')).toEqual(['subscription_renewed']);
    const after = await liveSub(reg);
    const [{ expected }] = await q(t, "SELECT ($1::timestamptz + interval '1 month') AS expected", [end]);
    expect(new Date(after.current_period_end).getTime()).toBe(new Date(expected).getTime());
    expect(new Date(after.current_period_start).getTime()).toBe(end.getTime());
    expect(after.status).toBe('active');
    expect(await events(reg)).toContain('renewed');

    // rien à refaire : pas de nouvelle facture avant la prochaine échéance, et la facture réglée n'a plus d'effet
    await jobChangesNothingFor(reg);
    const paid = (await reg.client.get('/api/v1/billing/invoices')).body.invoices[0];
    expect(paid).toMatchObject({ paymentStatus: 'paid', balanceDue: 0 });
    expect((await q(t, "SELECT count(*)::int AS n FROM subscription_events WHERE hotel_id = $1 AND event_type = 'renewed'", [reg.hotelId]))[0].n).toBe(1);
  });

  it('une facture annulée libère la place : la tâche en émet une nouvelle ; un abonnement sans facturation automatique n\'en reçoit pas', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);
    t.setNow(at(end, -3 * DAY));
    await runJob();
    const [first] = await invoices(reg);
    expect((await platform.post(`/api/v1/platform/invoices/${first.id}/void`, { reason: 'Montant à revoir avec le client' })).status).toBe(200);
    await runJob();
    expect((await invoices(reg)).map((i) => i.status)).toEqual(['void', 'issued']);

    const manual = await registerHotel(t);
    await activate(manual);
    await q(t, 'UPDATE subscriptions SET auto_invoice = false WHERE hotel_id = $1', [manual.hotelId]);
    const mEnd = new Date((await liveSub(manual)).current_period_end);
    t.setNow(at(mEnd, -2 * DAY));
    await runJob();
    expect(await invoices(manual)).toHaveLength(0);
  });
});

describe('impayé : tolérance puis expiration', () => {
  it('échéance dépassée → impayé (accès complet pendant la tolérance) → expiré (lecture seule) ; une seule facture tout du long', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);
    t.setNow(at(end, -6 * DAY));
    await runJob();

    t.setNow(at(end, HOUR));
    expect((await runJob()).pastDue).toBeGreaterThanOrEqual(1);
    expect((await liveSub(reg)).status).toBe('past_due');
    expect((await reg.client.get('/api/v1/me')).body.access).toMatchObject({ state: 'grace' });
    expect((await mutate(reg)).status).toBe(200); // la tolérance ne coupe rien

    t.setNow(at(end, 3 * DAY));
    await jobChangesNothingFor(reg);
    expect((await mutate(reg)).status).toBe(200);

    t.setNow(at(end, 8 * DAY));
    // l'accès est coupé dès la fin de la tolérance, avant même que la tâche n'enregistre l'expiration
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('read_only');
    const early = await mutate(reg);
    expect(early.status).toBe(402);
    expect(early.body.error.code).toBe('subscription_expired');
    expect((await runJob()).expired).toBeGreaterThanOrEqual(1);
    expect((await liveSub(reg)).status).toBe('expired');
    expect((await mutate(reg)).body.error.code).toBe('subscription_required');
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200);
    expect(await invoices(reg)).toHaveLength(1);
    expect(await events(reg)).toEqual(expect.arrayContaining(['past_due', 'expired']));
  });

  it('règlement pendant la tolérance : le cycle de facturation est conservé, aucune interruption', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);
    t.setNow(at(end, -6 * DAY));
    await runJob();
    t.setNow(at(end, 2 * DAY));
    await runJob();
    expect((await liveSub(reg)).status).toBe('past_due');

    expect(await payLatestInvoice(reg, 'MP-TOLERANCE')).toEqual(['subscription_renewed']);
    const sub = await liveSub(reg);
    const [{ expected }] = await q(t, "SELECT ($1::timestamptz + interval '1 month') AS expected", [end]);
    expect(sub.status).toBe('active');
    expect(new Date(sub.current_period_start).getTime()).toBe(end.getTime());
    expect(new Date(sub.current_period_end).getTime()).toBe(new Date(expected).getTime());
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('full');
    await jobChangesNothingFor(reg);
  });

  it('règlement APRÈS expiration : nouvel abonnement actif dont la période démarre au jour du règlement (pas de période perdue ni gratuite), l\'ancien reste dans l\'historique', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const end = new Date((await liveSub(reg)).current_period_end);
    t.setNow(at(end, -6 * DAY));
    await runJob();
    t.setNow(at(end, 9 * DAY));
    await runJob();
    expect((await liveSub(reg)).status).toBe('expired');
    expect((await mutate(reg)).status).toBe(402);

    expect(await payLatestInvoice(reg, 'MP-TARDIF')).toEqual(['subscription_reactivated']);
    const sub = await liveSub(reg);
    const paidAt = at(end, 9 * DAY);
    expect(sub.status).toBe('active');
    expect(new Date(sub.current_period_start).getTime()).toBe(paidAt.getTime());
    const [{ expected }] = await q(t, "SELECT ($1::timestamptz + interval '1 month') AS expected", [paidAt]);
    expect(new Date(sub.current_period_end).getTime()).toBe(new Date(expected).getTime());
    expect((await mutate(reg)).status).toBe(200);
    const statuses = (await q(t, 'SELECT status FROM subscriptions WHERE hotel_id = $1 ORDER BY created_at, id', [reg.hotelId])).map((s) => s.status);
    expect(statuses).toEqual(['cancelled', 'expired', 'active']); // essai remplacé par l'activation, abonnement échu, nouvel abonnement
    expect(await events(reg)).toContain('reactivated');
  });
});

describe('résiliation', () => {
  it('une résiliation à l\'échéance laisse l\'accès jusqu\'au bout, ne génère aucune facture et clôt l\'abonnement à la date prévue', async () => {
    const reg = await registerHotel(t);
    await activate(reg);
    const sub = await liveSub(reg);
    const end = new Date(sub.current_period_end);
    expect((await platform.post(`/api/v1/platform/subscriptions/${sub.id}/cancel`, { reason: 'Fermeture saisonnière' })).body.status).toBe('cancel_at_period_end');

    t.setNow(at(end, -3 * DAY));
    await jobChangesNothingFor(reg);
    expect(await invoices(reg)).toHaveLength(0);
    expect((await mutate(reg)).status).toBe(200);

    t.setNow(at(end, HOUR));
    expect((await runJob()).cancelledAtPeriodEnd).toBeGreaterThanOrEqual(1);
    expect((await liveSub(reg)).status).toBe('cancelled');
    expect((await mutate(reg)).status).toBe(402);
    expect((await reg.client.get('/api/v1/_test/rooms')).status).toBe(200);
    expect(await events(reg)).toContain('cancelled');
  });
});

describe('exécution de la tâche', () => {
  it('traite plusieurs établissements en une passe, chacun selon son propre état', async () => {
    const trial = await registerHotel(t);
    const paid = await registerHotel(t);
    await activate(paid, 'business', 'year');
    const trialEnd = new Date((await liveSub(trial)).trial_ends_at);
    t.setNow(at(trialEnd, DAY)); // essai échu, abonnement annuel loin de son échéance
    const run = await runJob();
    expect(run.trialsExpired).toBeGreaterThanOrEqual(1);
    expect((await liveSub(trial)).status).toBe('expired');
    expect((await liveSub(paid)).status).toBe('active');
    expect(await invoices(paid)).toHaveLength(0);
  });

  it('n\'est exécutable que par un administrateur de la plateforme authentifié, avec jeton CSRF', async () => {
    const reg = await registerHotel(t);
    expect((await reg.client.post('/api/v1/platform/jobs/lifecycle')).status).toBe(401);
    expect((await new Client(t, 'hmp_platform_csrf').post('/api/v1/platform/jobs/lifecycle')).status).toBe(401);
    expect((await platform.post('/api/v1/platform/jobs/lifecycle', {}, { 'x-csrf-token': 'faux' })).status).toBe(403);
    const [log] = await q(t, "SELECT details FROM platform_audit_logs WHERE action = 'job.lifecycle_run' ORDER BY id DESC LIMIT 1");
    expect(log.details).toHaveProperty('renewalInvoices');
  });
});
