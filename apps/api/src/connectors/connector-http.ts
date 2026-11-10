import { createHmac, timingSafeEqual } from 'crypto';
import { AuthSpec, ConnectorSpec, InboundAuthSpec, RequestSpec } from './connector.types';
import { getPath, getString, render, renderText, resolveEnv, Vars } from './template';

export interface HttpResult {
  http_status: number;
  ok: boolean;
  body: unknown;
}

export type FetchFn = typeof fetch;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Executes the declarative requests of one connector. Holds the OAuth2 token cache. */
export class ConnectorHttp {
  private readonly tokens = new Map<string, CachedToken>();

  constructor(
    readonly name: string,
    readonly spec: ConnectorSpec,
    private readonly fetchFn: FetchFn = (...a) => fetch(...a),
    private readonly now: () => number = Date.now,
  ) {}

  private url(raw: string, vars: Vars): URL {
    const rendered = renderText(raw, vars);
    if (/^https?:\/\//.test(rendered)) return new URL(rendered);
    const base = resolveEnv(this.spec.base_url ?? '').replace(/\/+$/, '');
    return new URL(`${base}/${rendered.replace(/^\/+/, '')}`);
  }

  private async oauthToken(a: Extract<AuthSpec, { type: 'oauth2_client_credentials' }>): Promise<string> {
    const tokenUrl = resolveEnv(a.token_url);
    const key = `${tokenUrl}|${a.client_id}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.token;
    const id = resolveEnv(a.client_id);
    const secret = resolveEnv(a.client_secret);
    const form = new URLSearchParams({ grant_type: 'client_credentials' });
    if (a.scope) form.set('scope', resolveEnv(a.scope));
    for (const [k, v] of Object.entries(a.extra ?? {})) form.set(k, resolveEnv(v));
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if ((a.client_auth ?? 'basic') === 'basic') headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
    else {
      form.set('client_id', id);
      form.set('client_secret', secret);
    }
    const res = await this.fetchFn(tokenUrl, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`oauth2_http_${res.status}`);
    const body = (await res.json()) as unknown;
    const token = getString(body, a.token_path ?? 'access_token');
    if (!token) throw new Error('oauth2_no_token');
    const ttl = Number(getPath(body, a.expires_path ?? 'expires_in'));
    // Renew one minute before expiry; default lifetime 5 min when unknown.
    const lifetimeMs = (Number.isFinite(ttl) && ttl > 0 ? ttl : 300) * 1000;
    this.tokens.set(key, { token, expiresAt: this.now() + Math.max(lifetimeMs - 60_000, 10_000) });
    return token;
  }

  private async applyAuth(a: AuthSpec | undefined, headers: Record<string, string>, url: URL) {
    if (!a || a.type === 'none') return;
    switch (a.type) {
      case 'bearer':
        headers.authorization = `Bearer ${resolveEnv(a.token)}`;
        return;
      case 'basic':
        headers.authorization = `Basic ${Buffer.from(`${resolveEnv(a.username)}:${resolveEnv(a.password)}`).toString('base64')}`;
        return;
      case 'header':
        headers[a.name.toLowerCase()] = resolveEnv(a.value);
        return;
      case 'query':
        url.searchParams.set(a.name, resolveEnv(a.value));
        return;
      case 'oauth2_client_credentials':
        headers.authorization = `Bearer ${await this.oauthToken(a)}`;
        return;
    }
  }

  /** Renders and sends one request; never throws on HTTP errors (returns ok=false). */
  async call(req: RequestSpec, vars: Vars): Promise<HttpResult> {
    const url = this.url(req.url, vars);
    const method = req.method ?? 'POST';
    const format = req.format ?? (method === 'GET' ? 'none' : 'json');
    const headers: Record<string, string> = { accept: 'application/json' };
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = renderText(v, vars);
    await this.applyAuth(req.auth ?? this.spec.auth, headers, url);
    let body: string | undefined;
    if (format !== 'none' && req.body !== undefined) {
      const rendered = render(req.body, vars);
      if (format === 'json') {
        headers['content-type'] ??= 'application/json';
        body = JSON.stringify(rendered);
      } else {
        headers['content-type'] ??= 'application/x-www-form-urlencoded';
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries((rendered ?? {}) as Record<string, unknown>)) {
          if (v !== null && v !== undefined) form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        body = form.toString();
      }
    }
    const res = await this.fetchFn(url.toString(), { method, headers, body, signal: AbortSignal.timeout(req.timeout_ms ?? 15_000) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: keep the raw text so that paths simply resolve to undefined.
      parsed = text;
    }
    const httpOk = req.success?.http ? req.success.http.includes(res.status) : res.status >= 200 && res.status < 300;
    let ok = httpOk;
    if (ok && req.success?.path) {
      const v = getPath(parsed, req.success.path);
      ok = (req.success.equals ?? [true]).some((e) => String(e) === String(v));
    }
    return { http_status: res.status, ok, body: parsed };
  }
}

/** Checks the shared secret or signature of a call made by the aggregator to us. */
export function verifyInbound(
  auth: InboundAuthSpec | undefined,
  req: { headers: Record<string, string | string[] | undefined>; query: Record<string, unknown>; rawBody?: Buffer },
): boolean {
  if (!auth || auth.type === 'none') return true;
  const header = (name: string) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const same = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  if (auth.type === 'header') {
    const v = header(auth.name);
    return typeof v === 'string' && same(v, resolveEnv(auth.value));
  }
  if (auth.type === 'query') {
    const v = req.query[auth.name];
    return typeof v === 'string' && same(v, resolveEnv(auth.value));
  }
  const given = header(auth.header);
  if (!given || !req.rawBody) return false;
  const algo = auth.type === 'hmac_sha512' ? 'sha512' : 'sha256';
  const expected = createHmac(algo, resolveEnv(auth.secret)).update(req.rawBody).digest(auth.encoding ?? 'hex');
  const value = auth.prefix && given.startsWith(auth.prefix) ? given.slice(auth.prefix.length) : given;
  return same(value, expected);
}
