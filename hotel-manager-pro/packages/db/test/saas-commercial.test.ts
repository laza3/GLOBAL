import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE, createPlatformAdmin, createTestDb, registerHotel, sqlState, withPlatform, withTenant, type HotelFixture, type TestDb } from './helpers.js';

let db: TestDb;
let admin: string;

const plat = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withPlatform(db.app, fn, ROLE);
const asHotel = <T>(h: HotelFixture, fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: h.hotelId, userId: h.userId }, fn, ROLE);
const planId = async (code: string) => (await db.admin.query('SELECT id FROM plans WHERE code = $1', [code])).rows[0].id as string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createPlatformAdmin(db);
});
afterAll(async () => {
  await db.drop();
});

describe('catalogue des forfaits et tarification', () => {
  it('un établissement voit les 4 formules publiques et leurs tarifs ; Enterprise est sur devis', async () => {
    const h = await registerHotel(db);
    const plans = (await asHotel(h, (tx) => tx.query('SELECT code, is_custom_priced, max_rooms, max_users FROM plans ORDER BY tier'))).rows;
    expect(plans.map((p) => p.code)).toEqual(['starter', 'business', 'premium', 'enterprise']);
    expect(plans[3]).toMatchObject({ is_custom_priced: true, max_rooms: null, max_users: null });
    const prices = (await asHotel(h, (tx) => tx.query(`SELECT p.code, pp.billing_interval, pp.amount::int AS amount FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id WHERE pp.is_active ORDER BY p.tier, pp.billing_interval`))).rows;
    expect(prices.filter((r) => r.code === 'enterprise')).toEqual([]);
    expect(prices.filter((r) => r.code === 'starter')).toEqual([
      { code: 'starter', billing_interval: 'month', amount: 80_000 },
      { code: 'starter', billing_interval: 'year', amount: 800_000 },
    ]);
  });

  it('un forfait privé n\'est visible que de l\'établissement qui y est abonné', async () => {
    const a = await registerHotel(db);
    const b = await registerHotel(db);
    const secret = randomUUID();
    await plat((tx) => tx.query(
      `INSERT INTO plans (id, code, name, is_public, is_custom_priced, max_rooms, features) VALUES ($1, 'sur-mesure-a', 'Sur mesure A', false, true, 50, '{"reservations":true}')`, [secret]));
    await plat((tx) => tx.query(`UPDATE subscriptions SET plan_id = $1 WHERE hotel_id = $2`, [secret, a.hotelId]));
    expect((await asHotel(a, (tx) => tx.query("SELECT code FROM plans WHERE code = 'sur-mesure-a'"))).rows).toHaveLength(1);
    expect((await asHotel(b, (tx) => tx.query("SELECT code FROM plans WHERE code = 'sur-mesure-a'"))).rows).toHaveLength(0);
    await plat((tx) => tx.query(`UPDATE plans SET is_active = false WHERE id = $1`, [secret]));
    expect((await asHotel(a, (tx) => tx.query("SELECT code FROM plans WHERE code = 'sur-mesure-a'"))).rows).toHaveLength(1);
  });

  it('un établissement ne peut ni modifier les forfaits ni les tarifs', async () => {
    const h = await registerHotel(db);
    for (const sql of ["UPDATE plans SET max_rooms = 100000 WHERE code = 'starter'", "UPDATE plan_prices SET amount = 0", "INSERT INTO plan_prices (plan_id, billing_interval, currency, amount) SELECT id, 'month', 'EUR', 0 FROM plans LIMIT 1", 'DELETE FROM plans']) {
      expect((await sqlState(asHotel(h, (tx) => tx.query(sql)))).code, sql).toBe('42501');
    }
  });

  it('un seul tarif actif par (forfait, périodicité, devise) ; changer le tarif n\'altère pas les abonnements existants', async () => {
    const h = await registerHotel(db, { plan: 'business' });
    const before = (await db.admin.query('SELECT price_amount::int AS p FROM subscriptions WHERE hotel_id = $1', [h.hotelId])).rows[0].p;
    const business = await planId('business');
    const dup = await sqlState(plat((tx) => tx.query(`INSERT INTO plan_prices (plan_id, billing_interval, currency, amount) VALUES ($1, 'month', 'MGA', 1)`, [business])));
    expect(dup.code).toBe('23505');
    await plat(async (tx) => {
      await tx.query(`UPDATE plan_prices SET is_active = false WHERE plan_id = $1 AND billing_interval = 'month' AND currency = 'MGA'`, [business]);
      await tx.query(`INSERT INTO plan_prices (plan_id, billing_interval, currency, amount) VALUES ($1, 'month', 'MGA', 200000)`, [business]);
    });
    const active = (await db.admin.query(`SELECT amount::int AS a FROM plan_prices WHERE plan_id = $1 AND billing_interval = 'month' AND currency = 'MGA' AND is_active`, [business])).rows;
    expect(active).toEqual([{ a: 200_000 }]);
    const history = (await db.admin.query(`SELECT count(*)::int AS n FROM plan_prices WHERE plan_id = $1 AND billing_interval = 'month' AND currency = 'MGA'`, [business])).rows[0].n;
    expect(history).toBe(2);
    expect((await db.admin.query('SELECT price_amount::int AS p FROM subscriptions WHERE hotel_id = $1', [h.hotelId])).rows[0].p).toBe(before);
  });
});

describe('essai gratuit configurable', () => {
  const startTrial = (h: HotelFixture, plan?: string | null) =>
    asHotel(h, async (tx) => (await tx.query('SELECT start_trial($1) AS id', [plan ?? null])).rows[0].id as string);
  const trialDays = async (h: HotelFixture) =>
    Math.round((await db.admin.query(`SELECT extract(epoch FROM (trial_ends_at - started_at)) / 86400 AS d FROM subscriptions WHERE hotel_id = $1`, [h.hotelId])).rows[0].d as number);
  const setSetting = (key: string, value: unknown) => plat((tx) => tx.query('UPDATE platform_settings SET value = $2::jsonb WHERE key = $1', [key, JSON.stringify(value)]));

  it('démarre un essai de 14 jours sur le forfait par défaut et journalise l\'événement', async () => {
    const h = await registerHotel(db, { plan: null });
    const id = await startTrial(h);
    const sub = (await db.admin.query('SELECT status, p.code, s.billing_interval FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1', [id])).rows[0];
    expect(sub).toMatchObject({ status: 'trialing', code: 'business', billing_interval: 'month' });
    expect(await trialDays(h)).toBe(14);
    const events = (await asHotel(h, (tx) => tx.query('SELECT event_type, actor_type FROM subscription_events'))).rows;
    expect(events).toEqual([{ event_type: 'trial_started', actor_type: 'hotel_user' }]);
  });

  it('la durée est configurable globalement, puis par forfait', async () => {
    try {
      await setSetting('trial.default_days', 7);
      const g = await registerHotel(db, { plan: null });
      await startTrial(g, 'premium');
      expect(await trialDays(g)).toBe(7);
      await plat((tx) => tx.query("UPDATE plans SET trial_days = 30 WHERE code = 'premium'"));
      const p = await registerHotel(db, { plan: null });
      await startTrial(p, 'premium');
      expect(await trialDays(p)).toBe(30);
    } finally {
      await plat((tx) => tx.query("UPDATE plans SET trial_days = NULL WHERE code = 'premium'"));
      await setSetting('trial.default_days', 14);
    }
  });

  it('l\'essai peut être désactivé globalement sans empêcher l\'inscription (le propriétaire est créé, le forfait suivra)', async () => {
    try {
      await setSetting('trial.enabled', false);
      const h = await registerHotel(db, { plan: null }); // le 1er compte est toujours autorisé
      expect((await sqlState(startTrial(h))).message).toBe('trial_disabled');
      const owner = (await asHotel(h, (tx) => tx.query('SELECT count(*)::int AS n FROM memberships'))).rows[0].n;
      expect(owner).toBe(1);
    } finally {
      await setSetting('trial.enabled', true);
    }
  });

  it('refuse les forfaits indisponibles (sur devis, inactif, inconnu)', async () => {
    const h = await registerHotel(db, { plan: null });
    expect((await sqlState(startTrial(h, 'enterprise'))).message).toBe('plan_not_available');
    expect((await sqlState(startTrial(h, 'inconnu'))).message).toBe('plan_not_available');
    try {
      await plat((tx) => tx.query("UPDATE plans SET is_active = false WHERE code = 'starter'"));
      expect((await sqlState(startTrial(h, 'starter'))).message).toBe('plan_not_available');
    } finally {
      await plat((tx) => tx.query("UPDATE plans SET is_active = true WHERE code = 'starter'"));
    }
  });

  it('refuse l\'essai à un établissement suspendu et un second essai à un même établissement', async () => {
    const h = await registerHotel(db, { plan: null });
    await plat((tx) => tx.query("UPDATE hotels SET status = 'suspended', suspended_at = now(), suspension_reason = 'Fraude' WHERE id = $1", [h.hotelId]));
    expect((await sqlState(startTrial(h))).message).toBe('hotel_not_eligible');
    const ok = await registerHotel(db, { plan: 'starter' });
    expect((await sqlState(startTrial(ok))).message).toBe('trial_already_used');
  });

  it('deux demandes d\'essai simultanées ne créent qu\'un seul abonnement', async () => {
    const h = await registerHotel(db, { plan: null });
    const results = await Promise.allSettled([startTrial(h), startTrial(h), startTrial(h)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.admin.query('SELECT count(*)::int AS n FROM subscriptions WHERE hotel_id = $1', [h.hotelId])).rows[0].n).toBe(1);
  });
});

describe('abonnements : cycle de vie, historique, intégrité', () => {
  const insertSub = (hotelId: string, over: Record<string, unknown> = {}) => {
    const v = { status: 'active', interval: 'month', price: 180_000, discount: 0, trialEnds: null as string | null, start: 'now()', end: "now() + interval '1 month'", ...over };
    return plat(async (tx) => (await tx.query(
      `INSERT INTO subscriptions (hotel_id, plan_id, status, billing_interval, currency, price_amount, discount_amount, trial_ends_at, current_period_start, current_period_end, ended_at)
       VALUES ($1, (SELECT id FROM plans WHERE code = 'business'), $2, $3, 'MGA', $4, $5, $6, ${v.start}, ${v.end}, ${v.status === 'cancelled' || v.status === 'expired' ? 'now()' : 'NULL'}) RETURNING id`,
      [hotelId, v.status, v.interval, v.price, v.discount, v.trialEnds])).rows[0].id as string);
  };

  it('un seul abonnement vivant par établissement ; les anciens forment l\'historique', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    expect((await sqlState(insertSub(h.hotelId))).code).toBe('23505');
    await plat((tx) => tx.query("UPDATE subscriptions SET status = 'cancelled', ended_at = now(), cancel_reason = 'Changement de formule' WHERE hotel_id = $1", [h.hotelId]));
    await insertSub(h.hotelId); // plus aucun abonnement vivant : le nouveau est accepté
    const history = (await asHotel(h, (tx) => tx.query('SELECT status FROM subscriptions ORDER BY created_at'))).rows;
    expect(history.map((r) => r.status)).toEqual(['cancelled', 'active']);
  });

  it('applique les contraintes d\'intégrité (essai sans fin, période inversée, remise > prix, résilié sans date)', async () => {
    const h = await registerHotel(db, { plan: null });
    expect((await sqlState(insertSub(h.hotelId, { status: 'trialing' }))).code).toBe('23514');
    expect((await sqlState(insertSub(h.hotelId, { start: "now()", end: "now() - interval '1 day'" }))).code).toBe('23514');
    expect((await sqlState(insertSub(h.hotelId, { discount: 999_999 }))).code).toBe('23514');
    expect((await sqlState(plat((tx) => tx.query(
      `INSERT INTO subscriptions (hotel_id, plan_id, status, billing_interval, currency, price_amount, current_period_start, current_period_end)
       VALUES ($1, (SELECT id FROM plans LIMIT 1), 'cancelled', 'month', 'MGA', 0, now(), now() + interval '1 day')`, [h.hotelId])))).code).toBe('23514');
  });

  it('l\'historique des événements est en ajout seul, même pour la plateforme', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const sub = (await db.admin.query('SELECT id FROM subscriptions WHERE hotel_id = $1', [h.hotelId])).rows[0].id;
    await plat((tx) => tx.query(
      `INSERT INTO subscription_events (hotel_id, subscription_id, event_type, actor_type, actor_id) VALUES ($1, $2, 'activated', 'platform_admin', $3)`, [h.hotelId, sub, admin]));
    expect((await sqlState(plat((tx) => tx.query("UPDATE subscription_events SET event_type = 'cancelled'")))).code).toBe('42501');
    expect((await sqlState(plat((tx) => tx.query('DELETE FROM subscription_events')))).code).toBe('42501');
    expect((await asHotel(h, (tx) => tx.query('SELECT event_type FROM subscription_events ORDER BY id'))).rows.map((r) => r.event_type)).toEqual(['trial_started', 'activated']);
  });

  it('un établissement ne voit pas les abonnements ni l\'historique d\'un autre', async () => {
    const a = await registerHotel(db);
    const b = await registerHotel(db);
    const seen = (await asHotel(a, (tx) => tx.query('SELECT hotel_id FROM subscriptions'))).rows;
    expect(seen.every((r) => r.hotel_id === a.hotelId)).toBe(true);
    const ev = (await asHotel(b, (tx) => tx.query('SELECT hotel_id FROM subscription_events'))).rows;
    expect(ev.every((r) => r.hotel_id === b.hotelId)).toBe(true);
  });

  it('changement de formule : l\'hôtel demande, seule la plateforme décide', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const premium = await planId('premium');
    const create = (status: string) => asHotel(h, (tx) => tx.query(
      `INSERT INTO plan_change_requests (hotel_id, to_plan_id, to_interval, requested_by_user_id, message) VALUES ($1, $2, 'year', $3, 'Nous ouvrons 20 chambres')`, [h.hotelId, premium, h.userId]).then(async (r) => {
        if (status !== 'pending') await tx.query("UPDATE plan_change_requests SET status = $1", [status]);
        return r;
      }));
    await create('pending');
    expect((await sqlState(create('approved'))).code).toBe('42501');
    const row = (await asHotel(h, (tx) => tx.query('SELECT id, status FROM plan_change_requests'))).rows;
    expect(row).toHaveLength(1);
    await asHotel(h, (tx) => tx.query("UPDATE plan_change_requests SET status = 'cancelled' WHERE id = $1", [row[0].id]));
    expect((await sqlState(asHotel(h, (tx) => tx.query("UPDATE plan_change_requests SET status = 'pending' WHERE id = $1", [row[0].id])))).message).toBeDefined();
    await plat((tx) => tx.query("INSERT INTO plan_change_requests (hotel_id, to_plan_id, to_interval, status, decided_by_admin_id, decided_at) VALUES ($1, $2, 'month', 'approved', $3, now())", [h.hotelId, premium, admin]));
  });
});

describe('factures SaaS', () => {
  async function saasInvoice(hotelId: string, amounts: number[], o: { issue?: boolean; tax?: number; due?: string; currency?: string } = {}) {
    const id = randomUUID();
    const subtotal = amounts.reduce((a, b) => a + b, 0);
    const tax = o.tax ?? 0;
    await plat(async (tx) => {
      await tx.query(
        `INSERT INTO saas_invoices (id, hotel_id, currency, subtotal_amount, tax_amount, total_amount, created_by_admin_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, hotelId, o.currency ?? 'MGA', subtotal, tax, subtotal + tax, admin]);
      for (const [i, a] of amounts.entries()) {
        await tx.query(`INSERT INTO saas_invoice_lines (saas_invoice_id, hotel_id, position, description, unit_amount, amount, tax_amount) VALUES ($1, $2, $3, 'Abonnement Business — 1 mois', $4, $4, $5)`,
          [id, hotelId, i, a, i === 0 ? tax : 0]);
      }
    });
    let number: string | null = null;
    if (o.issue !== false) number = await issueSaas(id, o.due ?? '7 days');
    return { id, number, total: subtotal + tax };
  }
  async function issueSaas(id: string, due = '7 days') {
    return plat(async (tx) => {
      const n = (await tx.query<{ n: string }>("SELECT next_platform_counter('saas_invoice:2030') AS n")).rows[0]!.n;
      const number = `SAAS-2030-${n.padStart(6, '0')}`;
      await tx.query(`UPDATE saas_invoices SET status = 'issued', number = $2, issued_at = now(), due_at = now() + $3::interval WHERE id = $1`, [id, number, due]);
      return number;
    });
  }

  it('l\'hôtel ne voit pas les brouillons, voit les factures émises, et seulement les siennes', async () => {
    const a = await registerHotel(db);
    const b = await registerHotel(db);
    const draft = await saasInvoice(a.hotelId, [180_000], { issue: false });
    const issued = await saasInvoice(a.hotelId, [180_000]);
    await saasInvoice(b.hotelId, [350_000]);
    const seen = (await asHotel(a, (tx) => tx.query('SELECT id FROM saas_invoices'))).rows.map((r) => r.id);
    expect(seen).toContain(issued.id);
    expect(seen).not.toContain(draft.id);
    expect(seen).toHaveLength(1);
    expect((await asHotel(a, (tx) => tx.query('SELECT 1 FROM saas_invoice_lines WHERE saas_invoice_id = $1', [draft.id]))).rows).toHaveLength(0);
    expect((await asHotel(a, (tx) => tx.query('SELECT 1 FROM saas_invoice_lines WHERE saas_invoice_id = $1', [issued.id]))).rows).toHaveLength(1);
  });

  it('numérotation séquentielle commune à toute la plateforme, sans trou', async () => {
    const h = await registerHotel(db);
    const a = await saasInvoice(h.hotelId, [1_000]);
    const b = await saasInvoice(h.hotelId, [2_000]);
    const n = (x: string | null) => Number(x!.split('-')[2]);
    expect(n(b.number)).toBe(n(a.number) + 1);
  });

  it('une facture SaaS émise est immuable ; les totaux doivent correspondre aux lignes', async () => {
    const h = await registerHotel(db);
    const inv = await saasInvoice(h.hotelId, [100_000], { tax: 20_000 });
    expect((await sqlState(plat((tx) => tx.query('UPDATE saas_invoices SET subtotal_amount = 1, total_amount = 1 + tax_amount WHERE id = $1', [inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(plat((tx) => tx.query('DELETE FROM saas_invoices WHERE id = $1', [inv.id])))).message).toBe('invoice_not_deletable');
    expect((await sqlState(plat((tx) => tx.query("INSERT INTO saas_invoice_lines (saas_invoice_id, hotel_id, description, unit_amount, amount) VALUES ($1, $2, 'x', 1, 1)", [inv.id, h.hotelId])))).message).toBe('invoice_immutable');
    const bad = await saasInvoice(h.hotelId, [1_000], { issue: false });
    await plat((tx) => tx.query('UPDATE saas_invoices SET subtotal_amount = 9999, total_amount = 9999 WHERE id = $1', [bad.id]));
    expect((await sqlState(issueSaas(bad.id))).message).toBe('invoice_totals_mismatch');
    const noLines = randomUUID();
    await plat((tx) => tx.query(`INSERT INTO saas_invoices (id, hotel_id, currency) VALUES ($1, $2, 'MGA')`, [noLines, h.hotelId]));
    expect((await sqlState(issueSaas(noLines))).message).toBe('invoice_without_lines');
  });

  it('l\'hôtel ne peut ni créer, ni modifier, ni émettre une facture SaaS', async () => {
    const h = await registerHotel(db);
    const inv = await saasInvoice(h.hotelId, [5_000]);
    for (const sql of ["UPDATE saas_invoices SET total_amount = 0, subtotal_amount = 0, tax_amount = 0", 'DELETE FROM saas_invoices', "INSERT INTO saas_invoices (hotel_id, currency) VALUES (gen_random_uuid(), 'MGA')", 'UPDATE saas_invoice_lines SET amount = 0']) {
      expect((await sqlState(asHotel(h, (tx) => tx.query(sql)))).code, sql).toBe('42501');
    }
    expect(inv.number).toMatch(/^SAAS-2030-/);
  });
});

describe('paiements SaaS : validation manuelle, jamais de paiement simulé', () => {
  const balance = async (invoiceId: string) =>
    (await db.admin.query('SELECT amount_paid::int AS paid, balance_due::int AS due, payment_status AS status, is_overdue FROM saas_invoice_balances WHERE invoice_id = $1', [invoiceId])).rows[0] as { paid: number; due: number; status: string; is_overdue: boolean };

  async function setup(amount = 180_000, due = '7 days') {
    const h = await registerHotel(db);
    const id = randomUUID();
    await plat(async (tx) => {
      await tx.query(`INSERT INTO saas_invoices (id, hotel_id, currency, subtotal_amount, total_amount) VALUES ($1, $2, 'MGA', $3, $3)`, [id, h.hotelId, amount]);
      await tx.query(`INSERT INTO saas_invoice_lines (saas_invoice_id, hotel_id, description, unit_amount, amount) VALUES ($1, $2, 'Abonnement', $3, $3)`, [id, h.hotelId, amount]);
      const n = (await tx.query<{ n: string }>("SELECT next_platform_counter('saas_invoice:2030') AS n")).rows[0]!.n;
      await tx.query(`UPDATE saas_invoices SET status = 'issued', number = $2, issued_at = now(), due_at = now() + $3::interval WHERE id = $1`, [id, `SAAS-2030-${n.padStart(6, '0')}`, due]);
    });
    // Le moyen de paiement doit exister dans le catalogue (FK) : « mvola » est présent mais désactivé tant qu'il n'est pas configuré
    return { h, invoiceId: id };
  }

  const declare = (h: HotelFixture, invoiceId: string, o: { amount?: number; method?: string; status?: string; ref?: string | null; currency?: string } = {}) =>
    asHotel(h, async (tx) => (await tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, payer_name, submitted_by_user_id, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Hôtel Test', $8, now()) RETURNING id`,
      [h.hotelId, invoiceId, o.method ?? 'mvola', o.amount ?? 180_000, o.currency ?? 'MGA', o.status ?? 'awaiting_validation', o.ref === undefined ? 'MP240101.1234.A56789' : o.ref, h.userId])).rows[0].id as string);

  const confirm = (paymentId: string) =>
    plat((tx) => tx.query(`UPDATE saas_payments SET status = 'confirmed', validated_by_admin_id = $2, validated_at = now() WHERE id = $1`, [paymentId, admin]));

  it('parcours complet : l\'hôtel déclare, la plateforme valide, la facture devient payée', async () => {
    const { h, invoiceId } = await setup();
    expect(await balance(invoiceId)).toMatchObject({ paid: 0, due: 180_000, status: 'unpaid' });
    const p = await declare(h, invoiceId);
    expect(await balance(invoiceId)).toMatchObject({ paid: 0, status: 'unpaid' }); // déclaré ≠ payé
    await confirm(p);
    expect(await balance(invoiceId)).toMatchObject({ paid: 180_000, due: 0, status: 'paid' });
    const seen = (await asHotel(h, (tx) => tx.query('SELECT payment_status FROM saas_invoice_balances'))).rows;
    expect(seen).toEqual([{ payment_status: 'paid' }]);
  });

  it('paiements partiels : somme des transactions confirmées uniquement', async () => {
    const { h, invoiceId } = await setup(300_000);
    const p1 = await declare(h, invoiceId, { amount: 100_000 });
    const p2 = await declare(h, invoiceId, { amount: 100_000, method: 'orange_money', ref: 'OM-998877' });
    await confirm(p1);
    expect(await balance(invoiceId)).toMatchObject({ paid: 100_000, due: 200_000, status: 'partially_paid' });
    await plat((tx) => tx.query("UPDATE saas_payments SET status = 'rejected', rejection_reason = 'Référence introuvable' WHERE id = $1", [p2]));
    expect(await balance(invoiceId)).toMatchObject({ paid: 100_000, status: 'partially_paid' });
    const p3 = await declare(h, invoiceId, { amount: 200_000, method: 'bank_transfer', ref: 'VIR-2030-77' });
    await confirm(p3);
    expect(await balance(invoiceId)).toMatchObject({ paid: 300_000, due: 0, status: 'paid' });
  });

  it('l\'hôtel ne peut JAMAIS se déclarer payé : statut confirmé, validation ou événement prestataire refusés', async () => {
    const { h, invoiceId } = await setup();
    expect((await sqlState(declare(h, invoiceId, { status: 'confirmed' }))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, validated_by_admin_id, validated_at)
       VALUES ($1, $2, 'mvola', 180000, 'MGA', 'awaiting_validation', 'X', $3, now())`, [h.hotelId, invoiceId, admin])))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, provider_code, provider_event_id)
       VALUES ($1, $2, 'card', 180000, 'MGA', 'confirmed', 'stripe', 'evt_inventé')`, [h.hotelId, invoiceId])))).code).toBe('42501');
    const p = await declare(h, invoiceId);
    for (const sql of ["UPDATE saas_payments SET status = 'confirmed'", 'UPDATE saas_payments SET validated_by_admin_id = NULL, amount = 1', 'UPDATE saas_payments SET provider_event_id = \'x\'']) {
      expect((await sqlState(asHotel(h, (tx) => tx.query(sql)))).code, sql).toBe('42501');
    }
    expect(await balance(invoiceId)).toMatchObject({ paid: 0, status: 'unpaid' });
    expect(p).toBeDefined();
  });

  it('même la plateforme ne peut pas confirmer sans validation humaine ni événement prestataire (contrainte de base)', async () => {
    const { h, invoiceId } = await setup();
    const p = await declare(h, invoiceId);
    const r = await sqlState(plat((tx) => tx.query("UPDATE saas_payments SET status = 'confirmed' WHERE id = $1", [p])));
    expect(r.code).toBe('23514');
    expect(r.message).toMatch(/saas_payment_confirmation_is_real/);
    expect((await sqlState(plat((tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference) VALUES ($1, $2, 'cash', 1000, 'MGA', 'confirmed', 'x')`, [h.hotelId, invoiceId])))).message).toMatch(/saas_payment_confirmation_is_real/);
  });

  it('un événement prestataire ne peut être rejoué (même identifiant d\'événement = un seul paiement)', async () => {
    const { h, invoiceId } = await setup();
    const ins = () => plat((tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, provider_code, provider_event_id) VALUES ($1, $2, 'card', 1000, 'MGA', 'confirmed', 'psp-tx-001', 'psp', 'evt_001')`, [h.hotelId, invoiceId]));
    await ins();
    expect((await sqlState(ins())).code).toBe('23505');
  });

  it('exige une référence de transaction pour un virement ou un Mobile Money déclaré, sauf espèces', async () => {
    const { h, invoiceId } = await setup();
    expect((await sqlState(declare(h, invoiceId, { ref: null }))).code).toBe('23514');
    await declare(h, invoiceId, { ref: null, status: 'pending' }); // simple intention de paiement
    await declare(h, invoiceId, { method: 'cash', ref: null });
  });

  it('refuse un paiement sur un brouillon, dans une autre devise, ou sur la facture d\'un autre hôtel', async () => {
    const { h, invoiceId } = await setup();
    const draft = randomUUID();
    await plat((tx) => tx.query(`INSERT INTO saas_invoices (id, hotel_id, currency) VALUES ($1, $2, 'MGA')`, [draft, h.hotelId]));
    expect((await sqlState(declare(h, draft))).message).toBe('invoice_not_found'); // un brouillon est invisible de l'hôtel
    expect((await sqlState(plat((tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference) VALUES ($1, $2, 'cash', 1000, 'MGA', 'pending', NULL)`, [h.hotelId, draft])))).message).toBe('invoice_not_payable');
    expect((await sqlState(declare(h, invoiceId, { currency: 'EUR' }))).message).toBe('payment_currency_mismatch');
    const other = await setup();
    expect((await sqlState(declare(h, other.invoiceId))).message).toBe('invoice_not_found');
  });

  it('un paiement n\'est jamais supprimé ; confirmé il ne revient pas en arrière ; ses montants sont figés', async () => {
    const { h, invoiceId } = await setup();
    const p = await declare(h, invoiceId);
    expect((await sqlState(plat((tx) => tx.query('DELETE FROM saas_payments WHERE id = $1', [p])))).code).toBe('42501');
    expect((await sqlState(db.admin.query('DELETE FROM saas_payments WHERE id = $1', [p]))).message).toBe('payment_not_deletable');
    await confirm(p);
    expect((await sqlState(plat((tx) => tx.query("UPDATE saas_payments SET status = 'pending' WHERE id = $1", [p])))).message).toBe('payment_status_transition_invalid');
    expect((await sqlState(plat((tx) => tx.query('UPDATE saas_payments SET amount = 1 WHERE id = $1', [p])))).message).toBe('payment_immutable');
    await plat((tx) => tx.query("UPDATE saas_payments SET status = 'refunded' WHERE id = $1", [p])); // un remboursement reste possible
    expect(await balance(invoiceId)).toMatchObject({ paid: 0, status: 'unpaid' });
  });

  it('signale le retard uniquement tant qu\'il reste un solde', async () => {
    const { h, invoiceId } = await setup(50_000, '-2 days');
    expect((await balance(invoiceId)).is_overdue).toBe(true);
    await confirm(await declare(h, invoiceId, { amount: 50_000 }));
    expect((await balance(invoiceId)).is_overdue).toBe(false);
  });

  it('un hôtel ne voit que ses paiements', async () => {
    const a = await setup();
    const b = await setup();
    await declare(a.h, a.invoiceId);
    await declare(b.h, b.invoiceId);
    const seen = (await asHotel(a.h, (tx) => tx.query('SELECT hotel_id FROM saas_payments'))).rows;
    expect(seen).toHaveLength(1);
    expect(seen[0].hotel_id).toBe(a.h.hotelId);
  });

  it('l\'idempotence évite d\'enregistrer deux fois une même déclaration rejouée', async () => {
    const { h, invoiceId } = await setup();
    const key = randomUUID();
    const ins = () => asHotel(h, (tx) => tx.query(
      `INSERT INTO saas_payments (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, idempotency_key) VALUES ($1, $2, 'mvola', 1000, 'MGA', 'awaiting_validation', 'R1', $3)`, [h.hotelId, invoiceId, key]));
    await ins();
    expect((await sqlState(ins())).code).toBe('23505');
  });
});

describe('moyens de paiement SaaS : aucun connecteur « automatique » sans vraie connexion', () => {
  it('refuse d\'activer un moyen non configuré, ou un connecteur automatisé simplement « configuré »', async () => {
    const attempts = [
      "UPDATE payment_connectors SET is_enabled = true WHERE code = 'mvola'",
      "UPDATE payment_connectors SET status = 'configured', is_enabled = true WHERE code = 'card'",
      "UPDATE payment_connectors SET status = 'connected', is_enabled = true WHERE code = 'card'",
      "UPDATE payment_connectors SET mode = 'manual', status = 'connected' WHERE code = 'mvola'",
    ];
    for (const sql of attempts) {
      const r = await sqlState(plat((tx) => tx.query(sql)));
      expect(r.code, sql).toBe('23514');
    }
  });

  it('un moyen manuel configuré peut être activé ; les secrets restent invisibles de l\'hôtel', async () => {
    await plat((tx) => tx.query("UPDATE payment_connectors SET status = 'configured', is_enabled = true, instructions = 'Envoyez au 034 00 000 00 (Hotel Manager Pro) puis saisissez la référence' WHERE code = 'mvola'"));
    const h = await registerHotel(db);
    const row = (await asHotel(h, (tx) => tx.query("SELECT code, mode, is_enabled, instructions FROM payment_connectors WHERE code = 'mvola'"))).rows[0];
    expect(row).toMatchObject({ code: 'mvola', mode: 'manual', is_enabled: true });
    expect((await sqlState(asHotel(h, (tx) => tx.query('SELECT 1 FROM payment_connector_credentials')))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query("UPDATE payment_connectors SET is_enabled = false")))).code).toBe('42501');
  });

  it('un connecteur automatisé exige une connexion réelle documentée (fournisseur + date de connexion)', async () => {
    const r = await sqlState(plat((tx) => tx.query("UPDATE payment_connectors SET status = 'connected', provider = 'psp', is_enabled = true WHERE code = 'card'")));
    expect(r.code).toBe('23514');
    await plat((tx) => tx.query("UPDATE payment_connectors SET status = 'connected', provider = 'psp', connected_at = now(), is_enabled = true WHERE code = 'card'"));
    await plat((tx) => tx.query("UPDATE payment_connectors SET status = 'disabled', is_enabled = false WHERE code = 'card'"));
  });
});
