import { describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createApiClient, hasSessionHint, readCookie } from './client';

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('la requête aurait dû échouer'); }, (e: unknown) => e as ApiError);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(response: Response | (() => Response | Promise<Response>), cookies = 'hmp_csrf=tok-hotel; hmp_platform_csrf=tok-platform') {
  const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response.clone())) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const onUnauthenticated = vi.fn();
  const client = createApiClient({ fetchImpl, cookies: () => cookies, onUnauthenticated });
  return { client, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, onUnauthenticated };
}
const lastCall = (f: ReturnType<typeof vi.fn>) => {
  const [url, init] = f.mock.calls.at(-1)! as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init, headers: init.headers };
};

describe('cookies et chaînes de requête', () => {
  it('lit un cookie par son nom exact, décode la valeur, ignore les noms voisins', () => {
    expect(readCookie('hmp_csrf', 'a=1; hmp_csrf=abc%2Fdef; b=2')).toBe('abc/def');
    expect(readCookie('csrf', 'hmp_csrf=abc')).toBeNull();
    expect(readCookie('x', '')).toBeNull();
  });
  it('construit une chaîne de requête sans les valeurs vides', () => {
    expect(buildQuery({ q: 'baobab', page: 2, empty: '', none: undefined, nul: null, ok: false })).toBe('?q=baobab&page=2&ok=false');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('indice de session', () => {
  it('détecte une session par le cookie CSRF, par périmètre', () => {
    expect(hasSessionHint('hotel', 'hmp_csrf=abc')).toBe(true);
    expect(hasSessionHint('hotel', '__Host-hmp_csrf=abc')).toBe(true);
    expect(hasSessionHint('hotel', 'hmp_platform_csrf=abc')).toBe(false);
    expect(hasSessionHint('platform', 'hmp_platform_csrf=abc')).toBe(true);
    expect(hasSessionHint('platform', 'hmp_csrf=abc')).toBe(false);
    expect(hasSessionHint('hotel', '')).toBe(false);
  });
});

describe('client API', () => {
  it('joint les cookies, jamais de jeton CSRF sur une lecture', async () => {
    const { client, fetchImpl } = setup(json(200, { ok: true }));
    expect(await client.get('/me')).toEqual({ ok: true });
    const { url, init, headers } = lastCall(fetchImpl);
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('include');
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('pose le jeton CSRF de l\'hôtel ou de la plateforme selon le périmètre', async () => {
    const { client, fetchImpl } = setup(json(200, {}));
    await client.post('/hotel/onboarding/complete');
    expect(lastCall(fetchImpl).headers['X-CSRF-Token']).toBe('tok-hotel');
    await client.post('/platform/jobs/lifecycle', {}, { scope: 'platform' });
    expect(lastCall(fetchImpl).headers['X-CSRF-Token']).toBe('tok-platform');
    await client.patch('/hotel', { name: 'x' });
    expect(lastCall(fetchImpl).headers['Content-Type']).toBe('application/json');
    expect(lastCall(fetchImpl).init.body).toBe('{"name":"x"}');
  });

  it('préfère le cookie __Host- (production) quand il existe', async () => {
    const { client, fetchImpl } = setup(json(200, {}), '__Host-hmp_csrf=prod; hmp_csrf=dev');
    await client.post('/x');
    expect(lastCall(fetchImpl).headers['X-CSRF-Token']).toBe('prod');
  });

  it('transmet la clé d\'idempotence et la requête filtrée', async () => {
    const { client, fetchImpl } = setup(json(201, { id: 1 }));
    await client.post('/billing/invoices/1/payments', { method: 'mvola' }, { idempotencyKey: 'k-1' });
    expect(lastCall(fetchImpl).headers['Idempotency-Key']).toBe('k-1');
    await client.get('/platform/hotels', { scope: 'platform', query: { q: 'nosy', page: 1, status: '' } });
    expect(lastCall(fetchImpl).url).toBe('/api/v1/platform/hotels?q=nosy&page=1');
  });

  it('renvoie undefined pour une réponse 204', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    expect(await client.post('/auth/logout')).toBeUndefined();
  });

  it('transforme une erreur de l\'API en ApiError avec le message français et les champs fautifs', async () => {
    const body = { error: { code: 'validation_error', message: 'Certains champs sont invalides.', requestId: 'r-1', details: [{ path: 'email', message: 'Adresse e-mail invalide' }] } };
    const { client } = setup(json(422, body));
    const err = await fail(client.post('/auth/login', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation_error', message: 'Certains champs sont invalides.', requestId: 'r-1' });
    expect(err.fieldError('email')).toBe('Adresse e-mail invalide');
    expect(err.fieldError('password')).toBeUndefined();
  });

  it('donne un message utile même si le corps de l\'erreur est illisible', async () => {
    const { client } = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await fail(client.get('/me'));
    expect(err).toMatchObject({ status: 502, code: 'unknown_error' });
    expect(err.message).toMatch(/erreur est survenue/);
    const forbidden = await fail(setup(() => new Response('', { status: 403 })).client.get('/x'));
    expect(forbidden.message).toMatch(/droits nécessaires/);
  });

  it('dit clairement quand le serveur est injoignable, sans jargon', async () => {
    const client = createApiClient({ fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, cookies: () => '' });
    const err = await fail(client.get('/me'));
    expect(err).toMatchObject({ status: 0, code: 'network_error' });
    expect(err.message).toMatch(/Impossible de joindre le serveur/);
  });

  it('une requête annulée n\'est pas une erreur réseau', async () => {
    const client = createApiClient({ fetchImpl: (async () => { throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch, cookies: () => '' });
    const err = await fail(client.get('/me'));
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.name).toBe('AbortError');
  });

  it('avertit la session sur un 401 « non authentifié » — mais pas sur un mauvais mot de passe', async () => {
    const expired = setup(json(401, { error: { code: 'unauthenticated', message: 'Session expirée.', requestId: 'r' } }));
    await expired.client.get('/me', { scope: 'platform' }).catch(() => undefined);
    expect(expired.onUnauthenticated).toHaveBeenCalledWith('platform');

    const wrong = setup(json(401, { error: { code: 'invalid_credentials', message: 'Identifiants incorrects.', requestId: 'r' } }));
    await wrong.client.post('/auth/login', {}).catch(() => undefined);
    expect(wrong.onUnauthenticated).not.toHaveBeenCalled();
  });
});
