import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE, createTestDb, registerHotel, sqlState, withPlatform, withTenant, type HotelFixture, type TestDb } from './helpers.js';

// Fichier dédié : les agrégats exigent une base ne contenant QUE les abonnements créés ici.
let db: TestDb;

const plat = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withPlatform(db.app, fn, ROLE);
const asHotel = <T>(h: HotelFixture, fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: h.hotelId, userId: h.userId }, fn, ROLE);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe('revenus récurrents (MRR / ARR) — par devise, sans conversion supposée', () => {
  it('compte les abonnements actifs et impayés, normalise l\'annuel, exclut essais et résiliés, applique les remises', async () => {
    const mk = async (o: { status: string; interval: 'month' | 'year'; price: number; discount?: number }) => {
      const h = await registerHotel(db, { plan: 'starter' });
      await plat((tx) => tx.query(
        `UPDATE subscriptions SET status = $2, billing_interval = $3, price_amount = $4, discount_amount = $5,
                trial_ends_at = CASE WHEN $2 = 'trialing' THEN trial_ends_at END, ended_at = CASE WHEN $2 IN ('cancelled', 'expired') THEN now() END
         WHERE hotel_id = $1`, [h.hotelId, o.status, o.interval, o.price, o.discount ?? 0]));
      return h;
    };
    await mk({ status: 'active', interval: 'month', price: 180_000, discount: 30_000 }); // 150 000 / mois
    await mk({ status: 'active', interval: 'year', price: 1_800_000 });                  // 150 000 / mois
    await mk({ status: 'past_due', interval: 'month', price: 80_000 });                  //  80 000 / mois (impayé non résilié)
    await mk({ status: 'trialing', interval: 'month', price: 350_000 });                 // essai : exclu
    await mk({ status: 'cancelled', interval: 'month', price: 350_000 });                // résilié : exclu
    await mk({ status: 'expired', interval: 'year', price: 3_500_000 });                 // expiré : exclu
    const { rows } = await plat((tx) => tx.query('SELECT currency, subscriptions::int AS n, mrr::int AS mrr, arr::int AS arr FROM platform_mrr'));
    expect(rows).toEqual([{ currency: 'MGA', n: 3, mrr: 380_000, arr: 4_560_000 }]);
  });

  it('un hôtel n\'a pas accès aux indicateurs commerciaux de la plateforme', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    expect((await sqlState(asHotel(h, (tx) => tx.query('SELECT * FROM platform_mrr')))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query('SELECT * FROM platform_hotel_directory')))).code).toBe('42501');
  });
});
