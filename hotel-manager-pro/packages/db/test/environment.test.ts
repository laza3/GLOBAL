import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertEnvironment, assertEnvironmentAsAdmin, claimEnvironment, EnvironmentMismatchError, readEnvironmentAsAdmin,
} from '../src/environment.js';
import { withoutTenant } from '../src/client.js';
import { ROLE, createTestDb, sqlState, withPlatform, type TestDb } from './helpers.js';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.drop(); });

const asApp = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withoutTenant(db.app, fn, ROLE);
const asPlatform = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withPlatform(db.app, fn, ROLE);

describe('marqueur d\'environnement de la base (0022)', () => {
  it('une base neuve n\'a pas de marqueur ; le premier démarrage le pose', async () => {
    const admin = await db.admin.connect();
    try {
      expect(await readEnvironmentAsAdmin(admin)).toBeNull();
    } finally { admin.release(); }
    expect(await asApp((tx) => claimEnvironment(tx, 'staging'))).toBe('staging');
  });

  it('le marqueur posé l\'emporte : une autre demande ne le change jamais', async () => {
    expect(await asApp((tx) => claimEnvironment(tx, 'production'))).toBe('staging');
    expect(await asPlatform((tx) => claimEnvironment(tx, 'development'))).toBe('staging');
    const admin = await db.admin.connect();
    try {
      expect(await readEnvironmentAsAdmin(admin)).toBe('staging');
    } finally { admin.release(); }
  });

  it('assertEnvironment accepte le bon environnement et refuse un autre (arrêt, aucun mélange)', async () => {
    await expect(asApp((tx) => assertEnvironment(tx, 'staging'))).resolves.toBeUndefined();
    const err = await asApp((tx) => assertEnvironment(tx, 'production')).catch((e) => e);
    expect(err).toBeInstanceOf(EnvironmentMismatchError);
    expect(err).toMatchObject({ expected: 'production', actual: 'staging' });
    expect(String(err.message)).toMatch(/mélanger données de test et données réelles/);
    const admin = await db.admin.connect();
    try {
      await expect(assertEnvironmentAsAdmin(admin, 'staging')).resolves.toBeUndefined();
      await expect(assertEnvironmentAsAdmin(admin, 'production')).rejects.toBeInstanceOf(EnvironmentMismatchError);
    } finally { admin.release(); }
  });

  it('refuse une valeur inconnue', async () => {
    expect((await sqlState(asApp((tx) => tx.query("SELECT environment_claim('recette')")))).code).toBe('22023');
    expect((await sqlState(asApp((tx) => tx.query('SELECT environment_claim(NULL)')))).code).toBe('22023');
  });

  it('les rôles applicatifs n\'ont AUCUN accès direct à la table (ni lecture, ni modification)', async () => {
    expect((await sqlState(asApp((tx) => tx.query('SELECT * FROM deployment_marker')))).code).toBe('42501');
    expect((await sqlState(asApp((tx) => tx.query("UPDATE deployment_marker SET environment = 'production'")))).code).toBe('42501');
    expect((await sqlState(asApp((tx) => tx.query('DELETE FROM deployment_marker')))).code).toBe('42501');
    expect((await sqlState(asPlatform((tx) => tx.query("UPDATE deployment_marker SET environment = 'production'")))).code).toBe('42501');
  });

  it('une seule ligne est possible', async () => {
    expect((await sqlState(db.admin.query("INSERT INTO deployment_marker (singleton, environment) VALUES (false, 'production')"))).code).toBe('23514');
    expect((await sqlState(db.admin.query("INSERT INTO deployment_marker (environment) VALUES ('production')"))).code).toBe('23505');
  });
});
