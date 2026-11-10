/**
 * Declarative connectors (ADR-002) end to end: a fake aggregator (local HTTP server) is described
 * in PROVIDERS_CONFIG only — no provider code — and serves SMS, delivery reports, USSD and mobile money.
 * Runs against TEST_DATABASE_URL (schema reset + migrations + seed).
 */
import { mkdtempSync } from 'fs';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm_test';

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

/** Fake aggregator: records requests; answers from per-path queues, or a default. */
const received: Received[] = [];
const queued: Record<string, Array<{ status: number; body: unknown }>> = {};
let counter = 0;
const aggregator: Server = createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0];
    received.push({ path, headers: req.headers, body: data ? JSON.parse(data) : {} });
    const next = queued[path]?.shift();
    counter++;
    const fallback = path === '/v1/sms/messages' ? { data: { id: `MSG-${counter}`, cost: 20 } } : { transaction_id: `TX-${counter}` };
    res.writeHead(next?.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next?.body ?? fallback));
  });
});

function providers(port: number) {
  return {
    connectors: {
      fakeagg: {
        label: 'Agregateur de test',
        base_url: `http://127.0.0.1:${port}/v1`,
        auth: { type: 'bearer', token: '${env:FAKEAGG_TOKEN}' },
        phone_format: 'e164_no_plus',
        inbound_auth: { type: 'header', name: 'x-callback-token', value: '${env:FAKEAGG_CALLBACK}' },
        sms: {
          send: { url: '/sms/messages', body: { from: '{{sender}}', to: '{{to}}', message: '{{text}}' }, result: { ref: 'data.id', cost_minor: 'data.cost' } },
          cost: { per_segment_minor: 15, currency: 'XAF' },
          inbound: { from: 'msisdn', text: 'content' },
          dlr: { ref: 'id', status: 'state', status_map: { DELIVERED: 'delivre', FAILED: 'echoue' }, error: 'reason' },
        },
        ussd: { inbound: { session_id: 'sessionId', phone: 'phoneNumber', text: 'text' }, response: { type: 'text' } },
        payment: {
          initiate: {
            url: '/payments/collect',
            body: { amount: '{{amount_minor}}', currency: '{{currency}}', msisdn: '{{phone}}', reference: '{{reference}}', notify_url: '{{callback_url}}' },
            result: { ref: 'transaction_id' },
          },
          webhook: {
            payment_id: 'reference',
            ref: 'transaction_id',
            status: 'status',
            status_map: { SUCCESS: 'confirme', FAILED: 'echoue', PENDING: 'en_attente' },
            fees_minor: 'fees',
            ack: { ok: true },
          },
        },
      },
    },
    routing: { sms: 'fakeagg', ussd: 'fakeagg', payment: { orange_money: 'fakeagg' } },
  };
}

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let db: Client;
const CB = { 'x-callback-token': 'cb-secret' };

const sessions = new Map<string, { token: string; id: string }>();

/** Logs in once per phone (OTP requests are limited per number). */
async function login(phone: string): Promise<{ token: string; id: string }> {
  const cached = sessions.get(phone);
  if (cached) return cached;
  // OTP SMS also goes through the connector: read the code from the fake aggregator.
  await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
  const otpSms = [...received].reverse().find((r) => r.path === '/v1/sms/messages' && r.body.to === phone.slice(1));
  const code = /(\d{6})/.exec(String(otpSms?.body.message))?.[1];
  expect(code).toBeDefined();
  const r = await http.post('/v1/auth/otp/verify').send({ phone, code }).expect(200);
  const session = { token: r.body.access_token as string, id: r.body.user.id as string };
  sessions.set(phone, session);
  return session;
}

beforeAll(async () => {
  await new Promise<void>((ok) => aggregator.listen(0, '127.0.0.1', ok));
  const port = (aggregator.address() as AddressInfo).port;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    TZ: 'Africa/Douala',
    DATABASE_URL: TEST_DB,
    OTP_DEV_ECHO: 'false',
    SCHEDULER_ENABLED: 'false',
    THROTTLE_LIMIT: '100000',
    PAYMENT_WEBHOOK_SECRET: 'e2e-webhook-secret',
    KEYS_DIR: mkdtempSync(join(tmpdir(), 'rf-keys-')),
    EXPORTS_DIR: mkdtempSync(join(tmpdir(), 'rf-exports-')),
    SMS_PROVIDER: 'connector',
    PAYMENT_PROVIDER: 'connector',
    PUBLIC_API_URL: 'https://farm.example',
    FAKEAGG_TOKEN: 'agg-token',
    FAKEAGG_CALLBACK: 'cb-secret',
    PROVIDERS_CONFIG: JSON.stringify(providers(port)),
  });
  delete process.env.REDIS_URL;
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { reloadConfig } = require('../src/config');
  const { runMigrations } = require('../src/database/data-source');
  const { createApp } = require('../src/bootstrap');
  const { runSeed } = require('../src/seed/seed');
  /* eslint-enable @typescript-eslint/no-var-requires */
  reloadConfig();
  db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(TEST_DB);
  app = await createApp({ databaseUrl: TEST_DB, logger: false });
  await app.init();
  await runSeed(app);
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  await new Promise((ok) => aggregator.close(ok));
});

describe('declarative connectors', () => {
  it('sends OTP SMS through the described aggregator with its auth and body format', async () => {
    await http.post('/v1/auth/otp/request').send({ phone: '+237690000005' }).expect(200);
    const sms = received.find((r) => r.path === '/v1/sms/messages');
    expect(sms?.headers.authorization).toBe('Bearer agg-token');
    expect(sms?.body).toMatchObject({ from: 'RecallFarm', to: '237690000005' });
    const rows = await db.query(`SELECT provider_ref, cost_minor::int AS cost, currency, body FROM outbound_messages WHERE template_code = 'otp_sms' ORDER BY queued_at DESC LIMIT 1`);
    expect(rows.rows[0]).toMatchObject({ provider_ref: expect.stringMatching(/^MSG-/), cost: 20, currency: 'XAF', body: null });
  });

  it('rejects inbound calls without the connector secret, and unknown connectors', async () => {
    await http.post('/v1/connectors/fakeagg/sms').send({ msisdn: '237690000001', content: 'OK 1234' }).expect(401);
    await http.post('/v1/connectors/fakeagg/sms').set({ 'x-callback-token': 'wrong' }).send({}).expect(401);
    await http.post('/v1/connectors/inconnu/sms').set(CB).send({}).expect(404);
  });

  it('maps an inbound SMS (form-encoded) and replies through the aggregator', async () => {
    const before = received.length;
    const r = await http.post('/v1/connectors/fakeagg/sms').set(CB).type('form').send({ msisdn: '237690000001', content: 'bonjour' }).expect(200);
    expect(r.body).toMatchObject({ handled: false, reply: expect.stringMatching(/non compris/) });
    const reply = received.slice(before).find((x) => x.path === '/v1/sms/messages');
    expect(reply?.body).toMatchObject({ to: '237690000001', message: expect.stringMatching(/non compris/) });
    await http.post('/v1/connectors/fakeagg/sms').set(CB).send({ content: 'x' }).expect(422);
  });

  it('applies delivery reports to the outbound journal', async () => {
    const last = await db.query(`SELECT provider_ref FROM outbound_messages WHERE template_code = 'reponse_sms' ORDER BY queued_at DESC LIMIT 1`);
    const ref = last.rows[0].provider_ref as string;
    const ok = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: ref, state: 'DELIVERED' }).expect(200);
    expect(ok.body).toEqual({ received: true, applied: true });
    const row = await db.query(`SELECT status, delivered_at FROM outbound_messages WHERE provider_ref = $1`, [ref]);
    expect(row.rows[0].status).toBe('delivre');
    expect(row.rows[0].delivered_at).not.toBeNull();
    const unknown = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: ref, state: 'WHATEVER' }).expect(200);
    expect(unknown.body.applied).toBe(false);
    const again = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: ref, state: 'FAILED' }).expect(200);
    expect(again.body.applied).toBe(false);
  });

  it('serves the pack USSD menu in the aggregator format (text/plain CON/END)', async () => {
    const menu = await http.post('/v1/connectors/fakeagg/ussd').set(CB).send({ sessionId: 's1', phoneNumber: '237690000001', text: '' }).expect(200);
    expect(menu.headers['content-type']).toMatch(/text\/plain/);
    expect(menu.text).toMatch(/^CON RecallFarm\n1\. /);
    const today = await http.post('/v1/connectors/fakeagg/ussd').set(CB).send({ sessionId: 's1', phoneNumber: '237690000001', text: '1' }).expect(200);
    expect(today.text).toMatch(/^END /);
    const stranger = await http.post('/v1/connectors/fakeagg/ussd').set(CB).send({ sessionId: 's2', phoneNumber: '237699999999', text: '' }).expect(200);
    expect(stranger.text).toBe('END Numéro inconnu de RecallFarm.');
  });

  it('runs a mobile-money payment end to end: initiate, pending, success, replay', async () => {
    const marthe = await login('+237690000001');
    const auth = { authorization: `Bearer ${marthe.token}` };
    const co = await http
      .post('/v1/subscriptions/checkout')
      .set(auth)
      .send({ account_type: 'user', account_id: marthe.id, plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000001' })
      .expect(201);
    expect(co.body).toMatchObject({ status: 'initie', ussd_push: true, provider_ref: expect.stringMatching(/^TX-/) });
    const call = [...received].reverse().find((r) => r.path === '/v1/payments/collect');
    expect(call?.body).toEqual({
      amount: 2500,
      currency: 'XAF',
      msisdn: '237690000001',
      reference: co.body.payment_id,
      notify_url: 'https://farm.example/v1/connectors/fakeagg/payment',
    });

    await http.post('/v1/connectors/fakeagg/payment').send({ reference: co.body.payment_id, status: 'SUCCESS' }).expect(401);
    const pending = await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'PENDING' }).expect(200);
    expect(pending.body).toEqual({ ok: true });
    expect((await http.get(`/v1/payments/${co.body.payment_id}`).set(auth).expect(200)).body.status).toBe('en_attente');

    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ transaction_id: co.body.provider_ref, status: 'SUCCESS', fees: 50 }).expect(200);
    const paid = await http.get(`/v1/payments/${co.body.payment_id}`).set(auth).expect(200);
    expect(paid.body.status).toBe('confirme');
    const fees = await db.query(`SELECT fees_minor::int AS f FROM payments WHERE id = $1`, [co.body.payment_id]);
    expect(fees.rows[0].f).toBe(50);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'FAILED' }).expect(200);
    expect((await http.get(`/v1/payments/${co.body.payment_id}`).set(auth).expect(200)).body.status).toBe('confirme');
    const me = await http.get('/v1/me').set(auth).expect(200);
    expect(me.body.entitlements.plan).toBe('pro');
  });

  it('marks the payment failed and answers 422 when the aggregator refuses', async () => {
    const marthe = await login('+237690000001');
    queued['/v1/payments/collect'] = [{ status: 500, body: { error: 'down' } }];
    const r = await http
      .post('/v1/subscriptions/checkout')
      .set({ authorization: `Bearer ${marthe.token}` })
      .send({ account_type: 'user', account_id: marthe.id, plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000001' })
      .expect(422);
    expect(r.body.error.details).toMatchObject({ rule: 'PAY-INIT', error_code: 'http_500' });
    const p = await db.query(`SELECT status FROM payments WHERE id = $1`, [r.body.error.details.payment_id]);
    expect(p.rows[0].status).toBe('echoue');
  });

  it('lists connectors without secrets and sends a test SMS (platform roles only)', async () => {
    const admin = await login('+237690000009');
    const list = await http.get('/v1/admin/connectors').set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(list.body.data).toEqual([{ name: 'fakeagg', label: 'Agregateur de test', channels: ['sms', 'ussd', 'payment'], routed_for: ['sms', 'ussd', 'payment:orange_money'] }]);
    expect(JSON.stringify(list.body)).not.toMatch(/agg-token|cb-secret|127\.0\.0\.1/);
    const t = await http.post('/v1/admin/connectors/fakeagg/test-sms').set({ authorization: `Bearer ${admin.token}` }).send({ phone: '+237690000002' }).expect(200);
    expect(t.body).toMatchObject({ connector: 'fakeagg', channel: 'sms', status: 'envoye', provider_ref: expect.stringMatching(/^MSG-/) });
    const farmer = await login('+237690000001');
    await http.get('/v1/admin/connectors').set({ authorization: `Bearer ${farmer.token}` }).expect(403);
    await http.post('/v1/admin/connectors/fakeagg/test-sms').set({ authorization: `Bearer ${farmer.token}` }).send({ phone: '+237690000002' }).expect(403);
  });
});
