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
  /** Token requests in flight: concurrent calls at expiry share one request (m7). */
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    readonly name: string,
    readonly spec: ConnectorSpec,
    private readonly fetchFn: FetchFn = (...a) => fetch(...a),
    private readonly now: () => number = Date.now,
  ) {}

  private url(raw: string, vars: Vars): URL {
    // Values inserted in a URL are percent-encoded: a "&" in a batch name cannot add parameters.
    const rendered = renderText(raw, vars, encodeURIComponent);
    if (/^https?:\/\//.test(rendered)) return new URL(rendered);
    const base = resolveEnv(this.spec.base_url ?? '').replace(/\/+$/, '');
    return new URL(`${base}/${rendered.replace(/^\/+/, '')}`);
  }

  private tokenKey(a: Extract<AuthSpec, { type: 'oauth2_client_credentials' }>): string {
    return `${resolveEnv(a.token_url)}|${a.client_id}`;
  }

  private async oauthToken(a: Extract<AuthSpec, { type: 'oauth2_client_credentials' }>): Promise<string> {
    const key = this.tokenKey(a);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.token;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.fetchToken(a, key).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async fetchToken(a: Extract<AuthSpec, { type: 'oauth2_client_credentials' }>, key: string): Promise<string> {
    const tokenUrl = resolveEnv(a.token_url);
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

  /**
   * Renders and sends one request; never throws on HTTP errors (returns ok=false).
   * With OAuth2, a 401 drops the cached token and the call is retried once with a new one (revoked token, m7).
   */
  async call(req: RequestSpec, vars: Vars): Promise<HttpResult> {
    const auth = req.auth ?? this.spec.auth;
    const first = await this.callOnce(req, vars, auth);
    if (first.http_status !== 401 || auth?.type !== 'oauth2_client_credentials') return first;
    this.tokens.delete(this.tokenKey(auth));
    return this.callOnce(req, vars, auth);
  }

  private async callOnce(req: RequestSpec, vars: Vars, auth: AuthSpec | undefined): Promise<HttpResult> {
    const url = this.url(req.url, vars);
    const method = req.method ?? 'POST';
    const format = req.format ?? (method === 'GET' ? 'none' : 'json');
    const headers: Record<string, string> = { accept: 'application/json' };
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = renderText(v, vars);
    await this.applyAuth(auth, headers, url);
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

export interface InboundCheck {
  ok: boolean;
  /** Why the call was refused (never the expected value). */
  reason?: 'secret' | 'signature' | 'timestamp';
  /** With a signing time: key to remember for `replay_ttl_ms`; a second call with the same key is a replay. */
  replay_key?: string;
  replay_ttl_ms?: number;
}

type InboundRequest = { headers: Record<string, string | string[] | undefined>; query: Record<string, unknown>; rawBody?: Buffer };

/** Signing time in ms from a header value: Unix seconds, Unix milliseconds or ISO 8601. */
export function parseTimestamp(v: string): number | null {
  if (/^\d{9,11}$/.test(v)) return Number(v) * 1000;
  if (/^\d{12,14}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(v) ? t : null;
}

/**
 * Checks the shared secret or signature of a call made by the aggregator to us, in constant time.
 * With `timestamp_header`, the signing time must be within `tolerance_s` (anti-replay); the caller
 * stores `replay_key` so that the same signature is accepted only once.
 */
export function inspectInbound(auth: InboundAuthSpec | undefined, req: InboundRequest, now: number = Date.now()): InboundCheck {
  if (!auth || auth.type === 'none') return { ok: true };
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
    return typeof v === 'string' && same(v, resolveEnv(auth.value)) ? { ok: true } : { ok: false, reason: 'secret' };
  }
  if (auth.type === 'query') {
    const v = req.query[auth.name];
    return typeof v === 'string' && same(v, resolveEnv(auth.value)) ? { ok: true } : { ok: false, reason: 'secret' };
  }
  const given = header(auth.header);
  if (!given || !req.rawBody) return { ok: false, reason: 'signature' };
  let ts: string | undefined;
  const toleranceMs = (auth.tolerance_s ?? 300) * 1000;
  if (auth.timestamp_header) {
    ts = header(auth.timestamp_header);
    const at = ts ? parseTimestamp(ts) : null;
    if (at === null || Math.abs(now - at) > toleranceMs) return { ok: false, reason: 'timestamp' };
  }
  const [before, after] = (auth.signed_payload ?? '{{body}}').split('{{body}}');
  const fill = (part: string) => Buffer.from(part.split('{{timestamp}}').join(ts ?? ''));
  const payload = Buffer.concat([fill(before), req.rawBody, fill(after ?? '')]);
  const algo = auth.type === 'hmac_sha512' ? 'sha512' : 'sha256';
  const expected = createHmac(algo, resolveEnv(auth.secret)).update(payload).digest(auth.encoding ?? 'hex');
  const raw = auth.prefix && given.startsWith(auth.prefix) ? given.slice(auth.prefix.length) : given;
  const value = (auth.encoding ?? 'hex') === 'hex' ? raw.toLowerCase() : raw;
  if (!same(value, expected)) return { ok: false, reason: 'signature' };
  return auth.timestamp_header ? { ok: true, replay_key: `${algo}:${expected}`, replay_ttl_ms: 2 * toleranceMs } : { ok: true };
}

/** Boolean form of {@link inspectInbound} (no replay bookkeeping). */
export function verifyInbound(auth: InboundAuthSpec | undefined, req: InboundRequest, now?: number): boolean {
  return inspectInbound(auth, req, now).ok;
}
