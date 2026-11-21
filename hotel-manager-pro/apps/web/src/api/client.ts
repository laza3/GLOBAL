/**
 * Client HTTP de l'API. Règles :
 *  - cookies de session joints à chaque requête (credentials: 'include') ;
 *  - toute requête qui modifie l'état porte `X-CSRF-Token` = cookie CSRF lisible (celui de l'hôtel OU de la plateforme) ;
 *  - toutes les erreurs deviennent une `ApiError` au même format, avec un message en français prêt à afficher ;
 *  - une réponse 401 « non authentifié » avertit la session (déconnexion propre) ; une coupure réseau est dite telle quelle.
 */
export type Scope = 'hotel' | 'platform';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Message d'un champ précis (erreur de validation côté serveur), pour l'afficher sous le champ concerné. */
  fieldError(path: string): string | undefined {
    return this.details?.find((d) => d.path === path)?.message;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

const CSRF_COOKIES: Record<Scope, string[]> = {
  hotel: ['__Host-hmp_csrf', 'hmp_csrf'],
  platform: ['__Host-hmp_platform_csrf', 'hmp_platform_csrf'],
};

export function readCookie(name: string, source: string): string | null {
  for (const part of source.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Indice de session : le cookie CSRF est lisible par le JavaScript et n'existe QUE pendant une session. Sans lui, inutile
 * d'interroger le serveur (ce serait un 401 certain, et une erreur affichée dans la console du navigateur).
 * Ce n'est qu'un indice : seul le serveur fait foi (un cookie périmé donnera un vrai 401).
 */
export function hasSessionHint(scope: Scope, cookies: string = typeof document === 'undefined' ? '' : document.cookie): boolean {
  return CSRF_COOKIES[scope].some((name) => readCookie(name, cookies) !== null);
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  scope?: Scope;
  body?: unknown;
  query?: Query;
  /** Rejouer la même requête ne crée pas de doublon (paiements). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const NETWORK_MESSAGE = 'Impossible de joindre le serveur. Vérifiez votre connexion internet puis réessayez.';
const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Votre session a expiré. Reconnectez-vous pour continuer.',
  403: 'Vous n\'avez pas les droits nécessaires pour cette action.',
  404: 'Élément introuvable.',
  429: 'Trop de tentatives. Patientez un instant avant de réessayer.',
};

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cookies?: () => string;
  onUnauthenticated?: (scope: Scope) => void;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const cookies = options.cookies ?? (() => (typeof document === 'undefined' ? '' : document.cookie));
  let onUnauthenticated = options.onUnauthenticated;

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const scope = opts.scope ?? 'hotel';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      for (const name of CSRF_COOKIES[scope]) {
        const token = readCookie(name, cookies());
        if (token) {
          headers['X-CSRF-Token'] = token;
          break;
        }
      }
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await doFetch(`${base}/api/v1${path}${buildQuery(opts.query)}`, {
        method,
        headers,
        credentials: 'include',
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'network_error', NETWORK_MESSAGE);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: ApiError['details']; requestId?: string } } | undefined)?.error;
      const error = new ApiError(
        res.status,
        err?.code ?? 'unknown_error',
        err?.message ?? FALLBACK_MESSAGES[res.status] ?? 'Une erreur est survenue. Réessayez dans un instant.',
        err?.details,
        err?.requestId,
      );
      if (res.status === 401 && error.code === 'unauthenticated') onUnauthenticated?.(scope);
      throw error;
    }
    return json as T;
  }

  return {
    request,
    get: <T>(path: string, opts?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => request<T>('POST', path, { ...opts, body: body ?? {} }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => request<T>('PATCH', path, { ...opts, body: body ?? {} }),
    delete: <T>(path: string, opts?: Omit<RequestOptions, 'body'>) => request<T>('DELETE', path, opts),
    /** La session branche ici sa réaction à un 401 (vider le cache, rediriger vers la connexion). */
    setUnauthenticatedHandler(handler: ((scope: Scope) => void) | undefined) {
      onUnauthenticated = handler;
    },
  };
}

export const api = createApiClient();
