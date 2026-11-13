import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConnectorRegistry } from '../connectors/connector-registry';
import { FetchFn } from '../connectors/connector-http';
import { ProvidersConfig } from '../connectors/connector.types';
import { logSafe } from '../connectors/connectors.controller';
import { loadConfig } from '../config';
import { Payment } from '../database/entities';
import { DataSource } from 'typeorm';
import { BillingService, idFromKey, paymentEvents } from './billing.service';
import { nextPollDelayMin, PaymentOpsService } from './payment-ops.service';
import { ConnectorPaymentProvider, isNetworkError, PaymentProviderError, SimulatorPaymentProvider } from './payment.providers';

const EXAMPLE = resolve(__dirname, '../../../../infra/providers/providers.example.json');

function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const fn: FetchFn = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body as string | undefined });
    const next = responses.shift() ?? { status: 599 };
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  };
  return { fn, calls };
}

const payment = (extra: Partial<Payment> = {}) =>
  Object.assign(new Payment(), {
    id: '0b7c6f2e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
    amount_minor: 2500,
    currency: 'XAF',
    method: 'orange_money',
    phone: '+237690000001',
    provider_ref: 'TX-9',
    raw: { connector: 'agregateur_exemple' },
    ...extra,
  });

describe('payment helpers (M6)', () => {
  it('waits N, 2N, 4N... minutes between status queries, capped', () => {
    expect([0, 1, 2, 3, 4, 5].map((a) => nextPollDelayMin(a, 5, 60))).toEqual([5, 10, 20, 40, 60, 60]);
    expect(nextPollDelayMin(-1, 5, 60)).toBe(5);
  });

  it('derives a stable payment id per (user, idempotency key)', () => {
    const a = idFromKey('u1', 'tap-1');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idFromKey('u1', 'tap-1')).toBe(a);
    expect(idFromKey('u2', 'tap-1')).not.toBe(a);
    expect(idFromKey('u1', 'tap-2')).not.toBe(a);
  });

  it('makes caller values safe for one log line (m10)', () => {
    expect(logSafe('SUCCESS')).toBe('SUCCESS');
    expect(logSafe('a\nFAUX LOG\r\u0000b')).toBe('a FAUX LOG b');
    expect(logSafe('x'.repeat(100))).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('ConnectorPaymentProvider: status, refund, list (M6)', () => {
  const env = process.env;
  beforeAll(() => {
    process.env = { ...env, AGREGATEUR_API_TOKEN: 't', AGREGATEUR_CALLBACK_TOKEN: 'c', OPERATEUR_CLIENT_ID: 'i', OPERATEUR_CLIENT_SECRET: 's', OPERATEUR_WEBHOOK_SECRET: 'w' };
  });
  afterAll(() => {
    process.env = env;
  });
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ProvidersConfig;

  function provider(responses: Array<{ status?: number; body?: unknown }>) {
    const f = fakeFetch(responses);
    return { p: new ConnectorPaymentProvider(new ConnectorRegistry(example, f.fn)), calls: f.calls };
  }

  it('lists connectors and the route of a method', () => {
    const { p } = provider([]);
    expect(p.connectors()).toEqual(['agregateur_exemple', 'operateur_oauth_exemple']);
    expect(p.routeOf('mtn_momo')).toBe('operateur_oauth_exemple');
    expect(p.routeOf('cash')).toBeUndefined();
  });

  it('asks the status of the connector that initiated the payment', async () => {
    const { p, calls } = provider([{ body: { status: 'SUCCESS', fees: '15', amount: 2500, currency: 'XAF' } }, { body: { status: 'BIZARRE' } }, { status: 502 }]);
    expect(await p.status(payment())).toEqual({ status: 'confirme', raw_status: 'SUCCESS', fees_minor: 15, amount_minor: 2500, currency: 'XAF' });
    // Queried by our reference (documented as recommended): works without an aggregator reference.
    expect(calls[0]).toMatchObject({ method: 'GET', url: `https://api.agregateur.example/v1/payments/by-reference/${payment().id}` });
    expect(await p.status(payment())).toMatchObject({ status: 'inconnu', raw_status: 'BIZARRE' });
    await expect(p.status(payment())).rejects.toMatchObject({ code: 'http_502', definitive: false });
    // A connector without status query answers null.
    expect(await p.status(payment({ raw: { connector: 'operateur_oauth_exemple' }, method: 'mtn_momo' }))).toBeNull();
    await expect(p.status(payment({ raw: {}, method: 'cash' }))).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('never sends a query that needs the aggregator reference when the payment has none (M1)', async () => {
    const byRef = JSON.parse(JSON.stringify(example)) as ProvidersConfig;
    byRef.connectors.agregateur_exemple.payment!.status!.url = '/payments/{{provider_ref}}';
    const f = fakeFetch([]);
    const p = new ConnectorPaymentProvider(new ConnectorRegistry(byRef, f.fn));
    await expect(p.status(payment({ provider_ref: null }))).rejects.toMatchObject({ code: 'non_interrogeable_sans_reference', definitive: true });
    await expect(p.refund(payment({ provider_ref: null }), 'k', 'r')).rejects.toMatchObject({ code: 'non_interrogeable_sans_reference' });
    expect(f.calls).toHaveLength(0);
  });

  it('refunds with a stable key and reads the outcome only as the descriptor says (M3)', async () => {
    const { p, calls } = provider([
      { body: { refund_id: 'RF-1', state: 'DONE' } },
      { body: { state: 'QUEUED' } },
      { body: { state: 'REJECTED' } },
      { status: 409 },
      { status: 202, body: {} },
      { status: 400 },
      { status: 503 },
    ]);
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'rembourse', refund_ref: 'RF-1', http_status: 200 });
    expect(JSON.parse(calls[0].body!)).toMatchObject({ idempotency_key: 'key-1', transaction_id: 'TX-9', amount: 2500, reason: 'doublon' });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'en_attente', http_status: 200 });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'echoue', http_status: 200 });
    // 409 declared "already refunded" in http_map.
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'rembourse', http_status: 409 });
    // 202 without status: pending, never a success by default; undeclared codes: unknown, never a refusal.
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'en_attente', http_status: 202 });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'inconnu', http_status: 400 });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'inconnu', http_status: 503 });
    await expect(p.refund(payment({ raw: { connector: 'operateur_oauth_exemple' } }), 'k', 'r')).rejects.toMatchObject({ code: 'not_supported', definitive: true });
  });

  it('asks the outcome of a refund when the connector describes it', async () => {
    const { p, calls } = provider([{ body: { state: 'DONE' } }, { body: { state: '??' } }, { status: 500 }]);
    expect(p.refundStatusAvailable(payment())).toBe(true);
    expect(await p.refundStatus(payment(), 'key-1')).toEqual({ status: 'rembourse', http_status: 200 });
    expect(calls[0].url).toBe('https://api.agregateur.example/v1/payments/refunds/key-1');
    expect(await p.refundStatus(payment(), 'key-1')).toEqual({ status: 'en_attente', http_status: 200 });
    expect(await p.refundStatus(payment(), 'key-1')).toEqual({ status: 'inconnu', http_status: 500 });
    const other = payment({ raw: { connector: 'operateur_oauth_exemple' } });
    expect(p.refundStatusAvailable(other)).toBe(false);
    expect(await p.refundStatus(other, 'k')).toBeNull();
  });

  it('tells network failures from programming errors (m7)', () => {
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isNetworkError('x')).toBe(false);
  });

  it('reads the daily list of transactions', async () => {
    const { p, calls } = provider([{ body: { data: [{ reference: 'P1', transaction_id: 'T1', status: 'SUCCESS', amount: 2500 }, { transaction_id: 'T2', status: 'FAILED' }] } }, { body: { data: 'x' } }, { status: 500 }]);
    expect(await p.list('agregateur_exemple', '2026-11-09', 'a', 'b')).toEqual([
      { payment_id: 'P1', provider_ref: 'T1', status: 'confirme', raw_status: 'SUCCESS', amount_minor: 2500 },
      { provider_ref: 'T2', status: 'echoue', raw_status: 'FAILED' },
    ]);
    expect(calls[0].url).toBe('https://api.agregateur.example/v1/payments?date=2026-11-09');
    await expect(p.list('agregateur_exemple', '2026-11-09', 'a', 'b')).rejects.toMatchObject({ code: 'no_items' });
    await expect(p.list('agregateur_exemple', '2026-11-09', 'a', 'b')).rejects.toMatchObject({ code: 'http_500' });
    expect(await p.list('operateur_oauth_exemple', '2026-11-09', 'a', 'b')).toBeNull();
    expect(await p.list('absent', '2026-11-09', 'a', 'b')).toBeNull();
  });

  it('simulator: no status query, immediate refunds', async () => {
    const sim = new SimulatorPaymentProvider();
    expect(await sim.status()).toBeNull();
    expect(await sim.refund()).toEqual({ status: 'rembourse', refund_ref: expect.stringMatching(/^SIMREF-/) });
  });
});

describe('PaymentOpsService.pollPending', () => {
  it('goes on with the other payments when one cannot be applied', async () => {
    const a = payment({ id: 'a' });
    const b = payment({ id: 'b' });
    // First query: the claim (UPDATE ... RETURNING); then the bookkeeping updates.
    const ds = { query: jest.fn().mockResolvedValueOnce([[a, b], 2]).mockResolvedValue([[], 1]) };
    const billing = { applyResult: jest.fn().mockRejectedValueOnce(new Error('Paiement introuvable')).mockResolvedValueOnce({ status: 'confirme' }) };
    const provider = { name: 'x', initiate: jest.fn(), status: jest.fn().mockResolvedValue({ status: 'confirme', raw_status: 'SUCCESS' }) };
    const ops = new PaymentOpsService(ds as unknown as DataSource, billing as unknown as BillingService, provider);
    expect(await ops.pollPending(new Date())).toEqual({ checked: 2, confirmed: 1, failed: 0, still_pending: 0, flagged: 0, errors: 1 });
    expect(ds.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('marks a payment without aggregator reference "non interrogeable", without concluding (M1)', async () => {
    const p = payment({ id: 'c', provider_ref: null });
    const ds = { query: jest.fn().mockResolvedValueOnce([[p], 1]).mockResolvedValue([[], 1]) };
    const provider = { name: 'x', initiate: jest.fn(), status: jest.fn().mockRejectedValue(new PaymentProviderError('non_interrogeable_sans_reference', 'x', true)) };
    const ops = new PaymentOpsService(ds as unknown as DataSource, { applyResult: jest.fn() } as unknown as BillingService, provider);
    expect(await ops.pollPending(new Date())).toMatchObject({ checked: 1, errors: 1, confirmed: 0 });
    expect(JSON.parse(ds.query.mock.calls[1][1][1]).poll.last).toBe('non_interrogeable_sans_reference');
  });

  it('lets a programming error surface instead of reading it as a network failure (m7)', async () => {
    const p = payment({ id: 'd' });
    const ds = { query: jest.fn().mockResolvedValueOnce([[p], 1]).mockResolvedValue([[], 1]) };
    const provider = { name: 'x', initiate: jest.fn(), status: jest.fn().mockRejectedValue(new TypeError('x is not a function')) };
    const ops = new PaymentOpsService(ds as unknown as DataSource, { applyResult: jest.fn() } as unknown as BillingService, provider);
    // Counted as an error of this payment, the poll bookkeeping is not written as "network".
    expect(await ops.pollPending(new Date())).toMatchObject({ checked: 1, errors: 1 });
    expect(ds.query).toHaveBeenCalledTimes(1);
  });
});

describe('BillingService: currency from the country pack, never written in the code', () => {
  const pack = (country: string, currency?: string, level = 'pays') => ({ level, doc: { pack: `pays.${country}`, version: '1.0.0', level, country, ...(currency ? { currency } : {}), objects: [] } });
  function service(packs: unknown[], objects: Record<string, unknown>) {
    const params = {
      publishedPacks: jest.fn().mockResolvedValue(packs),
      resolveBase: jest.fn().mockResolvedValue({ objects }),
      plans: jest.fn().mockReturnValue([
        { code: 'gratuit', rank: 0, features: [], quotas: {} },
        { code: 'pro', rank: 1, features: ['x'], quotas: {} },
      ]),
      label: jest.fn((_r: unknown, code: string) => code),
    };
    const provider = { name: 'sim', initiate: jest.fn() };
    return new BillingService({} as DataSource, params as never, {} as never, {} as never, provider);
  }

  it('takes the currency of the country pack (XOF), for free plans too', async () => {
    const s = service([pack('SN', 'XOF'), pack('CM', 'XAF')], { 'plan_price:pro': { kind: 'plan_price', code: 'pro', monthly_minor: 300000, yearly_minor: 3000000 } });
    const r = await s.plans('SN');
    expect(r.currency).toBe('XOF');
    expect(r.plans.map((p) => p.prices.monthly.currency)).toEqual(['XOF', 'XOF']);
    expect(r.data[0].price).toEqual({ monthly: { amount_minor: 0, currency: 'XOF' }, yearly: { amount_minor: 0, currency: 'XOF' }, from: false });
  });

  it('keeps the currency written on a price, and uses it when the pack has none', async () => {
    const s = service([pack('GN'), pack('GN', 'bad')], { 'plan_price:pro': { kind: 'plan_price', code: 'pro', currency: 'GNF', monthly_minor: 1, yearly_minor: 2 } });
    expect((await s.plans('GN')).currency).toBe('GNF');
    expect(await s.countryCurrency('GN')).toBeNull();
  });

  it('answers PAY-CURRENCY instead of inventing a currency', async () => {
    const s = service([pack('CM', 'XAF'), pack('ZZ', 'XAF', 'global')], {});
    await expect(s.plans('ZZ')).rejects.toMatchObject({ code: 'BUSINESS_RULE', extra: { details: { rule: 'PAY-CURRENCY', country: 'ZZ' } } });
  });
});

describe('paymentEvents (Q-WEB-03)', () => {
  const raw = {
    events: [
      { at: '2026-11-13T08:00:00.000Z', status: 'confirme', source: 'webhook', ignored: true, reason: 'montant', body: { msisdn: '237690000001', name: 'Marthe', amount: 100 } },
      // A body cannot choose its source: only the one written by our code counts.
      { at: '2026-11-13T08:04:00.000Z', status: 'confirme', source: 'webhook', body: { source: 'operateur' } },
      { at: '2026-11-13T08:05:00.000Z', status: 'confirme', source: 'statut', body: { status: 'SUCCESS' } },
      { at: '2026-11-13T08:06:00.000Z', status: 'echoue', source: 'operateur', body: null },
      { at: '2026-11-13T08:07:00.000Z', status: 'confirme', body: { source: 'statut' } },
      { at: '2026-11-13T08:08:00.000Z', status: 'confirme', source: 'inventee', ignored: true, reason: 'autre' },
      { at: 12, status: 'confirme' },
      null,
      'texte',
    ],
  };

  it('payer view: date, status and source only, refused events left out, no raw body', () => {
    expect(paymentEvents(raw)).toEqual([
      { at: '2026-11-13T08:04:00.000Z', status: 'confirme', source: 'webhook' },
      { at: '2026-11-13T08:05:00.000Z', status: 'confirme', source: 'statut' },
      { at: '2026-11-13T08:06:00.000Z', status: 'echoue', source: 'operateur' },
      { at: '2026-11-13T08:07:00.000Z', status: 'confirme', source: 'webhook' },
    ]);
    expect(paymentEvents(null)).toEqual([]);
    expect(paymentEvents({ events: 'x' })).toEqual([]);
  });

  it('administration view: refused events with their reason (unknown reasons dropped)', () => {
    const admin = paymentEvents(raw, 'admin');
    expect(admin[0]).toEqual({ at: '2026-11-13T08:00:00.000Z', status: 'confirme', source: 'webhook', ignored: true, reason: 'montant' });
    expect(admin.at(-1)).toEqual({ at: '2026-11-13T08:08:00.000Z', status: 'confirme', source: 'webhook', ignored: true });
    expect(admin).toHaveLength(6);
  });
});

describe('BillingService.applyResult: journal written by our code (m4) and operator decisions (M2)', () => {
  function service(found: Partial<Payment>) {
    const p = payment({ status: 'en_attente', raw: { connector: 'agg' }, ...found });
    const q: Record<string, jest.Mock> = {};
    for (const k of ['setLock', 'where', 'andWhere']) q[k] = jest.fn(() => q);
    q.getOne = jest.fn().mockResolvedValue(p);
    const repo = { createQueryBuilder: jest.fn(() => q), save: jest.fn(async (x: Payment) => x) };
    const subs = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((x: object) => x), save: jest.fn(async (x: object) => ({ ...x, id: 'sub' })) };
    const m = { getRepository: (e: unknown) => (e === Payment ? repo : subs), query: jest.fn().mockResolvedValue([]) };
    const ds = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(m)) };
    const s = new BillingService(ds as unknown as DataSource, {} as never, {} as never, {} as never, { name: 'x', initiate: jest.fn() });
    return { s, p, q, m };
  }
  const events = (p: Payment) => (p.raw as { events: Array<Record<string, unknown>> }).events;

  it('refuses another amount or currency (journaled with the reason) and another connector (nothing written, counted)', async () => {
    let t = service({});
    expect((await t.s.applyResult({ payment_id: t.p.id, status: 'confirme' }, { source: 'webhook', connector: 'agg', amount_minor: 1 })).status).toBe('en_attente');
    expect(events(t.p)[0]).toMatchObject({ source: 'webhook', ignored: true, reason: 'montant' });
    t = service({});
    expect((await t.s.applyResult({ payment_id: t.p.id, status: 'confirme' }, { source: 'statut', connector: 'agg', currency: 'XOF' })).status).toBe('en_attente');
    expect(events(t.p)[0]).toMatchObject({ source: 'statut', ignored: true, reason: 'devise' });
    t = service({});
    await expect(t.s.applyResult({ payment_id: t.p.id, status: 'confirme' }, { source: 'webhook', connector: 'autre' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.s.applyResult({ payment_id: t.p.id, status: 'confirme' }, { source: 'webhook', connector: 'autre' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((t.p.raw as { events?: unknown }).events).toBeUndefined();
    expect(t.p.status).toBe('en_attente');
    expect(t.s.foreignEventCounts()).toEqual({ autre: 2 });
  });

  it('looks an aggregator reference up among the payments of the connector that sends it', async () => {
    const t = service({});
    await t.s.applyResult({ provider_ref: 'TX-9', status: 'confirme' }, { source: 'webhook', connector: 'agg' });
    expect(t.q.where).toHaveBeenCalledWith('p.provider_ref = :ref', { ref: 'TX-9' });
    expect(t.q.andWhere).toHaveBeenCalledWith(`p.raw->>'connector' = :connector`, { connector: 'agg' });
  });

  it('a confirmation after an operator "echoue" activates, flags needs_review and is audited', async () => {
    const t = service({ status: 'echoue', raw: { connector: 'agg', resolved: { outcome: 'echoue', at: '2026-11-13T08:00:00.000Z' } } });
    const r = await t.s.applyResult({ payment_id: t.p.id, status: 'confirme' }, { source: 'webhook', connector: 'agg' });
    expect(r.status).toBe('confirme');
    expect(t.p.raw).toMatchObject({ needs_review: true });
    expect(events(t.p).at(-1)).toMatchObject({ source: 'webhook', detail: 'late_confirm_after_resolve' });
    expect(t.m.query.mock.calls[0][1].slice(1, 4)).toEqual(['late_confirm_after_resolve', null, 'systeme']);
  });

  it('an operator decision needs the expected status, and runs its hook in the same transaction', async () => {
    let t = service({ status: 'en_attente' });
    const hook = jest.fn().mockResolvedValue(undefined);
    await expect(t.s.applyResult({ payment_id: t.p.id, status: 'echoue' }, { source: 'operateur', expect_status: 'a_verifier' }, hook)).rejects.toMatchObject({
      code: 'CONFLICT',
      extra: { details: { rule: 'PAY-RESOLVE-STATUS', status: 'en_attente' } },
    });
    expect(hook).not.toHaveBeenCalled();
    t = service({ status: 'a_verifier', raw: {} });
    const r = await t.s.applyResult({ payment_id: t.p.id, status: 'echoue' }, { source: 'operateur', expect_status: 'a_verifier' }, hook);
    expect(r).toMatchObject({ status: 'echoue', events: [{ status: 'echoue', source: 'operateur' }] });
    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe('BillingService.checkout: PAY-RETRY (m6)', () => {
  it('answers a clean 409 PAY-RETRY when the insert keeps being ignored without a readable open payment', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const k of ['insert', 'into', 'values', 'orIgnore', 'returning', 'where', 'andWhere', 'orderBy']) qb[k] = jest.fn(() => qb);
    qb.execute = jest.fn().mockResolvedValue({ raw: [] });
    qb.getOne = jest.fn().mockResolvedValue(null);
    const repo = { findOne: jest.fn().mockResolvedValue(null), createQueryBuilder: jest.fn(() => qb) };
    const m = { createQueryBuilder: () => qb, getRepository: () => repo, query: jest.fn().mockResolvedValue([]) };
    const ds = { getRepository: jest.fn(() => repo), transaction: jest.fn(async (fn: (x: unknown) => unknown) => fn(m)) };
    const params = {
      publishedPacks: jest.fn().mockResolvedValue([{ level: 'pays', doc: { level: 'pays', country: 'CM', currency: 'XAF' } }]),
      resolveBase: jest.fn().mockResolvedValue({
        objects: {
          'plan_price:pro': { kind: 'plan_price', code: 'pro', currency: 'XAF', monthly_minor: 2500, yearly_minor: 25000 },
          'payment_method:om': { kind: 'payment_method', code: 'orange_money', label: 'Orange Money' },
        },
      }),
      plans: jest.fn().mockReturnValue([{ code: 'pro', rank: 1, features: [], quotas: {} }]),
      label: jest.fn((_r: unknown, c: string) => c),
    };
    const provider = { name: 'x', initiate: jest.fn() };
    const s = new BillingService(ds as unknown as DataSource, params as never, {} as never, {} as never, provider);
    const user = { id: '0b7c6f2e-1d2a-4c3b-9e8f-7a6b5c4d3e2f', phone: '+237690000001', platform_roles: [] };
    await expect(
      s.checkout(user, { account_type: 'user', account_id: user.id, plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000001' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', extra: { details: { rule: 'PAY-RETRY' } } });
    expect(qb.execute).toHaveBeenCalledTimes(3);
    // Each try is decided under the payer's lock, with PAY-OPEN and PAY-RECENT checked again (m1).
    expect(m.query.mock.calls.filter((c) => /pg_advisory_xact_lock/.test(c[0]))).toHaveLength(3);
    expect(m.query.mock.calls.filter((c) => /status = 'confirme'/.test(c[0]))).toHaveLength(3);
    expect(provider.initiate).not.toHaveBeenCalled();
  });
});

describe('config PAYMENT_RECENT_GUARD_MIN (PAY-RECENT)', () => {
  const before = process.env.PAYMENT_RECENT_GUARD_MIN;
  afterEach(() => {
    if (before === undefined) delete process.env.PAYMENT_RECENT_GUARD_MIN;
    else process.env.PAYMENT_RECENT_GUARD_MIN = before;
  });

  it('defaults to 30 minutes, accepts 0 (off) to 1440, refuses anything else at start-up', () => {
    delete process.env.PAYMENT_RECENT_GUARD_MIN;
    expect(loadConfig().paymentRecentGuardMin).toBe(30);
    for (const ok of ['0', '45', '1440']) {
      process.env.PAYMENT_RECENT_GUARD_MIN = ok;
      expect(loadConfig().paymentRecentGuardMin).toBe(Number(ok));
    }
    for (const bad of ['-1', '1441', '2.5', 'trente']) {
      process.env.PAYMENT_RECENT_GUARD_MIN = bad;
      expect(() => loadConfig()).toThrow(/PAYMENT_RECENT_GUARD_MIN invalide/);
    }
  });
});
