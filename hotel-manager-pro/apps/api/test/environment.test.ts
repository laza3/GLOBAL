import { EnvironmentMismatchError } from '@hmp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { assertDatabaseEnvironment } from '../src/lib/environment';
import { Client, createTestApp, type TestApp } from './helpers';

const base = { DATABASE_URL_APP: 'x', DATABASE_URL_PLATFORM: 'x', CSRF_SECRET: 'z'.repeat(40), ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };

describe('APP_ENV : règles de configuration', () => {
  it('vaut « development » par défaut hors production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).appEnv).toBe('development');
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).appEnv).toBe('development');
  });
  it('est OBLIGATOIRE en production : jamais de « production » par oubli', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/APP_ENV est obligatoire/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'staging' }).appEnv).toBe('staging');
    expect(loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'production' }).appEnv).toBe('production');
  });
  it('staging et production gardent les réglages de sécurité de la production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'development', APP_ENV: 'staging' })).toThrow(/exige NODE_ENV=production/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'development', APP_ENV: 'production' })).toThrow(/exige NODE_ENV=production/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'development' })).toThrow(/incompatible/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'staging', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });
  it('refuse une valeur inconnue', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'recette' })).toThrow(/APP_ENV/);
  });
});

describe('garde-fou de démarrage et /meta', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it('GET /meta annonce l\'environnement de l\'instance (public, sans donnée)', async () => {
    const res = await new Client(t).get('/api/v1/meta');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ environment: 'development' });
  });

  it('pose le marqueur au premier démarrage, accepte le même environnement, refuse un autre', async () => {
    await expect(assertDatabaseEnvironment(t.db, { appEnv: 'staging' })).resolves.toBeUndefined();
    await expect(assertDatabaseEnvironment(t.db, { appEnv: 'staging' })).resolves.toBeUndefined();
    await expect(assertDatabaseEnvironment(t.db, { appEnv: 'production' })).rejects.toBeInstanceOf(EnvironmentMismatchError);
    await expect(assertDatabaseEnvironment(t.db, { appEnv: 'development' })).rejects.toThrow(/appartient à l'environnement « staging »/);
  });
});
