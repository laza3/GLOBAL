import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformTx } from '../db';
import { AppError } from '../errors';
import { auditPlatform } from '../lib/audit';
import { csrfTokenFor, dummyVerify, newSessionToken, sha256, verifyPassword } from '../lib/security';
import { cookieNames } from '../plugins/auth';

export default async function platformAuthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, config, settings, now } = app.deps;
  const names = cookieNames(config.cookieSecure);
  const tags = ['Plateforme'];
  const email = z.email().max(254).transform((v) => v.trim().toLowerCase());

  r.post('/platform/auth/login', {
    // Plus strict que pour les hôtels : un compte plateforme est une cible de choix
    config: { rateLimit: { max: config.PLATFORM_AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    schema: { tags, summary: 'Connexion du super-administrateur', body: z.object({ email, password: z.string().min(1).max(128) }) },
  }, async (req, reply) => {
    const maxAttempts = await settings.number('auth.max_failed_attempts', 5);
    const lockMinutes = await settings.number('auth.lock_minutes', 15);
    const { email: mail, password } = req.body;

    const result = await platformTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; password_hash: string; status: string; locked_until: Date | null }>(
        'SELECT id, password_hash, status, locked_until FROM platform_admins WHERE email = $1',
        [mail],
      );
      const admin = rows[0];
      if (!admin) {
        await dummyVerify(password);
        return { error: 'invalid_credentials' as const };
      }
      if (admin.locked_until && admin.locked_until > now()) return { error: 'account_locked' as const };
      if (!(await verifyPassword(admin.password_hash, password))) {
        const { rows: l } = await tx.query<{ locked_until: Date | null }>(
          `UPDATE platform_admins SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN $4::timestamptz + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1 RETURNING locked_until`,
          [admin.id, maxAttempts, lockMinutes, now()],
        );
        await auditPlatform(tx, admin.id, 'platform.login_failed', { type: 'platform_admin', id: admin.id }, {}, req.ip);
        return { error: l[0]!.locked_until && l[0]!.locked_until > now() ? ('account_locked' as const) : ('invalid_credentials' as const) };
      }
      if (admin.status !== 'active') return { error: 'account_disabled' as const };

      const token = newSessionToken();
      const tokenHash = sha256(token);
      await tx.query(
        "INSERT INTO platform_admin_sessions (admin_id, token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))",
        [admin.id, tokenHash, req.ip, (req.headers['user-agent'] ?? '').slice(0, 300), config.PLATFORM_SESSION_TTL_HOURS],
      );
      await tx.query('UPDATE platform_admins SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [admin.id]);
      await auditPlatform(tx, admin.id, 'platform.login', { type: 'platform_admin', id: admin.id }, {}, req.ip);
      return { token, tokenHash, adminId: admin.id };
    });
    if ('error' in result && result.error) throw new AppError(result.error);

    const ok = result as { token: string; tokenHash: string; adminId: string };
    const maxAge = config.PLATFORM_SESSION_TTL_HOURS * 3600;
    const base = { path: '/', secure: config.cookieSecure, sameSite: 'strict' as const, maxAge };
    reply.setCookie(names.platform, ok.token, { ...base, httpOnly: true });
    reply.setCookie(names.platformCsrf, csrfTokenFor(config.CSRF_SECRET, ok.tokenHash), { ...base, httpOnly: false });
    return { admin: { id: ok.adminId, email: mail }, csrfToken: csrfTokenFor(config.CSRF_SECRET, ok.tokenHash) };
  });

  r.get('/platform/me', { preValidation: app.platformAuth(), schema: { tags, summary: 'Administrateur connecté' } }, async (req) => {
    const a = req.platformAdmin!;
    return { admin: { id: a.adminId, email: a.email, fullName: a.fullName } };
  });

  r.post('/platform/auth/logout', { preValidation: app.platformAuth(), schema: { tags, summary: 'Déconnexion' } }, async (req, reply: FastifyReply) => {
    await req.platformAdmin!.run((tx) => tx.query('UPDATE platform_admin_sessions SET revoked_at = now() WHERE token_hash = $1', [req.platformAdmin!.sessionTokenHash]));
    for (const c of [names.platform, names.platformCsrf]) reply.clearCookie(c, { path: '/', secure: config.cookieSecure, sameSite: 'strict' });
    return reply.code(204).send();
  });
}
