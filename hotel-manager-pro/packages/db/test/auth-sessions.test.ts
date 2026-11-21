import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../src/client.js';
import { ROLE, createTestDb, registerHotel, sqlState, type HotelFixture, type TestDb } from './helpers.js';

let db: TestDb;
let H: HotelFixture;

const anon = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withoutTenant(db.app, fn, ROLE);
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const create = (userId: string, hotelId: string, token: string, ttl = '8 hours') =>
  anon((tx) => tx.query('SELECT auth_create_session($1, $2, $3, $4, $5, $6::interval) AS id', [userId, hotelId, hashOf(token), '10.0.0.1', 'test-agent', ttl]));
const resolve = async (token: string) => (await anon((tx) => tx.query('SELECT * FROM auth_resolve_session($1)', [hashOf(token)]))).rows[0] as
  { user_id: string; hotel_id: string; role_key: string; permissions: string[]; hotel_status: string } | undefined;

beforeAll(async () => {
  db = await createTestDb();
  H = await registerHotel(db, { plan: 'starter' });
  await db.admin.query(`INSERT INTO role_permissions (hotel_id, role_id, permission) VALUES ($1, $2, 'rooms:read'), ($1, $2, 'guests:read')`, [H.hotelId, H.roleId]);
});
afterAll(async () => {
  await db.drop();
});

describe('sessions : création et résolution', () => {
  it('résout un jeton en identité, rôle et permissions (jamais le jeton lui-même en base)', async () => {
    const token = `tok-${randomUUID()}`;
    await create(H.userId, H.hotelId, token);
    expect(await resolve(token)).toMatchObject({ user_id: H.userId, hotel_id: H.hotelId, role_key: 'owner', permissions: ['guests:read', 'rooms:read'], hotel_status: 'onboarding' });
    const { rows } = await db.admin.query('SELECT token_hash FROM sessions WHERE user_id = $1', [H.userId]);
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it('un jeton inconnu, expiré ou révoqué ne résout rien', async () => {
    expect(await resolve('inconnu')).toBeUndefined();
    const expired = `tok-${randomUUID()}`;
    await create(H.userId, H.hotelId, expired, '1 second');
    await db.admin.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hashOf(expired)]);
    expect(await resolve(expired)).toBeUndefined();
    const revoked = `tok-${randomUUID()}`;
    await create(H.userId, H.hotelId, revoked);
    await anon((tx) => tx.query('SELECT auth_revoke_session($1)', [hashOf(revoked)]));
    expect(await resolve(revoked)).toBeUndefined();
  });

  it('refuse de créer une session pour un établissement dont on n\'est pas membre', async () => {
    const other = await registerHotel(db, { plan: 'starter' });
    const r = await sqlState(create(H.userId, other.hotelId, `tok-${randomUUID()}`));
    expect(r.code).toBe('HM001');
    expect(r.message).toBe('not_a_member');
  });

  it('refuse une durée de vie absurde', async () => {
    expect((await sqlState(create(H.userId, H.hotelId, `tok-${randomUUID()}`, '400 days'))).message).toBe('invalid_session_ttl');
    expect((await sqlState(create(H.userId, H.hotelId, `tok-${randomUUID()}`, '0 seconds'))).message).toBe('invalid_session_ttl');
  });

  it('une suspension, un utilisateur désactivé ou une adhésion désactivée coupent la session immédiatement', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const token = `tok-${randomUUID()}`;
    await create(h.userId, h.hotelId, token);
    expect(await resolve(token)).toMatchObject({ hotel_status: 'onboarding' });
    await db.admin.query(`UPDATE hotels SET status = 'suspended', suspended_at = now(), suspension_reason = 'test' WHERE id = $1`, [h.hotelId]);
    expect((await resolve(token))?.hotel_status).toBe('suspended'); // résolue : c'est l'API qui bloque selon l'état (message clair)
    await db.admin.query(`UPDATE hotels SET status = 'closed', closed_at = now() WHERE id = $1`, [h.hotelId]);
    expect(await resolve(token)).toBeUndefined();
    await db.admin.query(`UPDATE hotels SET status = 'active', closed_at = NULL WHERE id = $1`, [h.hotelId]);
    expect(await resolve(token)).toBeDefined();
    await db.admin.query(`UPDATE memberships SET status = 'disabled' WHERE hotel_id = $1`, [h.hotelId]);
    expect(await resolve(token)).toBeUndefined();
    await db.admin.query(`UPDATE memberships SET status = 'active' WHERE hotel_id = $1`, [h.hotelId]);
    await db.admin.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [h.userId]);
    expect(await resolve(token)).toBeUndefined();
  });

  it('un établissement fermé n\'accepte plus de nouvelle session', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    await db.admin.query(`UPDATE hotels SET status = 'closed', closed_at = now() WHERE id = $1`, [h.hotelId]);
    expect((await sqlState(create(h.userId, h.hotelId, `tok-${randomUUID()}`))).message).toBe('not_a_member');
  });

  it('révoquer toutes les sessions d\'un utilisateur, sauf la courante', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const [a, b, c] = [`tok-${randomUUID()}`, `tok-${randomUUID()}`, `tok-${randomUUID()}`];
    for (const t of [a, b, c]) await create(h.userId, h.hotelId, t);
    const { rows } = await anon((tx) => tx.query('SELECT auth_revoke_user_sessions($1, $2) AS n', [h.userId, hashOf(b)]));
    expect(rows[0].n).toBe(2);
    expect(await resolve(a)).toBeUndefined();
    expect(await resolve(b)).toBeDefined();
    expect(await resolve(c)).toBeUndefined();
  });

  it('le rôle applicatif ne peut pas lire ni modifier les sessions directement', async () => {
    for (const sql of ['SELECT * FROM sessions', "UPDATE sessions SET expires_at = now() + interval '10 years'", 'DELETE FROM sessions', 'INSERT INTO sessions (user_id, token_hash, expires_at) SELECT id, \'x\', now() FROM users LIMIT 1']) {
      expect((await sqlState(anon((tx) => tx.query(sql)))).code, sql).toBe('42501');
    }
  });
});

describe('verrouillage de compte et mots de passe', () => {
  it('verrouille le compte après le nombre d\'échecs autorisé, et la connexion réussie remet le compteur à zéro', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const fail = () => anon((tx) => tx.query('SELECT auth_login_failed($1, 3, 15) AS locked', [h.userId]));
    expect((await fail()).rows[0].locked).toBeNull();
    expect((await fail()).rows[0].locked).toBeNull();
    const third = (await fail()).rows[0].locked as Date;
    expect(third.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const { rows } = await anon((tx) => tx.query('SELECT failed_attempts, locked_until FROM auth_find_user($1)', [h.email]));
    expect(rows[0].failed_attempts).toBe(3);
    await anon((tx) => tx.query('SELECT auth_login_succeeded($1)', [h.userId]));
    const after = await anon((tx) => tx.query('SELECT failed_attempts, locked_until FROM auth_find_user($1)', [h.email]));
    expect(after.rows[0]).toMatchObject({ failed_attempts: 0, locked_until: null });
  });

  it('change le mot de passe (déverrouille) sans exposer l\'ancien', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    await anon((tx) => tx.query('SELECT auth_login_failed($1, 1, 15)', [h.userId]));
    await anon((tx) => tx.query('SELECT auth_set_password($1, $2)', [h.userId, '$argon2id$nouveau-hash']));
    const { rows } = await anon((tx) => tx.query('SELECT password_hash, failed_attempts, locked_until FROM auth_find_user($1)', [h.email]));
    expect(rows[0]).toMatchObject({ password_hash: '$argon2id$nouveau-hash', failed_attempts: 0, locked_until: null });
  });

  it('liste les établissements d\'un utilisateur actif membre', async () => {
    const { rows } = await anon((tx) => tx.query('SELECT * FROM auth_user_hotels($1)', [H.userId]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hotel_id: H.hotelId, role_key: 'owner' });
  });
});
