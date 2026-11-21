import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  /** Pool de l'API pour un établissement (rôle hmp_app). */
  DATABASE_URL_APP: z.string().min(1),
  /** Pool de la console plateforme (rôle hmp_platform). */
  DATABASE_URL_PLATFORM: z.string().min(1),
  /** Origines autorisées pour les requêtes avec cookies (CORS + contrôle d'origine anti-CSRF), séparées par des virgules. */
  ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'),
  /** Secret de signature des jetons CSRF : long, aléatoire, jamais versionné. */
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET doit faire au moins 32 caractères'),
  /** Durée de vie d'une session (heures). */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  PLATFORM_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  COOKIE_SECURE: bool.optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  /** Connexion plateforme : plus stricte que celle des hôtels (cible de choix). */
  PLATFORM_AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  /** À activer derrière un proxy de confiance (adresse IP réelle pour la limitation de débit et les journaux). */
  TRUST_PROXY: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Trace du SQL de bascule de rôle (tests) : la connexion est superuser, on bascule vers le rôle applicatif. */
  DB_SWITCH_ROLE: bool.default(false),
});

export type Config = Omit<z.infer<typeof schema>, 'ALLOWED_ORIGINS' | 'COOKIE_SECURE'> & {
  allowedOrigins: string[];
  cookieSecure: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${problems}`);
  }
  const { ALLOWED_ORIGINS, COOKIE_SECURE, ...rest } = parsed.data;
  const cookieSecure = COOKIE_SECURE ?? rest.NODE_ENV === 'production';
  if (rest.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('Configuration invalide : COOKIE_SECURE ne peut pas être désactivé en production.');
  }
  return { ...rest, allowedOrigins: ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean), cookieSecure };
}
