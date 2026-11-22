import { LEGAL_VERSION } from '@hmp/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { anonTx } from '../db';
import { AppError } from '../errors';
import { assertStrongPassword, csrfTokenFor, dummyVerify, hashPassword, sha256, verifyPassword } from '../lib/security';
import { cookieNames } from '../plugins/auth';
import { registerHotel } from '../services/registration';
import { createHotelSession, resolveHotelContext, toMe } from '../services/session';

const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
const currency = z.enum(['MGA', 'EUR', 'USD']);

export const registerSchema = z.object({
  hotelName: z.string().trim().min(2).max(120),
  country: z.string().regex(/^[A-Z]{2}$/, 'Code pays à 2 lettres, ex. MG').default('MG'),
  city: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  currency: currency.default('MGA'),
  timezone: z.string().max(64).default('Indian/Antananarivo'),
  locale: z.enum(['fr', 'en', 'mg']).default('fr'),
  ownerName: z.string().trim().min(2).max(120),
  email,
  password: z.string().max(128),
  planCode: z.string().regex(/^[a-z0-9_-]{2,40}$/).optional(),
  acceptTerms: z.literal(true, { error: 'Vous devez accepter les conditions d\'utilisation.' }),
});

export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, config, now } = app.deps;
  const names = cookieNames(config.cookieSecure);
  const authLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  const setSession = (reply: FastifyReply, token: string, tokenHash: string) => {
    const maxAge = config.SESSION_TTL_HOURS * 3600;
    const base = { path: '/', secure: config.cookieSecure, sameSite: 'lax' as const, maxAge };
    reply.setCookie(names.hotel, token, { ...base, httpOnly: true });
    // Lisible par le JavaScript de l'application : renvoyé dans l'en-tête X-CSRF-Token (lié à CETTE session)
    reply.setCookie(names.hotelCsrf, csrfTokenFor(config.CSRF_SECRET, tokenHash), { ...base, httpOnly: false });
  };

  /* ------------------------------------------------------------------ Catalogue public des formules */
  r.get('/plans', {
    schema: { tags: ['Public'], summary: 'Formules et tarifs publics' },
  }, async () => {
    const { rows } = await anonTx(db, (tx) =>
      tx.query(
        `SELECT p.code, p.name, p.description, p.tier, p.is_custom_priced, p.max_rooms, p.max_users, p.max_properties, p.features, p.trial_days,
                COALESCE(json_agg(json_build_object('interval', pp.billing_interval, 'currency', pp.currency, 'amount', pp.amount::bigint::text)
                         ORDER BY pp.currency, pp.billing_interval) FILTER (WHERE pp.id IS NOT NULL), '[]') AS prices
         FROM plans p LEFT JOIN plan_prices pp ON pp.plan_id = p.id AND pp.is_active
         WHERE p.is_public AND p.is_active
         GROUP BY p.id ORDER BY p.tier`,
      ),
    );
    return { plans: rows };
  });

  /* ------------------------------------------------------------------ Textes légaux : version en vigueur et coordonnées de l'éditeur */
  r.get('/legal', { schema: { tags: ['Public'], summary: 'Version des textes juridiques et coordonnées de l\'éditeur (réglage « company.profile » de la console)' } }, async () => {
    const company = await app.deps.settings.get<Record<string, string> | null>('company.profile', null);
    return { version: LEGAL_VERSION, company: company && Object.keys(company).length ? company : null };
  });

  /* ------------------------------------------------------------------ Inscription d'un établissement */
  r.post('/auth/register-hotel', {
    config: authLimit,
    schema: { tags: ['Authentification'], summary: 'Inscrire un établissement et créer son premier compte propriétaire', body: registerSchema },
  }, async (req, reply) => {
    const body = req.body;
    assertStrongPassword(body.password, body.email);
    const out = await registerHotel(app.deps, body, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
    setSession(reply, out.token, out.tokenHash);
    const ctx = (await resolveHotelContext(app.deps, out.tokenHash))!;
    return reply.code(201).send({ ...toMe(ctx), hotel: { ...toMe(ctx).hotel, slug: out.slug }, trialStarted: out.trialStarted, csrfToken: csrfTokenFor(config.CSRF_SECRET, out.tokenHash) });
  });

  /* ------------------------------------------------------------------ Connexion */
  r.post('/auth/login', {
    config: authLimit,
    schema: {
      tags: ['Authentification'],
      summary: 'Se connecter',
      description: 'Si l\'utilisateur appartient à plusieurs établissements, précisez `hotelId` ; sinon la réponse 409 `hotel_selection_required` liste les choix.',
      body: z.object({ email, password: z.string().min(1).max(128), hotelId: z.uuid().optional() }),
    },
  }, async (req, reply) => {
    const { email: mail, password, hotelId } = req.body;
    const maxAttempts = await app.deps.settings.number('auth.max_failed_attempts', 5);
    const lockMinutes = await app.deps.settings.number('auth.lock_minutes', 15);

    const { rows } = await anonTx(db, (tx) =>
      tx.query<{ id: string; password_hash: string; status: string; locked_until: Date | null }>('SELECT * FROM auth_find_user($1)', [mail]),
    );
    const user = rows[0];
    if (!user) {
      await dummyVerify(password); // même durée de réponse que pour un compte existant
      throw new AppError('invalid_credentials');
    }
    if (user.locked_until && user.locked_until > now()) throw new AppError('account_locked');

    if (!(await verifyPassword(user.password_hash, password))) {
      const lockedUntil = await anonTx(db, async (tx) =>
        (await tx.query<{ l: Date | null }>('SELECT auth_login_failed($1, $2, $3) AS l', [user.id, maxAttempts, lockMinutes])).rows[0]!.l,
      );
      throw new AppError(lockedUntil && lockedUntil > now() ? 'account_locked' : 'invalid_credentials');
    }
    if (user.status !== 'active') throw new AppError('account_disabled');

    const session = await anonTx(db, async (tx) => {
      const { rows: hotels } = await tx.query<{ hotel_id: string; hotel_name: string; role_key: string }>('SELECT * FROM auth_user_hotels($1)', [user.id]);
      if (hotels.length === 0) throw new AppError('not_a_member');
      let chosen = hotelId;
      if (chosen) {
        if (!hotels.some((h) => h.hotel_id === chosen)) throw new AppError('not_a_member');
      } else if (hotels.length === 1) {
        chosen = hotels[0]!.hotel_id;
      } else {
        throw new AppError('hotel_selection_required', hotels.map((h) => ({ hotelId: h.hotel_id, name: h.hotel_name, role: h.role_key })));
      }
      await tx.query('SELECT auth_login_succeeded($1)', [user.id]);
      return createHotelSession(tx, { userId: user.id, hotelId: chosen, ip: req.ip, userAgent: req.headers['user-agent'] ?? null, ttlHours: config.SESSION_TTL_HOURS });
    });

    setSession(reply, session.token, session.tokenHash);
    const ctx = (await resolveHotelContext(app.deps, session.tokenHash))!;
    return { ...toMe(ctx), csrfToken: csrfTokenFor(config.CSRF_SECRET, session.tokenHash) };
  });

  /* ------------------------------------------------------------------ Session courante */
  r.get('/me', {
    preValidation: app.hotelAuth({ blockedOk: true, lapsedOk: true }),
    schema: { tags: ['Authentification'], summary: 'Identité, permissions, droits d\'usage et état d\'accès' },
  }, async (req) => toMe(req.hotel!));

  r.post('/auth/logout', {
    preValidation: app.hotelAuth({ blockedOk: true, lapsedOk: true }),
    schema: { tags: ['Authentification'], summary: 'Se déconnecter (révoque la session)' },
  }, async (req, reply) => {
    await anonTx(db, (tx) => tx.query('SELECT auth_revoke_session($1)', [req.hotel!.sessionTokenHash]));
    for (const c of [names.hotel, names.hotelCsrf]) reply.clearCookie(c, { path: '/', secure: config.cookieSecure, sameSite: 'lax' });
    return reply.code(204).send();
  });

  r.post('/auth/switch-hotel', {
    config: authLimit,
    preValidation: app.hotelAuth({ blockedOk: true, lapsedOk: true }),
    schema: { tags: ['Authentification'], summary: 'Changer d\'établissement actif', body: z.object({ hotelId: z.uuid() }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const session = await anonTx(db, async (tx) => {
      const { rows } = await tx.query<{ hotel_id: string }>('SELECT hotel_id FROM auth_user_hotels($1)', [me.userId]);
      if (!rows.some((h) => h.hotel_id === req.body.hotelId)) throw new AppError('not_a_member');
      await tx.query('SELECT auth_revoke_session($1)', [me.sessionTokenHash]);
      return createHotelSession(tx, { userId: me.userId, hotelId: req.body.hotelId, ip: req.ip, userAgent: req.headers['user-agent'] ?? null, ttlHours: config.SESSION_TTL_HOURS });
    });
    setSession(reply, session.token, session.tokenHash);
    const ctx = (await resolveHotelContext(app.deps, session.tokenHash))!;
    return { ...toMe(ctx), csrfToken: csrfTokenFor(config.CSRF_SECRET, session.tokenHash) };
  });

  r.post('/auth/change-password', {
    config: authLimit,
    preValidation: app.hotelAuth({ blockedOk: true, lapsedOk: true }),
    schema: { tags: ['Authentification'], summary: 'Changer son mot de passe (révoque les autres sessions)', body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().max(128) }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const { currentPassword, newPassword } = req.body;
    assertStrongPassword(newPassword, me.email);
    const { rows } = await anonTx(db, (tx) => tx.query<{ password_hash: string }>('SELECT * FROM auth_find_user($1)', [me.email]));
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) throw new AppError('wrong_current_password');
    const newHash = await hashPassword(newPassword);
    await anonTx(db, async (tx) => {
      await tx.query('SELECT auth_set_password($1, $2)', [me.userId, newHash]);
      await tx.query('SELECT auth_revoke_user_sessions($1, $2)', [me.userId, me.sessionTokenHash]);
    });
    await me.tenant((tx) =>
      tx.query("INSERT INTO audit_logs (hotel_id, actor_user_id, action, entity_type, entity_id, summary, ip) VALUES ($1, $2, 'user.password_changed', 'user', $2, 'Mot de passe modifié', $3)", [me.hotelId, me.userId, req.ip]),
    );
    return reply.code(204).send();
  });
}

export { sha256 };
