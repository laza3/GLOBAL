import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '@hmp/shared';
import { Client, ORIGIN, PASSWORD, addStaff, createTestApp, q, registerHotel, uniqueEmail, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('inscription d\'un établissement', () => {
  it('crée l\'hôtel, le propriétaire, 7 rôles, les moyens d\'encaissement et un essai gratuit ; ouvre la session', async () => {
    const reg = await registerHotel(t, { hotelName: 'Hôtel Baobab', city: 'Nosy Be' });
    const me = await reg.client.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { email: reg.email, fullName: 'Hanitra Rasoamanana' },
      hotel: { name: 'Hôtel Baobab', status: 'onboarding' },
      role: { key: 'owner', name: 'Propriétaire' },
      access: { state: 'full', reason: null },
      entitlements: { source: 'subscription', planCode: 'business', isCurrent: true, subscriptionStatus: 'trialing', maxRooms: 30, maxUsers: 10 },
    });
    expect(me.body.permissions).toContain('subscription:manage');
    expect(me.body.permissions.length).toBeGreaterThan(35);

    const roles = await q(t, 'SELECT key FROM roles WHERE hotel_id = $1 ORDER BY key', [reg.hotelId]);
    expect(roles.map((r) => r.key)).toEqual(['accountant', 'admin', 'hk_manager', 'hk_staff', 'owner', 'receptionist', 'restaurant_manager']);
    expect((await q(t, 'SELECT code FROM payment_methods WHERE hotel_id = $1', [reg.hotelId])).map((r) => r.code).sort()).toEqual(['airtel_money', 'bank_transfer', 'card', 'cash', 'mvola', 'orange_money']);
    expect((await q(t, "SELECT count(*)::int AS n FROM subscription_events WHERE hotel_id = $1 AND event_type = 'trial_started'", [reg.hotelId]))[0].n).toBe(1);
    expect((await q(t, "SELECT action FROM audit_logs WHERE hotel_id = $1", [reg.hotelId])).map((r) => r.action)).toContain('hotel.registered');
    const settings = (await q(t, 'SELECT default_currency, timezone, locale FROM hotel_settings WHERE hotel_id = $1', [reg.hotelId]))[0];
    expect(settings).toEqual({ default_currency: 'MGA', timezone: 'Indian/Antananarivo', locale: 'fr' });
  });

  it('le mot de passe n\'est jamais stocké en clair : Argon2id', async () => {
    const reg = await registerHotel(t);
    const [u] = await q(t, 'SELECT password_hash FROM users WHERE id = $1', [reg.userId]);
    expect(u.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(u.password_hash).not.toContain(PASSWORD);
  });

  it('deux établissements du même nom obtiennent des identifiants distincts', async () => {
    const a = await registerHotel(t, { hotelName: 'Hôtel de la Plage', city: 'Mahajanga' });
    const b = await registerHotel(t, { hotelName: 'Hôtel de la Plage', city: 'Mahajanga' });
    expect(a.slug).toBe('hotel-de-la-plage-mahajanga');
    expect(b.slug).not.toBe(a.slug);
    expect(b.slug).toMatch(/^hotel-de-la-plage-mahajanga-[0-9a-f]{4}$/);
  });

  it('refuse un mot de passe faible, des conditions non acceptées, un fuseau inexistant, un e-mail déjà inscrit', async () => {
    const c = new Client(t);
    const base = { hotelName: 'Hôtel X', ownerName: 'Test Test', email: uniqueEmail(), password: PASSWORD, acceptTerms: true };
    const weak = await c.post('/api/v1/auth/register-hotel', { ...base, password: 'court1' });
    expect(weak.status).toBe(422);
    expect(weak.body.error).toMatchObject({ code: 'weak_password' });
    expect(weak.body.error.message).toMatch(/10 caractères/);
    expect((await c.post('/api/v1/auth/register-hotel', { ...base, password: 'uniquementdeslettres' })).body.error.code).toBe('weak_password');
    expect((await c.post('/api/v1/auth/register-hotel', { ...base, acceptTerms: false })).body.error.code).toBe('validation_error');
    expect((await c.post('/api/v1/auth/register-hotel', { ...base, email: 'pas-un-email' })).body.error.code).toBe('validation_error');
    const tz = await c.post('/api/v1/auth/register-hotel', { ...base, timezone: 'Africa/Antananarivo' });
    expect(tz.status).toBe(422);
    expect(tz.body.error.code).toBe('invalid_timezone');
    expect(tz.body.error.message).toContain('Indian/Antananarivo');
    const reg = await registerHotel(t);
    const dup = await new Client(t).post('/api/v1/auth/register-hotel', { ...base, email: reg.email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_already_registered');
    // une inscription refusée ne laisse AUCUNE trace (transaction annulée)
    expect((await q(t, "SELECT count(*)::int AS n FROM hotels WHERE name = 'Hôtel X'"))[0].n).toBe(0);
  });

  it('l\'inscription aboutit même quand la plateforme a désactivé l\'essai gratuit', async () => {
    await q(t, "UPDATE platform_settings SET value = 'false'::jsonb WHERE key = 'trial.enabled'");
    try {
      const reg = await registerHotel(t);
      const me = await reg.client.get('/api/v1/me');
      expect(me.body.entitlements).toMatchObject({ source: 'none', isCurrent: false });
      expect(me.body.access).toEqual({ state: 'read_only', reason: 'subscription_required', graceEndsAt: null });
    } finally {
      await q(t, "UPDATE platform_settings SET value = 'true'::jsonb WHERE key = 'trial.enabled'");
    }
  });
});

describe('connexion', () => {
  it('ouvre une session, renvoie le jeton CSRF, et pose des cookies sûrs', async () => {
    const reg = await registerHotel(t);
    const c = new Client(t);
    const res = await c.post('/api/v1/auth/login', { email: reg.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeTruthy();
    const session = res.cookies.find((x) => x.name === 'hmp_session')!;
    const csrf = res.cookies.find((x) => x.name === 'hmp_csrf')!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(csrf.httpOnly).toBeFalsy(); // lisible par l'application pour l'en-tête X-CSRF-Token
    expect(session.value).toHaveLength(43); // 256 bits en base64url
    expect(csrf.value).toBe(res.body.csrfToken);
    const [{ n }] = await q(t, 'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND token_hash = $2', [reg.userId, (await import('node:crypto')).createHash('sha256').update(session.value).digest('hex')]);
    expect(n).toBe(1); // seule l'empreinte est en base
    expect((await q(t, 'SELECT count(*)::int AS n FROM sessions WHERE token_hash = $1', [session.value]))[0].n).toBe(0);
  });

  it('un mauvais mot de passe et un e-mail inconnu donnent EXACTEMENT la même réponse (pas d\'énumération de comptes)', async () => {
    const reg = await registerHotel(t);
    const wrong = await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: 'Mauvais-mot-de-passe-1' });
    const unknown = await new Client(t).post('/api/v1/auth/login', { email: 'personne@example.test', password: 'Mauvais-mot-de-passe-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: any) => ({ code: b.error.code, message: b.error.message });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body.error.message).toBe('E-mail ou mot de passe incorrect.');
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe ; la réussite remet le compteur à zéro', async () => {
    const reg = await registerHotel(t);
    for (let i = 0; i < 4; i++) {
      expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: 'faux-faux-faux-1' })).status).toBe(401);
    }
    // une connexion réussie AVANT le seuil remet à zéro
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 4; i++) await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: 'faux-faux-faux-1' });
    const fifth = await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: 'faux-faux-faux-1' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('account_locked');
    const good = await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD });
    expect(good.status).toBe(423); // le bon mot de passe ne déverrouille pas
    await q(t, "UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1", [reg.userId]);
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD })).status).toBe(200);
  });

  it('un utilisateur de plusieurs établissements doit choisir ; un établissement étranger est refusé', async () => {
    const a = await registerHotel(t, { hotelName: 'Hôtel Alpha' });
    const b = await registerHotel(t, { hotelName: 'Hôtel Bravo' });
    // le propriétaire de A devient aussi membre de B (invité par l'administration)
    const [role] = await q(t, "SELECT id FROM roles WHERE hotel_id = $1 AND key = 'admin'", [b.hotelId]);
    await q(t, "INSERT INTO memberships (hotel_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')", [b.hotelId, a.userId, role.id]);
    const c = new Client(t);
    const pick = await c.post('/api/v1/auth/login', { email: a.email, password: PASSWORD });
    expect(pick.status).toBe(409);
    expect(pick.body.error.code).toBe('hotel_selection_required');
    expect(pick.body.error.details.map((h: any) => h.name).sort()).toEqual(['Hôtel Alpha', 'Hôtel Bravo']);
    expect(c.jar.has('hmp_session')).toBe(false); // aucune session tant que le choix n'est pas fait
    const inB = await c.post('/api/v1/auth/login', { email: a.email, password: PASSWORD, hotelId: b.hotelId });
    expect(inB.status).toBe(200);
    expect(inB.body).toMatchObject({ hotel: { name: 'Hôtel Bravo' }, role: { key: 'admin' } });
    expect(inB.body.permissions).not.toContain('subscription:manage'); // l'administrateur ne gère pas l'abonnement
    const other = await registerHotel(t, { hotelName: 'Hôtel Charlie' });
    expect((await new Client(t).post('/api/v1/auth/login', { email: a.email, password: PASSWORD, hotelId: other.hotelId })).body.error.code).toBe('not_a_member');
    // bascule d'établissement sans se reconnecter
    const sw = await c.post('/api/v1/auth/switch-hotel', { hotelId: a.hotelId });
    expect(sw.body.hotel.name).toBe('Hôtel Alpha');
    expect((await c.post('/api/v1/auth/switch-hotel', { hotelId: other.hotelId })).body.error.code).toBe('not_a_member');
  });

  it('un compte désactivé ne peut pas se connecter', async () => {
    const reg = await registerHotel(t);
    await q(t, "UPDATE users SET status = 'disabled' WHERE id = $1", [reg.userId]);
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD })).body.error.code).toBe('account_disabled');
  });
});

describe('sessions', () => {
  it('sans cookie ou avec un cookie inventé : 401', async () => {
    expect((await new Client(t).get('/api/v1/me')).status).toBe(401);
    const forged = new Client(t);
    forged.jar.set('hmp_session', 'a'.repeat(43));
    const res = await forged.get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('la déconnexion révoque la session côté serveur (le cookie volé ne sert plus)', async () => {
    const reg = await registerHotel(t);
    const stolen = new Client(t);
    stolen.jar.set('hmp_session', reg.client.jar.get('hmp_session')!);
    expect((await stolen.get('/api/v1/me')).status).toBe(200);
    expect((await reg.client.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await stolen.get('/api/v1/me')).status).toBe(401);
  });

  it('une session expirée est refusée', async () => {
    const reg = await registerHotel(t);
    await q(t, "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [reg.userId]);
    expect((await reg.client.get('/api/v1/me')).status).toBe(401);
  });

  it('changer de mot de passe révoque les autres sessions et exige l\'ancien', async () => {
    const reg = await registerHotel(t);
    const other = new Client(t);
    await other.post('/api/v1/auth/login', { email: reg.email, password: PASSWORD });
    expect((await other.get('/api/v1/me')).status).toBe(200);
    const bad = await reg.client.post('/api/v1/auth/change-password', { currentPassword: 'mauvais-mauvais-1', newPassword: 'Nouveau-mot-de-passe-77' });
    expect(bad.body.error.code).toBe('wrong_current_password');
    expect((await reg.client.post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'court1' })).body.error.code).toBe('weak_password');
    expect((await reg.client.post('/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nouveau-mot-de-passe-77' })).status).toBe(204);
    expect((await other.get('/api/v1/me')).status).toBe(401); // l'autre appareil est déconnecté
    expect((await reg.client.get('/api/v1/me')).status).toBe(200); // la session courante est conservée
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD })).status).toBe(401);
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: 'Nouveau-mot-de-passe-77' })).status).toBe(200);
    expect((await q(t, "SELECT count(*)::int AS n FROM audit_logs WHERE hotel_id = $1 AND action = 'user.password_changed'", [reg.hotelId]))[0].n).toBe(1);
  });

  it('une suspension par la plateforme coupe l\'accès aux données tout en laissant /me et la déconnexion', async () => {
    const reg = await registerHotel(t);
    await q(t, "UPDATE hotels SET status = 'suspended', suspended_at = now(), suspension_reason = 'Fraude' WHERE id = $1", [reg.hotelId]);
    const me = await reg.client.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.access).toMatchObject({ state: 'blocked', reason: 'hotel_suspended' });
    await q(t, "UPDATE hotels SET status = 'active', suspended_at = NULL, suspension_reason = NULL WHERE id = $1", [reg.hotelId]);
    expect((await reg.client.get('/api/v1/me')).body.access.state).toBe('full');
    expect((await reg.client.post('/api/v1/auth/logout')).status).toBe(204);
  });
});

describe('protection CSRF et origine', () => {
  it('une requête qui modifie l\'état sans jeton CSRF est refusée, même avec une session valide', async () => {
    const reg = await registerHotel(t);
    const res = await reg.client.post('/api/v1/auth/switch-hotel', { hotelId: reg.hotelId }, { 'x-csrf-token': '' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_invalid');
    expect((await reg.client.post('/api/v1/auth/switch-hotel', { hotelId: reg.hotelId }, { 'x-csrf-token': 'invente' })).body.error.code).toBe('csrf_invalid');
  });

  it('le jeton CSRF d\'une autre session est refusé (il est lié à la session)', async () => {
    const a = await registerHotel(t);
    const b = await registerHotel(t);
    const res = await a.client.post('/api/v1/auth/switch-hotel', { hotelId: a.hotelId }, { 'x-csrf-token': b.client.jar.get('hmp_csrf')! });
    expect(res.body.error.code).toBe('csrf_invalid');
    expect((await a.client.post('/api/v1/auth/switch-hotel', { hotelId: a.hotelId })).status).toBe(200);
  });

  it('une origine non autorisée est refusée, y compris pour la connexion et l\'inscription', async () => {
    const reg = await registerHotel(t);
    const evil = { origin: 'https://site-malveillant.example' };
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD }, evil)).body.error.code).toBe('origin_not_allowed');
    expect((await reg.client.post('/api/v1/auth/logout', {}, evil)).status).toBe(403);
    expect((await new Client(t).post('/api/v1/auth/login', { email: reg.email, password: PASSWORD }, { origin: ORIGIN })).status).toBe(200);
  });

  it('les lectures (GET) n\'exigent pas de jeton CSRF', async () => {
    const reg = await registerHotel(t);
    expect((await reg.client.get('/api/v1/me')).status).toBe(200);
  });
});

describe('contrat de l\'API', () => {
  it('toutes les erreurs ont la même forme, sans détail technique', async () => {
    const c = new Client(t);
    const validation = await c.post('/api/v1/auth/login', { email: 'x' });
    expect(validation.status).toBe(422);
    expect(validation.body.error).toMatchObject({ code: 'validation_error' });
    expect(validation.body.error.details.length).toBeGreaterThan(0);
    expect(validation.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const notFound = await c.get('/api/v1/inexistant');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('not_found');
    const malformed = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{pas du json', headers: { 'content-type': 'application/json', origin: ORIGIN } });
    expect(malformed.statusCode).toBeLessThan(500);
    expect(malformed.body).not.toMatch(/at .*\.ts|node_modules|stack/i);
  });

  it('envoie les en-têtes de sécurité', async () => {
    const res = await new Client(t).get('/api/v1/plans');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('expose le catalogue public : 4 formules, Enterprise sur devis sans tarif', async () => {
    const res = await new Client(t).get('/api/v1/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p: any) => p.code)).toEqual(['starter', 'business', 'premium', 'enterprise']);
    const enterprise = res.body.plans.find((p: any) => p.code === 'enterprise');
    expect(enterprise).toMatchObject({ is_custom_priced: true, max_rooms: null, prices: [] });
    expect(res.body.plans[0].prices).toEqual([
      { interval: 'month', currency: 'MGA', amount: '80000' },
      { interval: 'year', currency: 'MGA', amount: '800000' },
    ]);
  });

  it('documente l\'API en OpenAPI 3.1 et répond sur /health', async () => {
    const spec = await new Client(t).get('/api/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe('3.1.0');
    expect(Object.keys(spec.body.paths)).toEqual(expect.arrayContaining(['/api/v1/auth/login', '/api/v1/auth/register-hotel', '/api/v1/me', '/api/v1/plans']));
    expect((await new Client(t).get('/health')).body).toEqual({ status: 'ok' });
    expect((await new Client(t).get('/health/ready')).body).toEqual({ status: 'ready' });
    const docs = await new Client(t).get('/api/docs/');
    expect(docs.status).toBe(200);
  });
});

describe('ordre des contrôles : l\'accès avant la validation', () => {
  it('un appel non authentifié reçoit 401 — jamais le détail du schéma attendu — même avec un corps invalide', async () => {
    const anon = new Client(t);
    for (const [method, url] of [['PATCH', '/api/v1/hotel'], ['POST', '/api/v1/subscription/change-requests'], ['POST', '/api/v1/support/tickets']] as const) {
      const res = await anon.call(method, url, { n: 'importe quoi' });
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(res.body.error.details).toBeUndefined();
    }
    const platformAnon = new Client(t, 'hmp_platform_csrf');
    const res = await platformAnon.post('/api/v1/platform/plans', { code: '!!' });
    expect(res.status).toBe(401);
    expect(res.body.error.details).toBeUndefined();
  });

  it('un jeton CSRF invalide l\'emporte sur une erreur de validation', async () => {
    const reg = await registerHotel(t);
    const res = await reg.client.call('PATCH', '/api/v1/hotel', { name: 'X' }, { 'x-csrf-token': 'faux' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_invalid');
    expect(res.body.error.details).toBeUndefined();
  });

  it('un rôle sans la permission reçoit 403 avant toute validation du corps', async () => {
    const reg = await registerHotel(t);
    const reception = await addStaff(t, reg.hotelId, 'receptionist');
    const res = await reception.client.patch('/api/v1/hotel', { name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('textes juridiques', () => {
  it('l\'inscription enregistre la version acceptée et la date ; la version est publique', async () => {
    const before = Date.now();
    const reg = await registerHotel(t);
    const [u] = await q(t, 'SELECT terms_version, terms_accepted_at FROM users WHERE id = $1', [reg.userId]);
    expect(u.terms_version).toBe(LEGAL_VERSION);
    expect(new Date(u.terms_accepted_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const pub = await new Client(t).get('/api/v1/legal');
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual({ version: LEGAL_VERSION, company: null });
  });

  it('les coordonnées de l\'éditeur viennent du réglage « company.profile » de la console, sans rien d\'autre', async () => {
    await q(t, "INSERT INTO platform_settings (key, value) VALUES ('company.profile', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify({ name: 'Éditeur SARL', address: 'Antananarivo', email: 'contact@editeur.mg' })]);
    const pub = await new Client(t).get('/api/v1/legal');
    expect(pub.body.company).toEqual({ name: 'Éditeur SARL', address: 'Antananarivo', email: 'contact@editeur.mg' });
    await q(t, "DELETE FROM platform_settings WHERE key = 'company.profile'");
  });
});
