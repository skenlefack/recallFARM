/**
 * HTTP client for the RecallFarm API (`/v1`, same origin behind the gateway).
 * - uniform error format → ApiError
 * - Bearer token, 401 → POST /auth/refresh (single flight) → retry once
 * - VITE_MOCK=1 → requests are answered by in-browser fixtures (dynamic import, absent from prod bundle)
 */
import type { ApiErrorBody } from './types';
import { session } from './session';

export const API_BASE = '/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get rule(): string | undefined {
    const r = this.details?.rule;
    return typeof r === 'string' ? r : undefined;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** multipart upload */
  form?: FormData;
  /** return the raw Response (files) */
  raw?: boolean;
  auth?: boolean;
  signal?: AbortSignal;
}

export interface Transport {
  (method: string, url: string, init: { headers: Record<string, string>; body?: BodyInit | null; signal?: AbortSignal }): Promise<Response>;
}

let transportPromise: Promise<Transport> | null = null;

function getTransport(): Promise<Transport> {
  if (!transportPromise) {
    if (import.meta.env.VITE_MOCK === '1') {
      transportPromise = import('../mocks/server').then((m) => m.mockTransport);
    } else {
      transportPromise = Promise.resolve((method, url, init) => fetch(url, { method, ...init, credentials: 'same-origin' }));
    }
  }
  return transportPromise;
}

/** Tests can inject a transport. */
export function setTransport(t: Transport | null): void {
  transportPromise = t ? Promise.resolve(t) : null;
}

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  const e = body?.error;
  if (e && typeof e.code === 'string') return new ApiError(res.status, e.code, e.message || defaultMessage(res.status), e.fields, e.details);
  return new ApiError(res.status, res.status >= 500 ? 'SERVER_ERROR' : 'HTTP_' + res.status, defaultMessage(res.status));
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Votre session a expiré. Reconnectez-vous.';
  if (status === 403) return "Vous n'avez pas accès à cette fonction.";
  if (status === 404) return 'Élément introuvable.';
  if (status === 429) return 'Trop de demandes. Patientez un instant.';
  if (status >= 500) return 'Le serveur rencontre un problème. Réessayez dans un moment.';
  return 'La demande a échoué.';
}

let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  const rt = session.refreshToken;
  if (!rt) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const t = await getTransport();
        const res = await t('POST', buildUrl('/auth/refresh'), {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return false;
        const j = (await res.json()) as { access_token: string; refresh_token?: string };
        session.setTokens(j.access_token, j.refresh_token ?? rt);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const t = await getTransport();
  const url = buildUrl(path, opts.query);
  const auth = opts.auth !== false;

  const send = () => {
    const headers: Record<string, string> = { Accept: opts.raw ? '*/*' : 'application/json', 'Accept-Language': 'fr' };
    let body: BodyInit | null = null;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (auth && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    return t(method, url, { headers, body, signal: opts.signal });
  };

  let res: Response;
  try {
    res = await send();
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez votre réseau puis réessayez.');
  }

  if (res.status === 401 && auth && session.refreshToken) {
    const ok = await refreshOnce();
    if (ok) {
      try {
        res = await send();
      } catch {
        throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez votre réseau puis réessayez.');
      }
    }
    if (res.status === 401) {
      session.clear('expired');
    }
  }

  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(path: string, query?: Query, o?: RequestOptions) => request<T>('GET', path, { ...o, query }),
  post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('POST', path, { ...o, body }),
  patch: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PATCH', path, { ...o, body }),
  del: <T>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
};

/** Human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur inattendue est survenue.';
}
