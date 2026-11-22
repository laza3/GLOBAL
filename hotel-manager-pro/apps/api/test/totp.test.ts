import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, stepAt, totpCode, verifyTotp } from '../src/lib/totp';
import { Client, PASSWORD, createPlatformAdmin, createTestApp, platformLogin, q, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('TOTP (RFC 6238)', () => {
  // Vecteurs de l'annexe B de la RFC 6238 (secret ASCII « 12345678901234567890 », SHA-1, tronqués à 6 chiffres)
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('produit les codes de référence de la RFC', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('tolère un pas de dérive, refuse le rejeu et les formats invalides', () => {
    const now = new Date(1111111109 * 1000);
    expect(verifyTotp(secret, '081804', now, null)).toBe(37037036);
    expect(verifyTotp(secret, '081804', now, 37037036)).toBeNull(); // déjà utilisé
    expect(verifyTotp(secret, '081804', new Date((1111111109 + 30) * 1000), null)).toBe(37037036); // un pas de retard
    expect(verifyTotp(secret, '081804', new Date((1111111109 + 90) * 1000), null)).toBeNull(); // trop ancien
    for (const bad of ['', '12345', '1234567', 'abcdef', '08180 4']) expect(verifyTotp(secret, bad, now, null)).toBeNull();
  });
});

describe('double authentification des super-administrateurs', () => {
  it('activation, connexion en deux temps, rejeu refusé, codes de secours, verrouillage, désactivation', async () => {
    const admin = await createPlatformAdmin(t);
    const c = await platformLogin(t, admin);
    expect((await c.get('/api/v1/platform/me')).body.admin).toMatchObject({ totpEnabled: false });
    // avant le démarrage : rien à activer
    expect((await c.post('/api/v1/platform/auth/totp/enable', { code: '123456' })).body.error.code).toBe('totp_not_ready');
    const setup = await c.post('/api/v1/platform/auth/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.headers['cache-control']).toContain('no-store');
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
    // le secret est chiffré en base (jamais en clair)
    const [row] = await q(t, 'SELECT totp_secret_enc FROM platform_admins WHERE id = $1', [admin.id]);
    expect(Buffer.from(row.totp_secret_enc).toString('utf8')).not.toContain(setup.body.secret);
    // un mauvais code n'active rien
    const s = setup.body.secret as string;
    expect((await c.post('/api/v1/platform/auth/totp/enable', { code: '000000' })).body.error.code).toBe('totp_invalid');
    const step = stepAt(new Date());
    const enable = await c.post('/api/v1/platform/auth/totp/enable', { code: totpCode(s, step) });
    expect(enable.status, JSON.stringify(enable.body)).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(8);
    expect(enable.headers['cache-control']).toContain('no-store');
    expect((await c.get('/api/v1/platform/me')).body.admin).toMatchObject({ totpEnabled: true, recoveryCodesLeft: 8 });
    expect((await c.post('/api/v1/platform/auth/totp/setup')).body.error.code).toBe('totp_already_enabled');
    // les codes de secours ne sont stockés que hachés
    const [hashes] = await q(t, 'SELECT totp_recovery_hashes AS h FROM platform_admins WHERE id = $1', [admin.id]);
    expect(hashes.h.some((h: string) => enable.body.recoveryCodes.includes(h))).toBe(false);

    const login = (body: Record<string, unknown>) => new Client(t, 'hmp_platform_csrf').post('/api/v1/platform/auth/login', { email: admin.email, password: admin.password, ...body });
    // mot de passe seul : refusé, et AUCUNE session créée
    const first = await login({});
    expect(first.status).toBe(401);
    expect(first.body.error.code).toBe('totp_required');
    expect(first.cookies).toEqual([]);
    expect((await login({ code: '000000' })).body.error.code).toBe('totp_invalid');
    // le code utilisé à l'activation ne peut pas servir une seconde fois ; le pas suivant passe
    expect((await login({ code: totpCode(s, step) })).body.error.code).toBe('totp_invalid');
    const ok = await login({ code: totpCode(s, step + 1) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.cookies.length).toBeGreaterThan(0);
    expect((await login({ code: totpCode(s, step + 1) })).body.error.code).toBe('totp_invalid'); // rejeu
    // code de secours : une seule fois
    const recovery = enable.body.recoveryCodes[0] as string;
    expect((await login({ code: recovery })).status).toBe(200);
    expect((await login({ code: recovery })).body.error.code).toBe('totp_invalid');
    expect((await c.get('/api/v1/platform/me')).body.admin.recoveryCodesLeft).toBe(7);
    // mauvaise connexion : le mauvais mot de passe ne révèle pas l'état du deuxième facteur
    expect((await login({ password: 'Mauvais-mot-de-passe-1' })).body.error.code).toBe('invalid_credentials');
    // désactivation : mot de passe ET code (un nouveau pas de 30 s : on simule son écoulement en libérant le dernier pas accepté)
    await q(t, 'UPDATE platform_admins SET totp_last_step = NULL WHERE id = $1', [admin.id]);
    const d1 = await c.post('/api/v1/platform/auth/totp/disable', { password: 'Mauvais-mot-de-passe-1', code: totpCode(s, step) });
    expect(d1.status).toBeGreaterThanOrEqual(400);
    const d2 = await c.post('/api/v1/platform/auth/totp/disable', { password: PASSWORD, code: totpCode(s, step) });
    expect(d2.status).toBe(204);
    expect((await login({})).status).toBe(200);
    expect((await q(t, "SELECT count(*)::int AS n FROM platform_audit_logs WHERE action IN ('platform.totp_enabled', 'platform.totp_disabled', 'platform.recovery_code_used')"))[0].n).toBe(3);
  });

  it('des codes faux répétés verrouillent le compte (6 chiffres ne se forcent pas)', async () => {
    const admin = await createPlatformAdmin(t);
    const c = await platformLogin(t, admin);
    const s = (await c.post('/api/v1/platform/auth/totp/setup')).body.secret as string;
    await c.post('/api/v1/platform/auth/totp/enable', { code: totpCode(s, stepAt(new Date())) });
    const bad = () => new Client(t, 'hmp_platform_csrf').post('/api/v1/platform/auth/login', { email: admin.email, password: admin.password, code: '111111' });
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) codes.push((await bad()).body.error.code);
    expect(codes.slice(0, 4)).toEqual(['totp_invalid', 'totp_invalid', 'totp_invalid', 'totp_invalid']);
    expect(codes.slice(4)).toEqual(['account_locked', 'account_locked']);
    // même le bon code est refusé pendant le verrouillage
    const good = await new Client(t, 'hmp_platform_csrf').post('/api/v1/platform/auth/login', { email: admin.email, password: admin.password, code: totpCode(s, stepAt(new Date()) + 1) });
    expect(good.body.error.code).toBe('account_locked');
  });
});
