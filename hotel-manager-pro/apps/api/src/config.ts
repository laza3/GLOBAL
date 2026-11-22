import { type AppEnvironment } from '@hmp/db';
import { hkdfSync } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Environnement de déploiement : development (ordinateur du développeur), staging (tests en ligne, données FICTIVES) ou production
   * (données réelles). Facultatif hors production (défaut : development) ; OBLIGATOIRE avec NODE_ENV=production, où il doit valoir
   * staging ou production. Il est comparé au marqueur de la base au démarrage : une base d'un autre environnement est refusée.
   */
  APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
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
  /**
   * Clé de chiffrement des pièces d'identité (AES-256-GCM) : 32 octets en base64 (openssl rand -base64 32).
   * OBLIGATOIRE en production ; en développement et en test une clé est dérivée de CSRF_SECRET. Perdre cette clé rend les
   * numéros de pièces illisibles : la sauvegarder séparément des sauvegardes de la base.
   */
  ENCRYPTION_KEY: z.string().optional(),
  /** Interface de documentation interactive (/api/docs). Désactivée par défaut dans la fonction serverless Vercel (voir src/vercel.ts). */
  API_DOCS: bool.default(true),
  /** Taille maximale des pools de connexions. Défauts adaptés à un serveur permanent ; en serverless (Vercel) : 2 à 3, chaque instance ayant ses propres pools. */
  DB_POOL_MAX_APP: z.coerce.number().int().min(1).max(100).default(20),
  DB_POOL_MAX_PLATFORM: z.coerce.number().int().min(1).max(100).default(8),
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
  // E-mails (facultatif) : sans SMTP_URL aucun e-mail ne part et la réinitialisation par e-mail est indisponible
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Hotel Manager Pro <ne-pas-repondre@localhost>'),
  PUBLIC_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Mode « réseau local » (installation sur l'ordinateur d'un hôtel, sans Internet) : accepte aussi les origines du réseau privé
   * (192.168.x.x, 10.x.x.x, 172.16-31.x.x, nom d'ordinateur), pour que les autres ordinateurs et téléphones de l'hôtel puissent se
   * connecter. INTERDIT en production (NODE_ENV=production) : les hébergements en ligne n'ont pas de réseau privé à autoriser.
   */
  LAN_MODE: bool.default(false),
  /** Trace du SQL de bascule de rôle (tests) : la connexion est superuser, on bascule vers le rôle applicatif. */
  DB_SWITCH_ROLE: bool.default(false),
});

export type Config = Omit<z.infer<typeof schema>, 'ALLOWED_ORIGINS' | 'COOKIE_SECURE' | 'ENCRYPTION_KEY' | 'APP_ENV'> & {
  /** Environnement de déploiement (jamais déduit de l'adresse de la base : explicite, et contrôlé contre la base). */
  appEnv: AppEnvironment;
  allowedOrigins: string[];
  cookieSecure: boolean;
  /** Clé AES-256 (32 octets). */
  encryptionKey: Buffer;
  encryptionKeyVersion: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${problems}`);
  }
  const { ALLOWED_ORIGINS, COOKIE_SECURE, ENCRYPTION_KEY, APP_ENV, ...rest } = parsed.data;
  const secureMode = rest.NODE_ENV === 'production';
  if (secureMode && !APP_ENV) throw new Error('Configuration invalide : APP_ENV est obligatoire avec NODE_ENV=production (staging ou production).');
  if (secureMode && APP_ENV === 'development') throw new Error('Configuration invalide : APP_ENV=development est incompatible avec NODE_ENV=production.');
  if (!secureMode && APP_ENV && APP_ENV !== 'development') throw new Error(`Configuration invalide : APP_ENV=${APP_ENV} exige NODE_ENV=production (mêmes réglages de sécurité que la production).`);
  if (rest.LAN_MODE && secureMode) throw new Error('Configuration invalide : LAN_MODE est incompatible avec NODE_ENV=production (installation locale uniquement).');
  const appEnv: AppEnvironment = APP_ENV ?? 'development';
  const cookieSecure = COOKIE_SECURE ?? rest.NODE_ENV === 'production';
  if (rest.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('Configuration invalide : COOKIE_SECURE ne peut pas être désactivé en production.');
  }
  let encryptionKey: Buffer;
  if (ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) throw new Error('Configuration invalide : ENCRYPTION_KEY doit être 32 octets en base64 (openssl rand -base64 32).');
  } else if (rest.NODE_ENV === 'production') {
    throw new Error('Configuration invalide : ENCRYPTION_KEY est obligatoire en production (openssl rand -base64 32).');
  } else {
    encryptionKey = Buffer.from(hkdfSync('sha256', rest.CSRF_SECRET, 'hmp', 'document-encryption', 32));
  }
  return { ...rest, appEnv, allowedOrigins: ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean), cookieSecure, encryptionKey, encryptionKeyVersion: 1 };
}
