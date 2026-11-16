import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Db } from '@gp/core/db';
import { createGpServer } from '../src/server';

let base = '';
let close: () => Promise<void>;
const H = { 'Content-Type': 'application/json', 'X-GP-Request': '1' };
const SETUP = {
  companyName: 'Boutique Test', admin: { username: 'admin', displayName: 'Admin', password: 'Motdepasse1!' },
};

async function call(method: string, params?: unknown, cookie = '', headers: Record<string, string> = H) {
  const r = await fetch(base + '/api/call', { method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ method, params }) });
  const setCookie = r.headers.get('set-cookie') ?? '';
  return { status: r.status, body: (await r.json()) as any, cookie: setCookie.split(';')[0] ?? '', setCookie };
}

beforeAll(async () => {
  const { server } = createGpServer({ db: new Db(':memory:'), version: 'test', publicDir: resolve(__dirname, 'site'), setupCode: 'CODE1234' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
});
afterAll(() => close());

describe('serveur web — installation et session', () => {
  it('refuse la première configuration sans le bon code', async () => {
    const bad = await call('app.setup', { ...SETUP, setupCode: 'MAUVAIS' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('SETUP_CODE');
    expect((await call('app.status')).body.data.configured).toBe(false);
  });

  it('configure avec le bon code et pose un cookie HttpOnly sans jamais renvoyer le jeton', async () => {
    const r = await call('app.setup', { ...SETUP, setupCode: 'CODE1234' });
    expect(r.body.ok).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/token/i);
    expect(r.setCookie).toMatch(/HttpOnly/);
    expect(r.setCookie).toMatch(/SameSite=Strict/);
    expect(r.cookie).toMatch(/^gp_session=/);
  });

  it('une fois configuré, plus personne ne peut reconfigurer', async () => {
    const r = await call('app.setup', { ...SETUP, setupCode: 'CODE1234' });
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe('ALREADY_CONFIGURED');
  });

  it('un appel sans session est refusé, avec session il passe', async () => {
    expect((await call('company.get')).body.error.code).toBe('UNAUTHENTICATED');
    const login = await call('auth.login', { username: 'admin', password: 'Motdepasse1!' });
    expect(login.body.ok).toBe(true);
    const co = await call('company.get', undefined, login.cookie);
    expect(co.body.data.name).toBe('Boutique Test');
    const out = await call('auth.logout', undefined, login.cookie);
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call('company.get', undefined, login.cookie)).body.error.code).toBe('UNAUTHENTICATED');
  });

  it('deux sessions indépendantes (gérant sur PC, vendeuse sur téléphone) voient les mêmes données', async () => {
    const admin = await call('auth.login', { username: 'admin', password: 'Motdepasse1!' });
    const roles = (await call('roles.list', undefined, admin.cookie)).body.data as any[];
    const cashier = roles.find((x) => x.code === 'CASHIER');
    const created = await call('users.create', { username: 'vendeuse1', displayName: 'Vendeuse', password: 'Temporaire1!', roleId: cashier.id }, admin.cookie);
    expect(created.body.ok).toBe(true);
    const v = await call('auth.login', { username: 'vendeuse1', password: 'Temporaire1!' });
    expect(v.body.data.mustChangePassword).toBe(true);
    // la vendeuse ne peut pas administrer
    const denied = await call('users.list', undefined, v.cookie);
    expect(denied.body.ok).toBe(false);
    // l'administrateur voit bien le nouveau compte
    const users = (await call('users.list', undefined, admin.cookie)).body.data as any[];
    expect(users.map((u) => u.username)).toContain('vendeuse1');
  });
});

describe('serveur web — protections', () => {
  it('exige l’en-tête anti-CSRF et le type JSON', async () => {
    expect((await call('app.status', undefined, '', { 'Content-Type': 'application/json' })).status).toBe(403);
    const r = await fetch(base + '/api/call', { method: 'POST', headers: { 'X-GP-Request': '1', 'Content-Type': 'text/plain' }, body: '{}' });
    expect(r.status).toBe(415);
  });

  it('refuse GET sur l’API, les JSON invalides et les corps trop gros', async () => {
    expect((await fetch(base + '/api/call')).status).toBe(405);
    const bad = await fetch(base + '/api/call', { method: 'POST', headers: H, body: '{pas du json' });
    expect(bad.status).toBe(400);
    const big = await fetch(base + '/api/call', { method: 'POST', headers: H, body: JSON.stringify({ method: 'app.status', params: 'x'.repeat(3_500_000) }) });
    expect(big.status).toBe(413);
  });

  it('envoie les en-têtes de sécurité et sert le site sans sortir du dossier public', async () => {
    const r = await fetch(base + '/');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(await r.text()).toContain('GP');
    expect((await fetch(base + '/assets/app-abc.js')).headers.get('cache-control')).toContain('immutable');
    // repli SPA pour une route, 404 pour un fichier absent
    expect((await fetch(base + '/une/route')).status).toBe(200);
    expect((await fetch(base + '/absent.js')).status).toBe(404);
    // traversée de dossiers (encodée, sinon fetch normalise l'adresse)
    const raw = await fetch(base + '/..%2Fsecret.txt');
    expect(await raw.text()).not.toContain('SECRET');
  });

  it('opérations système : refusées sans session, restauration non exposée sur le web', async () => {
    const sys = (op: string, cookie = '') => fetch(base + '/api/system', { method: 'POST', headers: { ...H, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ op }) }).then((r) => r.json() as Promise<any>);
    expect((await sys('backup')).error.code).toBe('UNAUTHENTICATED');
    const admin = await call('auth.login', { username: 'admin', password: 'Motdepasse1!' });
    const b = await sys('backup', admin.cookie);
    expect(b.ok).toBe(true);
    expect(Buffer.from(b.data.base64, 'base64').subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await sys('restore', admin.cookie)).error.code).toBe('NOT_AVAILABLE');
    expect((await sys('inexistante', admin.cookie)).ok).toBe(false);
  });

  it('limite les tentatives de connexion par adresse', async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await call('auth.login', { username: 'inconnu', password: 'xxxxxxxx' })).status;
    expect(last).toBe(429);
  });

});
