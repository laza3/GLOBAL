import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db';
import { assertDatabaseEnvironment } from './lib/environment';
import { mergedAllowedOrigins } from './lib/vercel-origins';

/**
 * Point d'entrée « fonction serverless » (Vercel) : la MÊME application Fastify que le serveur permanent, sans écouter de port.
 * Une instance de fonction garde son application et ses pools de connexions entre deux requêtes (réutilisation à chaud) ;
 * pour ne pas saturer PostgreSQL quand plusieurs instances tournent, les pools sont petits (DB_POOL_MAX_APP / _PLATFORM,
 * 2 à 3 conseillés) et l'adresse de base doit être celle du POOLEUR de connexions du fournisseur (mode « transaction » : la
 * bascule de rôle et le contexte d'établissement sont limités à la transaction, donc compatibles).
 */
// API_DOCS désactivée par défaut ici : sa dépendance @fastify/static exige require() d'un module ES, refusé par Node sur Vercel
// ALLOWED_ORIGINS : les adresses propres du projet Vercel s'ajoutent d'elles-mêmes (voir lib/vercel-origins.ts)
const config = loadConfig({ API_DOCS: 'false', ...process.env, ALLOWED_ORIGINS: mergedAllowedOrigins(process.env) });
const db = createDb({
  appUrl: config.DATABASE_URL_APP,
  platformUrl: config.DATABASE_URL_PLATFORM,
  switchRole: config.DB_SWITCH_ROLE,
  appMax: Math.min(config.DB_POOL_MAX_APP, 3),
  platformMax: Math.min(config.DB_POOL_MAX_PLATFORM, 2),
  onPoolError: (error, pool) => console.error(JSON.stringify({ level: 'error', msg: 'connexion inactive du pool coupée', pool, err: error.message })),
});

type App = Awaited<ReturnType<typeof buildApp>>;
let booting: Promise<App> | undefined;

function boot(): Promise<App> {
  booting ??= (async () => {
    // Même garde-fou « pas de mélange » qu'au démarrage du serveur permanent : base d'un autre environnement = aucune requête servie
    await assertDatabaseEnvironment(db, config);
    const app = await buildApp({ db, config });
    await app.ready();
    return app;
  })().catch((error) => {
    booting = undefined; // on réessaiera à la requête suivante (base momentanément injoignable…)
    throw error;
  });
  return booting;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await boot();
    app.server.emit('request', req, res);
  } catch (error) {
    console.error(JSON.stringify({ level: 'fatal', msg: 'démarrage impossible', err: error instanceof Error ? error.message : String(error) }));
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'unavailable', message: 'Service momentanément indisponible.' } }));
  }
}
