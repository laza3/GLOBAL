import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, createTestApp, q, registerHotel, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)![1]!;
const forgot = (email: string) => new Client(t).post('/api/v1/auth/forgot-password', { email });
const NEW = 'Nouveau-mot-de-passe-solide-77';

describe('réinitialisation du mot de passe par e-mail', () => {
  it('lien à usage unique : nouveau mot de passe, ancien refusé, sessions fermées', async () => {
    const h = await registerHotel(t);
    t.mails.length = 0;
    const res = await forgot(h.email);
    expect(res.status).toBe(202);
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]).toMatchObject({ to: h.email, subject: 'Réinitialisation de votre mot de passe' });
    const token = tokenFrom(t.mails[0]!.text);
    expect(t.mails[0]!.text).toContain('/reinitialisation?token=');
    // le jeton n'est jamais stocké : seule son empreinte l'est
    expect(JSON.stringify(await q(t, 'SELECT token_hash FROM password_resets'))).not.toContain(token);
    const reset = await new Client(t).post('/api/v1/auth/reset-password', { token, newPassword: NEW });
    expect(reset.status).toBe(204);
    // l'ancienne session est fermée, l'ancien mot de passe refusé, le nouveau accepté
    expect((await h.client.get('/api/v1/reservations')).status).toBe(401);
    expect((await new Client(t).post('/api/v1/auth/login', { email: h.email, password: PASSWORD })).status).toBe(401);
    expect((await new Client(t).post('/api/v1/auth/login', { email: h.email, password: NEW, hotelId: h.hotelId })).status).toBe(200);
    // un seul usage
    const again = await new Client(t).post('/api/v1/auth/reset-password', { token, newPassword: 'Encore-un-autre-mot-de-passe-12' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('reset_token_invalid');
  });

  it('même réponse pour un compte inconnu (pas d\'énumération) ; aucun e-mail ; un seul lien valide à la fois', async () => {
    const h = await registerHotel(t);
    t.mails.length = 0;
    const unknown = await forgot('personne@inconnu.test');
    const known = await forgot(h.email);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(t.mails).toHaveLength(1); // seul le compte réel reçoit un message
    const first = tokenFrom(t.mails[0]!.text);
    await forgot(h.email);
    const second = tokenFrom(t.mails[1]!.text);
    expect((await new Client(t).post('/api/v1/auth/reset-password', { token: first, newPassword: NEW })).status).toBe(400); // remplacé par le suivant
    expect((await new Client(t).post('/api/v1/auth/reset-password', { token: second, newPassword: NEW })).status).toBe(204);
  });

  it('jeton expiré ou inventé refusé ; mot de passe faible refusé sans consommer le lien ; limite par compte', async () => {
    const h = await registerHotel(t);
    t.mails.length = 0;
    await forgot(h.email);
    const token = tokenFrom(t.mails[0]!.text);
    expect((await new Client(t).post('/api/v1/auth/reset-password', { token, newPassword: 'court' })).status).toBe(422);
    expect((await new Client(t).post('/api/v1/auth/reset-password', { token: 'x'.repeat(43), newPassword: NEW })).body.error.code).toBe('reset_token_invalid');
    await q(t, "UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await new Client(t).post('/api/v1/auth/reset-password', { token, newPassword: NEW })).body.error.code).toBe('reset_token_invalid');
    // au plus 5 demandes par heure et par compte : la 6e n'envoie plus rien
    t.mails.length = 0;
    for (let i = 0; i < 7; i++) await forgot(h.email);
    expect(t.mails.length).toBeLessThanOrEqual(5);
  });

  it('un compte désactivé ne reçoit rien ; la table est inaccessible au rôle applicatif', async () => {
    const h = await registerHotel(t);
    await q(t, "UPDATE users SET status = 'disabled' WHERE id = $1", [h.userId]);
    t.mails.length = 0;
    expect((await forgot(h.email)).status).toBe(202);
    expect(t.mails).toHaveLength(0);
    const c = await t.tdb.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE hmp_app');
      await expect(c.query('SELECT * FROM password_resets')).rejects.toThrow();
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
});

describe('sans serveur d\'e-mail', () => {
  it('501 explicite : l\'API ne prétend pas avoir envoyé un message', async () => {
    const t2 = await createTestApp({}, { mailer: false });
    try {
      const h = await registerHotel(t2);
      const res = await new Client(t2).post('/api/v1/auth/forgot-password', { email: h.email });
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe('email_unavailable');
    } finally { await t2.close(); }
  });
});
