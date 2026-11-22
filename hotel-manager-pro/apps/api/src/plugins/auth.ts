import { hasPermission } from '@hmp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors';
import { platformTx } from '../db';
import { csrfTokenFor, safeEqual, sha256 } from '../lib/security';
import { resolveHotelContext } from '../services/session';
import type { HotelAuthOptions, PlatformContext } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** En production le préfixe __Host- impose Secure, chemin « / » et aucun domaine : le cookie ne peut pas être injecté depuis un sous-domaine. */
export const cookieNames = (secure: boolean) => ({
  hotel: secure ? '__Host-hmp_session' : 'hmp_session',
  hotelCsrf: secure ? '__Host-hmp_csrf' : 'hmp_csrf',
  platform: secure ? '__Host-hmp_platform_session' : 'hmp_platform_session',
  platformCsrf: secure ? '__Host-hmp_platform_csrf' : 'hmp_platform_csrf',
});

export default fp(async (app) => {
  const { db, config } = app.deps;
  const names = cookieNames(config.cookieSecure);

  app.decorateRequest('hotel', null);
  app.decorateRequest('platformAdmin', null);

  const checkOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) throw new AppError('origin_not_allowed');
  };

  const checkCsrf = (req: FastifyRequest, tokenHash: string) => {
    const sent = req.headers['x-csrf-token'];
    const expected = csrfTokenFor(config.CSRF_SECRET, tokenHash);
    if (typeof sent !== 'string' || !safeEqual(sent, expected)) throw new AppError('csrf_invalid');
  };

  const clearCookies = (reply: FastifyReply, ...cookies: string[]) => {
    for (const c of cookies) reply.clearCookie(c, { path: '/', secure: config.cookieSecure, httpOnly: true, sameSite: 'lax' });
  };

  /** Origine vérifiée pour toute requête qui modifie l'état, même sans session (connexion, inscription). */
  app.addHook('onRequest', async (req) => {
    if (!SAFE_METHODS.has(req.method)) checkOrigin(req);
  });

  /* -------------------------------------------------------------------------------------------
   * Utilisateur d'établissement : session → identité → état d'accès → permission
   * ----------------------------------------------------------------------------------------- */
  app.decorate('hotelAuth', (opts: HotelAuthOptions = {}) =>
    async function hotelAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const token = req.cookies[names.hotel];
      if (!token) throw new AppError('unauthenticated');
      const tokenHash = sha256(token);

      const ctx = await resolveHotelContext(app.deps, tokenHash);
      if (!ctx) {
        clearCookies(reply, names.hotel, names.hotelCsrf);
        throw new AppError('unauthenticated');
      }
      const unsafe = !SAFE_METHODS.has(req.method);
      if (unsafe) checkCsrf(req, tokenHash);

      if (ctx.access.state === 'blocked' && !opts.blockedOk) throw new AppError(ctx.access.reason as 'hotel_suspended' | 'hotel_closed');
      if (ctx.access.state === 'read_only' && unsafe && !opts.lapsedOk) {
        throw new AppError(ctx.access.reason as 'subscription_required' | 'trial_expired' | 'subscription_expired');
      }
      if (opts.permission && !hasPermission(ctx.permissions, opts.permission)) throw new AppError('forbidden');
      if (opts.feature && !ctx.entitlements.features[opts.feature]) throw new AppError('feature_not_in_plan', { feature: opts.feature });
      req.hotel = ctx;
    },
  );

  /* -------------------------------------------------------------------------------------------
   * Super-administrateur : cookie, table et rôle SQL distincts de ceux des établissements
   * ----------------------------------------------------------------------------------------- */
  app.decorate('platformAuth', () =>
    async function platformAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const token = req.cookies[names.platform];
      if (!token) throw new AppError('unauthenticated');
      const tokenHash = sha256(token);
      const { rows } = await platformTx(db, (tx) =>
        tx.query<{ admin_id: string; email: string; full_name: string }>(
          `SELECT a.id AS admin_id, a.email, a.full_name
           FROM platform_admin_sessions s JOIN platform_admins a ON a.id = s.admin_id AND a.status = 'active'
           WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
          [tokenHash],
        ),
      );
      const a = rows[0];
      if (!a) {
        clearCookies(reply, names.platform, names.platformCsrf);
        throw new AppError('unauthenticated');
      }
      if (!SAFE_METHODS.has(req.method)) checkCsrf(req, tokenHash);
      const ctx: PlatformContext = {
        sessionTokenHash: tokenHash,
        adminId: a.admin_id,
        email: a.email,
        fullName: a.full_name,
        run: (fn) => platformTx(db, fn),
      };
      req.platformAdmin = ctx;
    },
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    hotelAuth(opts?: HotelAuthOptions): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    platformAuth(): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
