import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ERRORS } from '@hmp/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from './config';
import { anonTx, platformTx, type Db } from './db';
import { AppError, fromDbError } from './errors';
import { SettingsCache } from './lib/settings';
import authRoutes from './modules/auth';
import billingRoutes from './modules/billing';
import hotelRoutes from './modules/hotel';
import platformRoutes from './modules/platform';
import platformAuthRoutes from './modules/platform-auth';
import supportRoutes from './modules/support';
import authPlugin from './plugins/auth';
import type { AppDeps } from './types';

// Messages de validation en français
z.config(z.locales.fr());

export interface BuildOptions {
  db: Db;
  config: Config;
  now?: () => Date;
  /** Routes supplémentaires (tests : route protégée factice tant que les modules métier n'existent pas). */
  extend?: (app: FastifyInstance) => Promise<void>;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = opts;
  const deps: AppDeps = { db, config, settings: new SettingsCache(db, config.NODE_ENV === 'test' ? 0 : 15_000), now: opts.now ?? (() => new Date()) };

  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : {
      level: config.LOG_LEVEL,
      // Aucun secret dans les journaux : jetons de session et en-têtes sensibles masqués
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
    },
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    trustProxy: config.TRUST_PROXY,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  /* ------------------------------------------------------------------ Sécurité HTTP */
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError('rate_limited'),
  });

  /* ------------------------------------------------------------------ Documentation OpenAPI */
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Hotel Manager Pro — API',
        version: '0.1.0',
        description:
          'API REST JSON. Authentification par cookie de session (HttpOnly) ; les requêtes qui modifient l\'état exigent l\'en-tête `X-CSRF-Token` (valeur du cookie `hmp_csrf`). Les erreurs ont toutes la forme `{ error: { code, message, details?, requestId } }`.',
      },
      tags: [
        { name: 'Public' }, { name: 'Authentification' }, { name: 'Établissement' }, { name: 'Abonnement et facturation' },
        { name: 'Assistance' }, { name: 'Plateforme' },
      ],
      components: { securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'hmp_session' } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  // L'interface de documentation a besoin de ses propres ressources (même origine) : CSP dédiée à ce préfixe uniquement
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/docs')) {
      reply.header('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    }
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  /* ------------------------------------------------------------------ Erreurs : un seul format, jamais de détail technique */
  app.setErrorHandler((error, req, reply) => {
    const send = (e: AppError) =>
      reply.code(e.status).send({ error: { code: e.code, message: e.userMessage, ...(e.details !== undefined && { details: e.details }), requestId: req.id } });

    if (error instanceof AppError) return send(error);
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((v) => ({
        path: (v.instancePath ?? '').split('/').filter(Boolean).join('.'),
        message: v.message ?? 'Valeur invalide',
      }));
      return send(new AppError('validation_error', details));
    }
    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' || (error as { statusCode?: number }).statusCode === 400) {
      return send(new AppError('validation_error'));
    }
    const fromDb = fromDbError(error);
    if (fromDb) return send(fromDb);

    req.log.error({ err: error }, 'erreur interne');
    return reply.code(500).send({ error: { code: 'internal_error', message: ERRORS.internal_error.message, requestId: req.id } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: ERRORS.not_found.message, requestId: req.id } }),
  );

  /* ------------------------------------------------------------------ Santé (sans authentification, sans donnée) */
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { schema: { hide: true } }, async (_req, reply) => {
    try {
      await Promise.all([anonTx(db, (tx) => tx.query('SELECT 1')), platformTx(db, (tx) => tx.query('SELECT 1'))]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  /* ------------------------------------------------------------------ Routes */
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(hotelRoutes, { prefix: '/api/v1' });
  await app.register(billingRoutes, { prefix: '/api/v1' });
  await app.register(supportRoutes, { prefix: '/api/v1' });
  await app.register(platformAuthRoutes, { prefix: '/api/v1' });
  await app.register(platformRoutes, { prefix: '/api/v1' });
  if (opts.extend) await opts.extend(app);

  return app;
}
