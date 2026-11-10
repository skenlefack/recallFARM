import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, request, setTransport, type Transport } from './client';
import { session } from './session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  setTransport(null);
  session.clear();
});

describe('api client', () => {
  it('maps the uniform error format to ApiError', async () => {
    setTransport(async () => json(422, { error: { code: 'BUSINESS_RULE', message: 'Quatre yeux', details: { rule: 'RG-PAR-04' } } }));
    const e = (await request('POST', '/studio/versions/x/publish').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('BUSINESS_RULE');
    expect(e.rule).toBe('RG-PAR-04');
    expect(e.status).toBe(422);
  });

  it('refreshes once on 401 then retries with the new token', async () => {
    session.setTokens('old', 'rt-1', 'login');
    const calls: string[] = [];
    const t: Transport = async (method, url, init) => {
      calls.push(`${method} ${url} ${init.headers.Authorization ?? ''}`);
      if (url.endsWith('/auth/refresh')) return json(200, { access_token: 'new' });
      if (init.headers.Authorization === 'Bearer old') return json(401, { error: { code: 'UNAUTHENTICATED', message: 'expiré' } });
      return json(200, { ok: true });
    };
    setTransport(t);
    await expect(request('GET', '/me')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['GET /v1/me Bearer old', 'POST /v1/auth/refresh ', 'GET /v1/me Bearer new']);
    expect(session.accessToken).toBe('new');
  });

  it('clears the session when refresh fails', async () => {
    session.setTokens('old', 'rt-1', 'login');
    setTransport(async (_m, url) => (url.endsWith('/auth/refresh') ? json(401, {}) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'expiré' } })));
    await expect(request('GET', '/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(session.isAuthenticated).toBe(false);
  });

  it('reports network failures with a NETWORK code', async () => {
    setTransport(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(request('GET', '/plans')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
