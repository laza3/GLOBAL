import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerWebApp } from '../src/lib/static-web';

const THEME = "document.documentElement.dataset.theme='dark'";
describe('service de l\'interface (installation locale)', () => {
  let dir: string, app: FastifyInstance;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hmp-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><script>${THEME}</script><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`);
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, '..secret.txt'), 'hors du dossier'); // fichier voisin du dossier : ne doit JAMAIS être servi
    app = Fastify(); registerWebApp(app, dir);
    app.get('/api/v1/ping', async () => ({ ok: true }));
    await app.ready();
  });
  afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('sert un fichier de l\'interface avec son type et un cache long pour /assets', async () => {
    const r = await app.inject('/assets/app.js');
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('text/javascript'); expect(r.headers['cache-control']).toContain('immutable');
  });
  it('toute page de l\'application renvoie index.html (routage côté navigateur), sans cache', async () => {
    for (const url of ['/', '/connexion', '/platform/connexion', '/reservations/42?x=1']) {
      const r = await app.inject(url);
      expect(r.statusCode, url).toBe(200); expect(r.body).toContain('id="root"'); expect(r.headers['cache-control']).toBe('no-store');
    }
  });
  it('un fichier absent n\'est pas remplacé par la page d\'accueil, et une route d\'API inconnue reste une 404', async () => {
    expect((await app.inject('/assets/absent.js')).statusCode).toBe(404);
    expect((await app.inject('/api/v1/inconnue')).statusCode).toBe(404);
    expect((await app.inject('/api/v1/ping')).json()).toEqual({ ok: true });
  });
  it('ne sort jamais du dossier de l\'interface', async () => {
    for (const url of ['/../secret.txt', '/..%2Fsecret.txt', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2F..%2Fsecret.txt', '/%00', '/%E0%A4%A']) {
      const r = await app.inject(url);
      expect(r.body, url).not.toContain('hors du dossier'); expect(r.body, url).not.toContain('root:');
    }
  });
  it('envoie une politique de sécurité qui autorise le script en ligne par son empreinte, sans unsafe-inline pour les scripts', async () => {
    const csp = String((await app.inject('/')).headers['content-security-policy']);
    expect(csp).toContain(`'sha256-${createHash('sha256').update(THEME).digest('base64')}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/); expect(csp).toContain("frame-ancestors 'none'");
    expect((await app.inject('/')).headers['strict-transport-security']).toBeUndefined(); // réseau local en HTTP
  });
});
