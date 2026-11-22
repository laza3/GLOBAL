import { randomUUID } from 'node:crypto';
import { createDatabaseFromTemplate, type TestDatabase } from '@hmp/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createDb, type Db } from '../src/db';
import type { SystemRoleKey } from '@hmp/shared';
import { hashPassword } from '../src/lib/security';

export const PASSWORD = 'Mot-de-passe-solide-42';
export const ORIGIN = 'http://127.0.0.1:5173';

export interface SentMail { to: string; subject: string; text: string }

export interface TestApp {
  mails: SentMail[];
  app: FastifyInstance;
  db: Db;
  tdb: TestDatabase;
  config: Config;
  setNow(d: Date | null): void;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}, opts: { mailer?: boolean } = {}): Promise<TestApp> {
  const mails: SentMail[] = [];
  const tdb = await createDatabaseFromTemplate();
  // Connexion superuser + bascule de rôle : la RLS et les droits par rôle s'appliquent réellement
  const db = createDb({ appUrl: tdb.url, platformUrl: tdb.url, switchRole: true });
  const config = loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DB_SWITCH_ROLE: 'true',
    DATABASE_URL_APP: tdb.url, DATABASE_URL_PLATFORM: tdb.url,
    CSRF_SECRET: 'test-secret-test-secret-test-secret-123456', ALLOWED_ORIGINS: ORIGIN,
    RATE_LIMIT_MAX: '10000', AUTH_RATE_LIMIT_MAX: '10000', PLATFORM_AUTH_RATE_LIMIT_MAX: '10000', ...env,
  });
  let fixedNow: Date | null = null;
  const app = await buildApp({
    db, config, now: () => fixedNow ?? new Date(),
    mailer: opts.mailer === false ? undefined : { configured: true, async send(m) { mails.push(m); return true; } },
    // Route factice protégée : vérifie le contrôle d'accès (permission + état d'abonnement) en attendant les vrais modules
    extend: async (a) => {
      a.post('/api/v1/_test/rooms', { preValidation: a.hotelAuth({ permission: 'rooms:manage' }) }, async () => ({ created: true }));
      a.get('/api/v1/_test/rooms', { preValidation: a.hotelAuth({ permission: 'rooms:read' }) }, async (req) => ({ hotelId: req.hotel!.hotelId }));
    },
  });
  await app.ready();
  return {
    mails, app, db, tdb, config,
    setNow: (d) => { fixedNow = d; },
    async close() {
      await app.close();
      await db.close();
      await tdb.drop();
    },
  };
}

interface Reply { status: number; body: any; headers: Record<string, any>; cookies: Array<{ name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; maxAge?: number; path?: string }> }

/** Client HTTP de test : mémorise les cookies (hotel et plateforme séparés) et joint le jeton CSRF comme le ferait l'interface. */
export class Client {
  jar = new Map<string, string>();
  constructor(private t: TestApp, private csrfName = 'hmp_csrf') {}

  async call(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const h: Record<string, string> = { ...headers };
    if (method !== 'GET') {
      h.origin ??= ORIGIN;
      const csrf = this.jar.get(this.csrfName);
      if (csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = csrf;
    }
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.t.app.inject({ method, url, payload: payload as any, headers: h });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
    const text = res.body;
    let body: any = text;
    try { body = text ? JSON.parse(text) : undefined; } catch { /* corps non JSON */ }
    return { status: res.statusCode, body, headers: res.headers, cookies: res.cookies as Reply['cookies'] };
  }
  get = (url: string, headers?: Record<string, string>) => this.call('GET', url, undefined, headers);
  post = (url: string, payload?: unknown, headers?: Record<string, string>) => this.call('POST', url, payload ?? {}, headers);
  patch = (url: string, payload?: unknown, headers?: Record<string, string>) => this.call('PATCH', url, payload ?? {}, headers);
  put = (url: string, payload?: unknown, headers?: Record<string, string>) => this.call('PUT', url, payload ?? {}, headers);
  delete = (url: string, headers?: Record<string, string>) => this.call('DELETE', url, undefined, headers);
}

let n = 0;
export const uniqueEmail = (label = 'u') => `${label}-${process.pid}-${++n}-${randomUUID().slice(0, 6)}@example.test`;

export interface Registered { client: Client; email: string; hotelId: string; userId: string; slug: string; hotelName: string }

/** Inscrit un établissement par l'API (chemin réel) et renvoie un client connecté. */
export async function registerHotel(t: TestApp, over: Record<string, unknown> = {}): Promise<Registered> {
  const client = new Client(t);
  const email = (over.email as string) ?? uniqueEmail('owner');
  const hotelName = (over.hotelName as string) ?? `Hôtel Test ${randomUUID().slice(0, 6)}`;
  const res = await client.post('/api/v1/auth/register-hotel', {
    hotelName, city: 'Antananarivo', ownerName: 'Hanitra Rasoamanana', email, password: PASSWORD, acceptTerms: true, ...over,
  });
  if (res.status !== 201) throw new Error(`Inscription refusée (${res.status}) : ${JSON.stringify(res.body)}`);
  return { client, email, hotelId: res.body.hotel.id, userId: res.body.user.id, slug: res.body.hotel.slug, hotelName };
}

export async function createPlatformAdmin(t: TestApp, over: { email?: string; password?: string } = {}) {
  const email = over.email ?? uniqueEmail('admin');
  const password = over.password ?? PASSWORD;
  const { rows } = await t.tdb.admin.query<{ id: string }>(
    'INSERT INTO platform_admins (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Propriétaire Plateforme', await hashPassword(password)],
  );
  return { id: rows[0]!.id, email, password };
}

export async function platformLogin(t: TestApp, admin: { email: string; password: string }): Promise<Client> {
  const client = new Client(t, 'hmp_platform_csrf');
  const res = await client.post('/api/v1/platform/auth/login', { email: admin.email, password: admin.password });
  if (res.status !== 200) throw new Error(`Connexion plateforme refusée (${res.status}) : ${JSON.stringify(res.body)}`);
  return client;
}

/** Écriture « hors garde-fous » pour fabriquer un état passé (échéances dépassées) : désactive les triggers le temps d'une transaction. Test uniquement. */
export async function qUnguarded(t: TestApp, sql: string, params: unknown[] = []): Promise<void> {
  const c = await t.tdb.admin.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    await c.query(sql, params);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const q = async <T = any>(t: TestApp, sql: string, params: unknown[] = []): Promise<T[]> => (await t.tdb.admin.query(sql, params)).rows as T[];

/** Ajoute un membre du personnel (rôle système) à un établissement et renvoie un client connecté. */
export async function addStaff(t: TestApp, hotelId: string, roleKey: SystemRoleKey): Promise<{ client: Client; email: string; userId: string }> {
  const email = uniqueEmail(roleKey);
  const { rows } = await t.tdb.admin.query<{ id: string }>('INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, `Employé ${roleKey}`, await hashPassword(PASSWORD)]);
  const [role] = await q(t, 'SELECT id FROM roles WHERE hotel_id = $1 AND key = $2', [hotelId, roleKey]);
  await t.tdb.admin.query("INSERT INTO memberships (hotel_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')", [hotelId, rows[0]!.id, role.id]);
  const client = new Client(t);
  const res = await client.post('/api/v1/auth/login', { email, password: PASSWORD, hotelId });
  if (res.status !== 200) throw new Error(`Connexion du personnel refusée : ${JSON.stringify(res.body)}`);
  return { client, email, userId: rows[0]!.id };
}

/** Active un moyen de paiement manuel côté plateforme (consignes + activation) via l'API. */
export async function enableConnector(platform: Client, code: string, instructions = 'Envoyez le montant au 034 00 000 00 puis indiquez la référence.') {
  const res = await platform.patch(`/api/v1/platform/payment-connectors/${code}`, { instructions, isEnabled: true });
  if (res.status !== 200) throw new Error(`Activation du connecteur refusée : ${JSON.stringify(res.body)}`);
}
