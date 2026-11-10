import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConnectorRegistry } from '../connectors/connector-registry';
import { FetchFn } from '../connectors/connector-http';
import { ProvidersConfig } from '../connectors/connector.types';
import { logSafe } from '../connectors/connectors.controller';
import { Payment } from '../database/entities';
import { DataSource } from 'typeorm';
import { BillingService, idFromKey } from './billing.service';
import { nextPollDelayMin, PaymentOpsService } from './payment-ops.service';
import { ConnectorPaymentProvider, PaymentProviderError, SimulatorPaymentProvider } from './payment.providers';

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
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.agregateur.example/v1/payments/TX-9' });
    expect(await p.status(payment())).toMatchObject({ status: 'inconnu', raw_status: 'BIZARRE' });
    await expect(p.status(payment())).rejects.toMatchObject({ code: 'http_502', definitive: false });
    // A connector without status query answers null.
    expect(await p.status(payment({ raw: { connector: 'operateur_oauth_exemple' }, method: 'mtn_momo' }))).toBeNull();
    await expect(p.status(payment({ raw: {}, method: 'cash' }))).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('refunds with a stable key and maps the outcome', async () => {
    const { p, calls } = provider([{ body: { refund_id: 'RF-1', state: 'DONE' } }, { body: { state: 'QUEUED' } }, { body: { state: 'REJECTED' } }, { status: 409 }, { status: 503 }]);
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'rembourse', refund_ref: 'RF-1' });
    expect(JSON.parse(calls[0].body!)).toMatchObject({ idempotency_key: 'key-1', transaction_id: 'TX-9', amount: 2500, reason: 'doublon' });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'en_attente' });
    expect(await p.refund(payment(), 'key-1', 'doublon')).toEqual({ status: 'echoue' });
    await expect(p.refund(payment(), 'key-1', 'doublon')).rejects.toMatchObject({ code: 'http_409', definitive: true });
    await expect(p.refund(payment(), 'key-1', 'doublon')).rejects.toMatchObject({ code: 'http_503', definitive: false });
    await expect(p.refund(payment({ raw: { connector: 'operateur_oauth_exemple' } }), 'k', 'r')).rejects.toMatchObject({ code: 'not_supported', definitive: true });
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
    const ds = { getRepository: () => ({ query: async () => [a, b] }), query: jest.fn().mockResolvedValue([[], 1]) };
    const billing = { applyResult: jest.fn().mockRejectedValueOnce(new Error('Paiement introuvable')).mockResolvedValueOnce({ status: 'confirme' }) };
    const provider = { name: 'x', initiate: jest.fn(), status: jest.fn().mockResolvedValue({ status: 'confirme', raw_status: 'SUCCESS' }) };
    const ops = new PaymentOpsService(ds as unknown as DataSource, billing as unknown as BillingService, provider);
    expect(await ops.pollPending(new Date())).toEqual({ checked: 2, confirmed: 1, failed: 0, still_pending: 0, flagged: 0, errors: 1 });
  });
});
