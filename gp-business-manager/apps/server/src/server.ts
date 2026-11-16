import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Db } from '@gp/core/db';
import { App, type Envelope } from '@gp/core/api';
import { assertCanFactoryReset, deleteBackupFiles, resetBusinessData } from '@gp/core/reset';
import { reportToCsv, reportToHtml, reportToXlsx, runReport } from '@gp/core/reports';
import { AppError } from '@gp/core/util';

export interface ServerOptions {
  db: Db;
  version: string;
  /** Dossier du site web compilé (index.html, assets…). Sans lui, seule l'API répond. */
  publicDir?: string;
  backupDir?: string;
  /** Cookie « Secure » : à activer dès que le site est servi en HTTPS (toujours en production). */
  secureCookies?: boolean;
  /** Derrière un proxy (Caddy, nginx) : l'adresse du client est lue dans X-Forwarded-For. */
  trustProxy?: boolean;
  /** Code exigé pour créer la toute première entreprise (évite qu'un inconnu configure le serveur avant son propriétaire). */
  setupCode?: string;
  log?: (msg: string, err?: unknown) => void;
}

const COOKIE = 'gp_session';
const MAX_BODY = 3_000_000; // images produit/logo jusqu'à ~700 Ko encodées + marge
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** Limite de tentatives de connexion par adresse (en plus du verrou par compte) : 20 échecs / 5 min. */
class LoginLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 20, private windowMs = 5 * 60_000) {}
  blocked(ip: string) {
    const now = Date.now();
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(ip, list);
    return list.length >= this.max;
  }
  fail(ip: string) { this.hits.set(ip, [...(this.hits.get(ip) ?? []), Date.now()]); }
  clear(ip: string) { this.hits.delete(ip); }
}

function parseCookies(h: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createGpServer(opt: ServerOptions) {
  const log = opt.log ?? (() => {});
  const core = new App(opt.db, log);
  const limiter = new LoginLimiter();
  const publicDir = opt.publicDir ? resolve(opt.publicDir) : undefined;

  const baseHeaders = (): Record<string, string> => ({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(opt.secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  });

  const clientIp = (req: IncomingMessage) => {
    if (opt.trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress ?? 'inconnue';
  };

  function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data), ...extra });
    res.end(data);
  }

  const cookieValue = (token: string, maxAge: number) =>
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${opt.secureCookies ? '; Secure' : ''}`;

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Content-Type application/json requis');
    // protection CSRF : un en-tête personnalisé ne peut pas être envoyé par un formulaire d'un autre site
    if (req.headers['x-gp-request'] !== '1') throw new HttpError(403, 'En-tête de sécurité manquant');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse');
      chunks.push(c as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON invalide'); }
  }

  async function handleCall(req: IncomingMessage, res: ServerResponse) {
    const body = (await readBody(req)) as { method?: unknown; params?: any };
    if (typeof body.method !== 'string') throw new HttpError(400, 'Méthode manquante');
    const method = body.method;
    let params = body.params;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const ip = clientIp(req);
    const isLogin = method === 'auth.login';

    if (isLogin && limiter.blocked(ip)) return sendJson(res, 429, { ok: false, error: { code: 'TOO_MANY_ATTEMPTS', message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' } });

    if (method === 'app.setup') {
      // première configuration : réservée à qui connaît le code du serveur
      const given = String(params?.setupCode ?? '');
      if (!core.status().configured) {
        if (!opt.setupCode || !safeEqual(given, opt.setupCode)) {
          limiter.fail(ip);
          return sendJson(res, 403, { ok: false, error: { code: 'SETUP_CODE', message: 'Code d’installation incorrect (voir la configuration du serveur).' } });
        }
      }
      if (params && typeof params === 'object') { params = { ...params }; delete params.setupCode; }
    }

    const r: Envelope = await core.call(method, params, token, 'web');

    if (r.ok && (method === 'auth.login' || method === 'app.setup')) {
      limiter.clear(ip);
      const d = r.data as { token: string; user: unknown };
      return sendJson(res, 200, { ok: true, data: d.user }, { 'Set-Cookie': cookieValue(d.token, 8 * 3600) });
    }
    if (isLogin && !r.ok) limiter.fail(ip);
    const clear = method === 'auth.logout' || (!r.ok && r.error.code === 'UNAUTHENTICATED');
    return sendJson(res, 200, r, clear ? { 'Set-Cookie': cookieValue('', 0) } : {});
  }

  const file = (name: string, mime: string, data: Buffer | string) => ({ filename: name, mime, base64: Buffer.from(data).toString('base64') });

  async function system(op: string, p: any, token: string | undefined) {
    const ctx = () => core.sessions.resolve(token);
    const need = (perm: string) => { if (!ctx().user.permissions.has(perm)) throw new AppError('FORBIDDEN', `Permission requise : ${perm}`); };
    switch (op) {
      case 'info': ctx(); return { version: opt.version, dataDir: 'Serveur GP', backupDir: 'Serveur GP', dbPath: '', platform: 'web' };
      case 'listBackups': need('backup.manage'); return opt.backupDir && existsSync(opt.backupDir) ? readdirSync(opt.backupDir).sort().reverse().map((f) => ({ name: f, size: statSync(join(opt.backupDir!, f)).size })) : [];
      case 'listPrinters': ctx(); return [];
      case 'update': ctx(); if (p?.op === 'state') return { enabled: false, status: 'idle' }; throw new AppError('NOT_AVAILABLE', 'Le site web est mis à jour automatiquement par le serveur.');
      case 'backup': {
        need('backup.manage');
        const tmp = join(tmpdir(), `gp-${randomBytes(6).toString('hex')}.db`);
        try { opt.db.backupTo(tmp); return file(`gp-sauvegarde-${new Date().toISOString().slice(0, 10)}.gpbak`, 'application/octet-stream', readFileSync(tmp)); } finally { try { unlinkSync(tmp); } catch { /* ignore */ } }
      }
      case 'exportReport': {
        const c = ctx(); need('report.export');
        const rep = runReport(c, p.query);
        const base = `${rep.type}-${new Date().toISOString().slice(0, 10)}`;
        if (p.format === 'csv') return file(`${base}.csv`, 'text/csv', reportToCsv(c, rep));
        if (p.format === 'xlsx') return file(`${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await reportToXlsx(c, rep));
        // PDF : le navigateur imprime le rapport (« Enregistrer au format PDF ») ; on renvoie le HTML prêt à imprimer
        return { printHtml: reportToHtml(c, rep) };
      }
      case 'factoryReset': {
        const c = ctx();
        assertCanFactoryReset(c, String(p?.password ?? ''), String(p?.confirm ?? ''));
        log(`Réinitialisation des données demandée par ${c.user.username}`);
        if (opt.backupDir && !p?.deleteBackups) opt.db.backupTo(join(opt.backupDir, `avant-reinitialisation-${Date.now()}.db`));
        const r = resetBusinessData(opt.db);
        if (opt.backupDir && p?.deleteBackups) deleteBackupFiles(opt.backupDir);
        return { ok: true, ...r };
      }
      case 'restore': case 'openDataFolder': ctx(); throw new AppError('NOT_AVAILABLE', 'Cette opération se fait directement sur le serveur par l’hébergeur (voir la documentation).');
      case 'print': case 'savePdf': case 'pickImage': ctx(); throw new AppError('NOT_AVAILABLE', 'Géré par le navigateur.');
    }
    throw new AppError('UNKNOWN_METHOD', 'Opération inconnue');
  }

  async function handleSystem(req: IncomingMessage, res: ServerResponse) {
    const body = (await readBody(req)) as { op?: unknown; params?: unknown };
    if (typeof body.op !== 'string') throw new HttpError(400, 'Opération manquante');
    const token = parseCookies(req.headers.cookie)[COOKIE];
    try {
      const data = await system(body.op, body.params, token);
      sendJson(res, 200, { ok: true, data });
    } catch (e: any) {
      const code = e?.code ?? 'ERROR';
      if (code === 'ERROR') log(`Erreur système ${body.op}`, e);
      sendJson(res, 200, { ok: false, error: { code, message: code === 'ERROR' ? 'Erreur interne. Consultez le journal du serveur.' : e.message } }, code === 'UNAUTHENTICATED' ? { 'Set-Cookie': cookieValue('', 0) } : {});
    }
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!publicDir) throw new HttpError(404, 'Introuvable');
    let rel: string;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Adresse invalide'); }
    let full = normalize(join(publicDir, rel));
    if (full !== publicDir && !full.startsWith(publicDir + sep)) throw new HttpError(403, 'Interdit'); // anti « ../ »
    if (!existsSync(full) || statSync(full).isDirectory()) {
      if (extname(rel)) throw new HttpError(404, 'Introuvable'); // fichier manquant : pas de repli HTML
      full = join(publicDir, 'index.html');
      if (!existsSync(full)) throw new HttpError(404, 'Site non construit');
    }
    const ext = extname(full).toLowerCase();
    const isAsset = /[\\/]assets[\\/]/.test(full);
    const data = readFileSync(full);
    res.writeHead(200, {
      ...baseHeaders(),
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': data.length,
      // fichiers hachés : cache long ; page, manifest et service worker : toujours revalidés (mises à jour immédiates)
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, version: opt.version });
        if (url.pathname === '/api/call') { if (req.method !== 'POST') throw new HttpError(405, 'POST requis'); return await handleCall(req, res); }
        if (url.pathname === '/api/system') { if (req.method !== 'POST') throw new HttpError(405, 'POST requis'); return await handleSystem(req, res); }
        if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Introuvable');
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
        return serveStatic(req, res, url.pathname);
      } catch (e: any) {
        if (e instanceof HttpError) { req.resume(); return sendJson(res, e.status, { ok: false, error: { code: 'HTTP_' + e.status, message: e.message } }, e.status === 413 ? { Connection: 'close' } : {}); }
        log('Erreur HTTP', e);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'Erreur interne' } });
      }
    })();
  });
  // robustesse : connexions lentes ou abandonnées
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  return { server, core };
}

/** Sauvegarde quotidienne automatique (14 conservées). */
export function dailyBackup(db: Db, dir: string, log: (m: string, e?: unknown) => void) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `auto-${new Date().toISOString().slice(0, 10)}.db`);
    if (!existsSync(file)) { db.backupTo(file); log(`Sauvegarde automatique : ${file}`); }
    for (const f of readdirSync(dir).filter((x) => x.startsWith('auto-')).sort().slice(0, -14)) unlinkSync(join(dir, f));
  } catch (e) { log('Sauvegarde automatique impossible', e); }
}
