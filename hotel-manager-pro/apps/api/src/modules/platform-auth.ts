import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformTx } from '../db';
import { AppError } from '../errors';
import { auditPlatform } from '../lib/audit';
import { decrypt, encrypt } from '../lib/crypto';
import { csrfTokenFor, dummyVerify, newSessionToken, sha256, verifyPassword } from '../lib/security';
import { hashRecovery, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp';
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
    schema: { tags, summary: 'Connexion du super-administrateur', body: z.object({ email, password: z.string().min(1).max(128), code: z.string().trim().max(30).optional() }) },
  }, async (req, reply) => {
    const maxAttempts = await settings.number('auth.max_failed_attempts', 5);
    const lockMinutes = await settings.number('auth.lock_minutes', 15);
    const { email: mail, password, code } = req.body;

    const result = await platformTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; password_hash: string; status: string; locked_until: Date | null; totp_secret_enc: Buffer | null; totp_enabled_at: Date | null; totp_last_step: number | null; totp_recovery_hashes: string[] }>(
        'SELECT id, password_hash, status, locked_until, totp_secret_enc, totp_enabled_at, totp_last_step, totp_recovery_hashes FROM platform_admins WHERE email = $1',
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

      // Deuxième facteur : le mot de passe seul ne suffit jamais pour un compte qui l'a activé
      if (admin.totp_enabled_at && admin.totp_secret_enc) {
        if (!code) return { error: 'totp_required' as const };
        let accepted = false;
        const step = verifyTotp(decrypt(admin.totp_secret_enc, config.encryptionKey), code.replace(/\s/g, ''), now(), admin.totp_last_step);
        if (step !== null) {
          await tx.query('UPDATE platform_admins SET totp_last_step = $2 WHERE id = $1', [admin.id, step]);
          accepted = true;
        } else {
          const h = hashRecovery(code);
          if (admin.totp_recovery_hashes.includes(h)) {
            await tx.query('UPDATE platform_admins SET totp_recovery_hashes = array_remove(totp_recovery_hashes, $2) WHERE id = $1', [admin.id, h]);
            await auditPlatform(tx, admin.id, 'platform.recovery_code_used', { type: 'platform_admin', id: admin.id }, {}, req.ip);
            accepted = true;
          }
        }
        if (!accepted) {
          // Un code deviné compte comme un échec de mot de passe : 6 chiffres ne se forcent pas
          const { rows: l } = await tx.query<{ locked_until: Date | null }>(
            `UPDATE platform_admins SET failed_attempts = failed_attempts + 1,
                    locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN $4::timestamptz + make_interval(mins => $3) ELSE locked_until END
             WHERE id = $1 RETURNING locked_until`,
            [admin.id, maxAttempts, lockMinutes, now()],
          );
          await auditPlatform(tx, admin.id, 'platform.totp_failed', { type: 'platform_admin', id: admin.id }, {}, req.ip);
          return { error: l[0]!.locked_until && l[0]!.locked_until > now() ? ('account_locked' as const) : ('totp_invalid' as const) };
        }
      }

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
    const { rows } = await a.run((tx) => tx.query<{ on: boolean; codes: number }>('SELECT totp_enabled_at IS NOT NULL AS on, cardinality(totp_recovery_hashes) AS codes FROM platform_admins WHERE id = $1', [a.adminId]));
    return { admin: { id: a.adminId, email: a.email, fullName: a.fullName, totpEnabled: rows[0]?.on ?? false, recoveryCodesLeft: rows[0]?.codes ?? 0 } };
  });

  /* ------------------------------------------------------------------ Double authentification */
  const auth = app.platformAuth();
  r.post('/platform/auth/totp/setup', { preValidation: auth, schema: { tags, summary: 'Démarrer la double authentification : renvoie la clé à saisir dans l\'application (affichée une fois)' } }, async (req, reply) => {
    const a = req.platformAdmin!;
    const secret = newTotpSecret();
    await a.run(async (tx) => {
      const { rows } = await tx.query<{ on: boolean }>('SELECT totp_enabled_at IS NOT NULL AS on FROM platform_admins WHERE id = $1', [a.adminId]);
      if (rows[0]?.on) throw new AppError('totp_already_enabled');
      await tx.query('UPDATE platform_admins SET totp_secret_enc = $2, totp_last_step = NULL WHERE id = $1', [a.adminId, encrypt(secret, config.encryptionKey)]);
    });
    return reply.header('cache-control', 'no-store').send({ secret, otpauthUrl: otpauthUrl(secret, a.email) });
  });

  r.post('/platform/auth/totp/enable', { preValidation: auth, schema: { tags, summary: 'Activer : prouver la possession de l\'application avec un premier code ; renvoie 8 codes de secours (affichés une fois)', body: z.object({ code: z.string().trim().regex(/^\d{6}$/) }) } }, async (req, reply) => {
    const a = req.platformAdmin!;
    const recovery = newRecoveryCodes();
    await a.run(async (tx) => {
      const { rows } = await tx.query<{ enc: Buffer | null; on: boolean }>('SELECT totp_secret_enc AS enc, totp_enabled_at IS NOT NULL AS on FROM platform_admins WHERE id = $1 FOR UPDATE', [a.adminId]);
      if (rows[0]?.on) throw new AppError('totp_already_enabled');
      if (!rows[0]?.enc) throw new AppError('totp_not_ready');
      const step = verifyTotp(decrypt(rows[0].enc, config.encryptionKey), req.body.code, now(), null);
      if (step === null) throw new AppError('totp_invalid');
      await tx.query('UPDATE platform_admins SET totp_enabled_at = $2, totp_last_step = $3, totp_recovery_hashes = $4 WHERE id = $1', [a.adminId, now(), step, recovery.hashes]);
      await auditPlatform(tx, a.adminId, 'platform.totp_enabled', { type: 'platform_admin', id: a.adminId }, {}, req.ip);
    });
    return reply.header('cache-control', 'no-store').send({ enabled: true, recoveryCodes: recovery.codes });
  });

  r.post('/platform/auth/totp/disable', { preValidation: auth, schema: { tags, summary: 'Désactiver (mot de passe et code requis)', body: z.object({ password: z.string().min(1).max(128), code: z.string().trim().max(30) }) } }, async (req, reply) => {
    const a = req.platformAdmin!;
    await a.run(async (tx) => {
      const { rows } = await tx.query<{ password_hash: string; enc: Buffer | null; on: boolean; last: number | null }>('SELECT password_hash, totp_secret_enc AS enc, totp_enabled_at IS NOT NULL AS on, totp_last_step AS last FROM platform_admins WHERE id = $1 FOR UPDATE', [a.adminId]);
      const row = rows[0];
      if (!row?.on || !row.enc) throw new AppError('totp_not_ready');
      if (!(await verifyPassword(row.password_hash, req.body.password))) throw new AppError('wrong_current_password');
      if (verifyTotp(decrypt(row.enc, config.encryptionKey), req.body.code.replace(/\s/g, ''), now(), row.last) === null) throw new AppError('totp_invalid');
      await tx.query('UPDATE platform_admins SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery_hashes = $2 WHERE id = $1', [a.adminId, []]);
      await auditPlatform(tx, a.adminId, 'platform.totp_disabled', { type: 'platform_admin', id: a.adminId }, {}, req.ip);
    });
    return reply.code(204).send();
  });

  r.post('/platform/auth/logout', { preValidation: app.platformAuth(), schema: { tags, summary: 'Déconnexion' } }, async (req, reply: FastifyReply) => {
    await req.platformAdmin!.run((tx) => tx.query('UPDATE platform_admin_sessions SET revoked_at = now() WHERE token_hash = $1', [req.platformAdmin!.sessionTokenHash]));
    for (const c of [names.platform, names.platformCsrf]) reply.clearCookie(c, { path: '/', secure: config.cookieSecure, sameSite: 'strict' });
    return reply.code(204).send();
  });
}
