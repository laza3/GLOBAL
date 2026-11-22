import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

/** Routes volontairement publiques (inscription, connexion, textes légaux, catalogue, santé). Toute autre route exige une session. */
const PUBLIC = new Set([
  'GET /api/v1/health', 'GET /api/v1/ready', 'GET /api/v1/legal', 'GET /api/v1/plans',
  'POST /api/v1/auth/register-hotel', 'POST /api/v1/auth/login', 'POST /api/v1/auth/logout',
  'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password',
  'POST /api/v1/platform/auth/login', 'POST /api/v1/platform/auth/logout',
]);
const UUID = '00000000-0000-4000-8000-000000000000';

describe('audit des routes : aucune route privée n\'est accessible sans session', () => {
  it('chaque route de l\'API répond 401 à un anonyme (hors liste publique explicite)', async () => {
    const spec = t.app.swagger() as { paths: Record<string, Record<string, unknown>> };
    const anon = new Client(t);
    const offenders: string[] = [];
    let checked = 0;
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        const m = method.toUpperCase();
        if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(m)) continue;
        const url = path.replace(/\{[^}]+\}/g, UUID);
        if (!url.startsWith('/api/v1/')) continue;
        const key = `${m} ${url.replace(UUID, '{id}')}`;
        const generic = `${m} ${path.replace(/\{[^}]+\}/g, '{id}')}`;
        if (PUBLIC.has(`${m} ${url}`) || PUBLIC.has(generic)) continue;
        const res = await anon.call(m as 'GET', url, m === 'GET' || m === 'DELETE' ? undefined : {});
        checked++;
        if (res.status !== 401) offenders.push(`${generic} → ${res.status}`);
        void key;
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(offenders).toEqual([]);
  });
});
