/**
 * Declarative connectors (ADR-002) end to end: a fake aggregator (local HTTP server) is described
 * in PROVIDERS_CONFIG only — no provider code — and serves SMS, delivery reports, USSD and mobile money.
 * Runs against TEST_DATABASE_URL (schema reset + migrations + seed).
 */
import { createHmac } from 'crypto';
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
  method?: string;
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
    received.push({ method: req.method, path, headers: req.headers, body: data ? JSON.parse(data) : {} });
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
          send: {
            url: '/sms/messages',
            body: { from: '{{sender}}', to: '{{to}}', message: '{{text}}', client_ref: '{{message_id}}' },
            result: { ref: 'data.id', cost_minor: 'data.cost' },
          },
          cost: { per_segment_minor: 15, currency: 'XAF' },
          inbound: { from: 'msisdn', text: 'content' },
          dlr: { ref: 'id', status: 'state', status_map: { DELIVERED: 'delivre', FAILED: 'echoue', SENT: 'envoye' }, error: 'reason' },
        },
        whatsapp: {
          send: { url: '/wa/messages', body: { to: '{{to}}', text: '{{text}}' }, result: { ref: 'transaction_id' } },
          dlr: { ref: 'wamid', status: 'event', status_map: { read: 'delivre' } },
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
            amount_minor: 'amount',
            ack: { ok: true },
          },
          status: {
            method: 'GET',
            // By our reference: works for a payment whose initiation timed out (no provider_ref, M1).
            url: '/payments/by-reference/{{reference}}',
            result: { status: 'state', status_map: { SUCCESS: 'confirme', FAILED: 'echoue', PENDING: 'en_attente' }, amount_minor: 'amount' },
          },
          refund: {
            url: '/refunds',
            body: { key: '{{refund_id}}', transaction: '{{provider_ref}}', amount: '{{amount_minor}}', reason: '{{reason}}' },
            result: { ref: 'refund_id', status: 'state', status_map: { DONE: 'rembourse', REFUSED: 'echoue', QUEUED: 'en_attente' }, http_map: { '409': 'rembourse' } },
          },
          refund_status: { method: 'GET', url: '/refunds/{{refund_id}}', result: { status: 'state', status_map: { DONE: 'rembourse', REFUSED: 'echoue', QUEUED: 'en_attente' } } },
          list: {
            method: 'GET',
            url: '/payments?date={{date}}',
            result: { items: 'items', payment_id: 'reference', ref: 'transaction_id', status: 'status', status_map: { SUCCESS: 'confirme', FAILED: 'echoue' }, amount_minor: 'amount' },
          },
        },
      },
      // Second aggregator with its own secret: it must not be able to confirm fakeagg's payments.
      otheragg: {
        base_url: `http://127.0.0.1:${port}/v1`,
        inbound_auth: { type: 'header', name: 'x-callback-token', value: 'other-secret' },
        sms: { send: { url: '/sms/messages', body: { to: '{{to}}' } }, dlr: { ref: 'id', status: 'state', status_map: { DELIVERED: 'delivre' } } },
        payment: {
          initiate: { url: '/payments/collect', body: { reference: '{{reference}}' }, result: { ref: 'transaction_id' } },
          webhook: { payment_id: 'reference', status: 'status', status_map: { SUCCESS: 'confirme' } },
        },
      },
      // USSD aggregator that sends only the last input, wants JSON actions, small screens and signs every call.
      lastagg: {
        inbound_auth: { type: 'hmac_sha256', header: 'x-sig', secret: '${env:LASTAGG_SECRET}', timestamp_header: 'x-ts', tolerance_s: 60, signed_payload: '{{timestamp}}.{{body}}' },
        ussd: {
          inbound: { session_id: 'sid', phone: 'msisdn', text: 'input', text_mode: 'last' },
          max_chars: 60,
          response: {
            type: 'json',
            body: { action: '{{continue}}', text: '{{message}}', sid: '{{session_id}}' },
            continue_values: { continue: 'request', end: 'end' },
            headers: { 'x-ussd-action': '{{continue}}' },
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
    LASTAGG_SECRET: 'last-secret',
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
    const before = received.length;
    await http.post('/v1/auth/otp/request').send({ phone: '+237690000005' }).expect(200);
    // The SMS of this request, not the first one ever received (order-independent).
    const sms = received.slice(before).find((r) => r.path === '/v1/sms/messages' && r.body.to === '237690000005');
    expect(sms?.headers.authorization).toBe('Bearer agg-token');
    expect(sms?.body).toMatchObject({ from: 'RecallFarm', to: '237690000005' });
    const rows = await db.query(`SELECT provider_ref, cost_minor::int AS cost, currency, body FROM outbound_messages WHERE template_code = 'otp_sms' ORDER BY queued_at DESC LIMIT 1`);
    expect(rows.rows[0]).toMatchObject({ provider_ref: expect.stringMatching(/^MSG-/), cost: 20, currency: 'XAF', body: null });
  });

  it('rejects inbound calls without the connector secret, and unknown connectors', async () => {
    await http.post('/v1/connectors/fakeagg/sms').send({ msisdn: '237690000001', content: 'OK 1234' }).expect(401);
    await http.post('/v1/connectors/fakeagg/sms').set({ 'x-callback-token': 'wrong' }).send({}).expect(401);
    // Same answer as a wrong secret: connector names cannot be enumerated (m9).
    await http.post('/v1/connectors/inconnu/sms').set(CB).send({}).expect(401);
  });

  it('maps an inbound SMS (form-encoded) and replies through the aggregator', async () => {
    const before = received.length;
    const r = await http.post('/v1/connectors/fakeagg/sms').set(CB).type('form').send({ msisdn: '237690000001', content: 'bonjour' }).expect(200);
    expect(r.body).toMatchObject({ handled: false, reply: expect.stringMatching(/non compris/) });
    const reply = received.slice(before).find((x) => x.path === '/v1/sms/messages');
    expect(reply?.body).toMatchObject({ to: '237690000001', message: expect.stringMatching(/non compris/) });
    await http.post('/v1/connectors/fakeagg/sms').set(CB).send({ content: 'x' }).expect(422);
    await http.post('/v1/connectors/fakeagg/sms').set(CB).send({ msisdn: 'abc', content: 'x' }).expect(422);
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
    const proto = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: ref, state: 'constructor' }).expect(200);
    expect(proto.body.applied).toBe(false);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: ref, status: 'constructor' }).expect(200);
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

    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ transaction_id: co.body.provider_ref, status: 'SUCCESS', fees: 50, amount: 2500 }).expect(200);
    const paid = await http.get(`/v1/payments/${co.body.payment_id}`).set(auth).expect(200);
    expect(paid.body.status).toBe('confirme');
    const fees = await db.query(`SELECT fees_minor::int AS f FROM payments WHERE id = $1`, [co.body.payment_id]);
    expect(fees.rows[0].f).toBe(50);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'FAILED' }).expect(200);
    expect((await http.get(`/v1/payments/${co.body.payment_id}`).set(auth).expect(200)).body.status).toBe('confirme');
    const me = await http.get('/v1/me').set(auth).expect(200);
    expect(me.body.entitlements.plan).toBe('pro');
  });

  const checkout = (token: string, id: string) =>
    http
      .post('/v1/subscriptions/checkout')
      .set({ authorization: `Bearer ${token}` })
      .send({ account_type: 'user', account_id: id, plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000001' });
  const status = async (token: string, id: string) => (await http.get(`/v1/payments/${id}`).set({ authorization: `Bearer ${token}` }).expect(200)).body.status;

  it('explicit refusal (4xx) fails the payment; a late confirmation still activates it', async () => {
    const m = await login('+237690000001');
    queued['/v1/payments/collect'] = [{ status: 400, body: { error: 'solde insuffisant' } }];
    const r = await checkout(m.token, m.id).expect(422);
    expect(r.body.error.details).toMatchObject({ rule: 'PAY-INIT', error_code: 'http_400' });
    const id = r.body.error.details.payment_id;
    expect(await status(m.token, id)).toBe('echoue');
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'SUCCESS', amount: 2500 }).expect(200);
    expect(await status(m.token, id)).toBe('confirme');
  });

  it('unknown outcome (5xx) keeps the payment pending, and the webhook confirms it', async () => {
    const m = await login('+237690000001');
    queued['/v1/payments/collect'] = [{ status: 503, body: { error: 'down' } }];
    const r = await checkout(m.token, m.id).expect(422);
    expect(r.body.error.details).toMatchObject({ rule: 'PAY-PENDING', status: 'en_attente', error_code: 'http_503' });
    const id = r.body.error.details.payment_id;
    expect(await status(m.token, id)).toBe('en_attente');
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'SUCCESS', amount: 2500 }).expect(200);
    expect(await status(m.token, id)).toBe('confirme');
  });

  it('refuses a confirmation with another amount, or from another connector, and keeps the webhook for audit', async () => {
    const m = await login('+237690000001');
    const co = await checkout(m.token, m.id).expect(201);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'SUCCESS', amount: 100 }).expect(200);
    expect(await status(m.token, co.body.payment_id)).toBe('en_attente');
    await http
      .post('/v1/connectors/otheragg/payment')
      .set({ 'x-callback-token': 'other-secret' })
      .send({ reference: co.body.payment_id, status: 'SUCCESS' })
      .expect(404);
    expect(await status(m.token, co.body.payment_id)).toBe('en_attente');
    const raw = await db.query(`SELECT raw FROM payments WHERE id = $1`, [co.body.payment_id]);
    expect(raw.rows[0].raw.connector).toBe('fakeagg');
    expect(raw.rows[0].raw.events).toEqual([expect.objectContaining({ status: 'confirme', body: expect.objectContaining({ amount: 100 }) })]);
  });

  it('two simultaneous confirmations extend the subscription only once', async () => {
    const m = await login('+237690000001');
    const before = await db.query(`SELECT expires_at FROM subscriptions WHERE account_type = 'user' AND account_id = $1`, [m.id]);
    const co = await checkout(m.token, m.id).expect(201);
    const hook = () => http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'SUCCESS', amount: 2500 });
    const results = await Promise.all([hook(), hook(), hook()]);
    results.forEach((r) => expect(r.status).toBe(200));
    const after = await db.query(`SELECT expires_at FROM subscriptions WHERE account_type = 'user' AND account_id = $1`, [m.id]);
    const expected = new Date(before.rows[0].expires_at);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(new Date(after.rows[0].expires_at).toISOString()).toBe(expected.toISOString());
  });

  it('lists connectors without secrets and sends a test SMS (platform roles only)', async () => {
    const admin = await login('+237690000009');
    const list = await http.get('/v1/admin/connectors').set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(list.body.data).toEqual([
      { name: 'fakeagg', label: 'Agregateur de test', channels: ['sms', 'whatsapp', 'ussd', 'payment'], routed_for: ['sms', 'ussd', 'payment:orange_money'] },
      { name: 'otheragg', label: 'otheragg', channels: ['sms', 'payment'], routed_for: [] },
      { name: 'lastagg', label: 'lastagg', channels: ['ussd'], routed_for: [] },
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/agg-token|cb-secret|other-secret|last-secret|127\.0\.0\.1/);
    const t = await http.post('/v1/admin/connectors/fakeagg/test-sms').set({ authorization: `Bearer ${admin.token}` }).send({ phone: '+237690000002' }).expect(200);
    expect(t.body).toMatchObject({ connector: 'fakeagg', channel: 'sms', status: 'envoye', provider_ref: expect.stringMatching(/^MSG-/), cost_minor: 20, currency: 'XAF' });
    const farmer = await login('+237690000001');
    await http.get('/v1/admin/connectors').set({ authorization: `Bearer ${farmer.token}` }).expect(403);
    await http.post('/v1/admin/connectors/fakeagg/test-sms').set({ authorization: `Bearer ${farmer.token}` }).send({ phone: '+237690000002' }).expect(403);
  });

  /* ---------- P1.1: USSD sessions (M5), delivery reports (m5, m6, m15) ---------- */

  const marthePhone = '237690000001';
  const ussd = (text: string, sessionId: string) => http.post('/v1/connectors/fakeagg/ussd').set(CB).send({ sessionId, phoneNumber: marthePhone, text });

  /** Signed call to lastagg: HMAC-SHA256 of "<timestamp>.<raw body>". */
  function signed(body: Record<string, unknown>, at = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify(body);
    const ts = String(at);
    const sig = createHmac('sha256', 'last-secret').update(`${ts}.${raw}`).digest('hex');
    return { raw, headers: { 'content-type': 'application/json', 'x-ts': ts, 'x-sig': sig } };
  }
  const lastHop = (sid: string, input: string) => {
    const r = signed({ sid, msisdn: marthePhone, input });
    return http.post('/v1/connectors/lastagg/ussd').set(r.headers).send(r.raw);
  };
  const mortality = async (batch: string) =>
    (
      await db.query(
        `SELECT COALESCE(SUM(d.mortality),0)::int AS n FROM daily_logs d JOIN batches b ON b.id = d.subject_id WHERE b.name = $1 AND d.log_date = (now() AT TIME ZONE 'Africa/Douala')::date`,
        [batch],
      )
    ).rows[0].n as number;

  it('USSD "last input" mode: the session is kept on the server, so a code is not read as a menu choice', async () => {
    const code = (
      await db.query(
        `SELECT r.short_code FROM reminders r JOIN farms f ON f.id = r.farm_id JOIN users u ON u.id = f.owner_id
          WHERE u.phone = '+237690000001' AND r.status IN ('a_venir','envoye') AND r.deleted_at IS NULL AND r.short_code IS NOT NULL LIMIT 1`,
      )
    ).rows[0].short_code as string;
    // Page 1 of the menu: 60 characters at most, "0. Suite", JSON action "request" and the header.
    const p1 = await lastHop('L1', '*123*7#').expect(200);
    expect(p1.headers['content-type']).toMatch(/application\/json/);
    expect(p1.headers['x-ussd-action']).toBe('request');
    expect(p1.body).toMatchObject({ action: 'request', sid: 'L1', text: expect.stringMatching(/^RecallFarm\n1\. [\s\S]*\n0\. Suite$/) });
    expect(p1.body.text.length).toBeLessThanOrEqual(60);
    const p2 = await lastHop('L1', '0').expect(200);
    expect(p2.body.action).toBe('request');
    expect(p2.body.text.length).toBeLessThanOrEqual(60);
    const ask = await lastHop('L1', '2').expect(200);
    expect(ask.body).toMatchObject({ action: 'request', text: 'Entrez le code du rappel :' });
    const done = await lastHop('L1', code).expect(200);
    expect(done.headers['x-ussd-action']).toBe('end');
    expect(done.body).toMatchObject({ action: 'end', text: expect.stringMatching(/^Merci, rappel .* confirmé\.$/) });
    expect((await db.query(`SELECT count(*)::int AS n FROM ussd_sessions WHERE id LIKE 'ussd:lastagg:L1:%'`)).rows[0].n).toBe(1);
  });

  it('USSD signatures: HMAC with signing time on the real route; a replay gets the same screen without a new step; stale calls refused (m8, M2)', async () => {
    const r = signed({ sid: 'L2', msisdn: marthePhone, input: '' });
    const first = await http.post('/v1/connectors/lastagg/ussd').set(r.headers).send(r.raw).expect(200);
    // Exactly the same signed call again (aggregator retry): 200, same screen, the session does not move.
    const again = await http.post('/v1/connectors/lastagg/ussd').set(r.headers).send(r.raw).expect(200);
    expect(again.body).toEqual(first.body);
    const next = signed({ sid: 'L2', msisdn: marthePhone, input: '0' });
    const page2 = await http.post('/v1/connectors/lastagg/ussd').set(next.headers).send(next.raw).expect(200);
    expect(page2.body.text).not.toBe(first.body.text);
    const old = signed({ sid: 'L2', msisdn: marthePhone, input: '1' }, Math.floor(Date.now() / 1000) - 120);
    await http.post('/v1/connectors/lastagg/ussd').set(old.headers).send(old.raw).expect(401);
    const forged = signed({ sid: 'L2', msisdn: marthePhone, input: '1' });
    await http.post('/v1/connectors/lastagg/ussd').set({ ...forged.headers, 'x-sig': '0'.repeat(64) }).send(forged.raw).expect(401);
  });

  it('USSD after the closing screen, and concurrent identical hops, never record twice (B1, both modes)', async () => {
    // "last" mode: two signatures (different signing times), so only the session lock and the
    // closed-session rule protect the action, not the replay cache.
    const hopAt = (sid: string, input: string, at: number) => {
      const r = signed({ sid, msisdn: marthePhone, input }, at);
      return http.post('/v1/connectors/lastagg/ussd').set(r.headers).send(r.raw);
    };
    const now = Math.floor(Date.now() / 1000);
    const before = await mortality('B02');
    for (const [i, input] of ['', '3', '2'].entries()) await hopAt('B1L', input, now - 10 + i).expect(200);
    const [a, b] = await Promise.all([hopAt('B1L', '3', now - 2), hopAt('B1L', '3', now - 1)]);
    expect(a.body.action).toBe('end');
    expect(b.body).toEqual(a.body);
    expect(await mortality('B02')).toBe(before + 3);
    // The aggregator sends the same input again after the end: closing screen, mortality unchanged.
    const late = await hopAt('B1L', '3', now);
    expect(late.body).toEqual(a.body);
    expect(await mortality('B02')).toBe(before + 3);
    // "cumulative" mode: two identical final hops at the same time.
    for (const t of ['', '3', '3*2']) await ussd(t, 'B1C').expect(200);
    const [c, d] = await Promise.all([ussd('3*2*2', 'B1C'), ussd('3*2*2', 'B1C')]);
    expect(c.text).toMatch(/^END 2 mort\(s\)/);
    expect(d.text).toBe(c.text);
    expect((await ussd('3*2*2*1', 'B1C').expect(200)).text).toBe(c.text);
    expect(await mortality('B02')).toBe(before + 5);
  });

  it('USSD "cumulative" mode: an identical retry replays the closing screen without recording twice; every path asks <= 3 screens', async () => {
    // B02 is a broiler batch: a laying batch also needs the eggs of the day (see docs/plan/questions.md).
    const before = await mortality('B02');
    const screens: string[] = [];
    for (const text of ['', '3', '3*2', '3*2*4']) screens.push((await ussd(text, 'C1').expect(200)).text);
    expect(screens.map((t) => t.slice(0, 4))).toEqual(['CON ', 'CON ', 'CON ', 'END ']);
    // 4 deaths out of 200 broilers crosses the pack mortality threshold: the alert is part of the message.
    expect(screens[3]).toBe('END 4 mort(s) enregistré(s) pour B02. Alerte transmise.');
    const retry = await ussd('3*2*4', 'C1').expect(200);
    expect(retry.text).toBe(screens[3]);
    expect(await mortality('B02')).toBe(before + 4);
    // Other paths: reminders of the day (1 screen), confirmation (2 screens).
    expect((await ussd('1', 'C2').expect(200)).text).toMatch(/^END /);
    expect((await ussd('2', 'C3').expect(200)).text).toBe('CON Entrez le code du rappel :');
    expect((await ussd('2*ZZZZ', 'C3').expect(200)).text).toBe('END Code introuvable ou déjà confirmé.');
    for (const t of screens) expect(t.length - 4).toBeLessThanOrEqual(160);
    // Invalid inputs close the session politely.
    expect((await ussd('3*9', 'C4').expect(200)).text).toBe('END Choix invalide.');
    expect((await ussd('3*1*-2', 'C5').expect(200)).text).toBe('END Nombre invalide.');
    expect((await ussd('7', 'C6').expect(200)).text).toBe('END Choix invalide.');
  });

  it('the generic /v1/inbound/ussd keeps its {response} format through the same sessions', async () => {
    const r = await http.post('/v1/inbound/ussd').send({ session_id: 'G1', phone: '+237690000001', text: '' }).expect(200);
    expect(r.body.response).toMatch(/^CON RecallFarm\n1\. /);
  });

  it('delivery reports: our message id is the idempotency key, GET is accepted, statuses never go back, providers and channels are separate', async () => {
    const admin = await login('+237690000009');
    const before = received.length;
    const t = await http.post('/v1/admin/connectors/fakeagg/test-sms').set({ authorization: `Bearer ${admin.token}` }).send({ phone: '+237690000002' }).expect(200);
    const sent = received.slice(before).find((r) => r.path === '/v1/sms/messages');
    expect(sent?.body.client_ref).toBe(t.body.message_id);
    // GET with query parameters, quoting our own id (m6, m15).
    const failed = await http.get(`/v1/connectors/fakeagg/dlr?id=${t.body.message_id}&state=FAILED&reason=absent`).set(CB).expect(200);
    expect(failed.body).toEqual({ received: true, applied: true });
    // A late "sent" does not bring the message back from "failed" (m5).
    const late = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: t.body.provider_ref, state: 'SENT' }).expect(200);
    expect(late.body.applied).toBe(false);
    const row = await db.query(`SELECT status, error_code, provider FROM outbound_messages WHERE id = $1`, [t.body.message_id]);
    expect(row.rows[0]).toEqual({ status: 'echoue', error_code: 'absent', provider: 'fakeagg' });
    // Another connector cannot touch fakeagg's messages.
    const other = await http.post('/v1/connectors/otheragg/dlr').set({ 'x-callback-token': 'other-secret' }).send({ id: t.body.provider_ref, state: 'DELIVERED' }).expect(200);
    expect(other.body.applied).toBe(false);
    // WhatsApp reports use the WhatsApp format and only touch WhatsApp messages.
    const wa = await http.post('/v1/admin/connectors/fakeagg/test-sms?channel=whatsapp').set({ authorization: `Bearer ${admin.token}` }).send({ phone: '+237690000002' }).expect(200);
    expect(wa.body).toMatchObject({ channel: 'whatsapp', status: 'envoye', provider_ref: expect.stringMatching(/^TX-/) });
    const asSms = await http.post('/v1/connectors/fakeagg/dlr').set(CB).send({ id: wa.body.provider_ref, state: 'DELIVERED' }).expect(200);
    expect(asSms.body.applied).toBe(false);
    const read = await http.post('/v1/connectors/fakeagg/dlr?channel=whatsapp').set(CB).send({ wamid: wa.body.provider_ref, event: 'read' }).expect(200);
    expect(read.body.applied).toBe(true);
    await http.post('/v1/connectors/otheragg/dlr?channel=whatsapp').set({ 'x-callback-token': 'other-secret' }).send({}).expect(404);
  });

  it('accepts inbound SMS as GET query parameters (m15)', async () => {
    const r = await http.get('/v1/connectors/fakeagg/sms?msisdn=237690000001&content=bonjour').set(CB).expect(200);
    expect(r.body).toMatchObject({ handled: false, reply: expect.stringMatching(/non compris/) });
  });

  /* ---------- P1.2: idempotent checkout, status queries, refunds, reconciliation (M6, m12, m13) ---------- */

  const collects = () => received.filter((r) => r.path === '/v1/payments/collect').length;
  const body = (o: Record<string, unknown> = {}) => ({ account_type: 'user', plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000001', ...o });
  const opsService = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaymentOpsService } = require('../src/billing/payment-ops.service');
    return app.get(PaymentOpsService);
  };

  it('checkout is idempotent: a double tap with the same client id gives one payment and one USSD prompt', async () => {
    const m = await login('+237690000001');
    const auth = { authorization: `Bearer ${m.token}` };
    const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
    const before = collects();
    const [a, b] = await Promise.all([
      http.post('/v1/subscriptions/checkout').set(auth).send(body({ id, account_id: m.id })),
      http.post('/v1/subscriptions/checkout').set(auth).send(body({ id, account_id: m.id })),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.payment_id).toBe(id);
    expect(b.body.payment_id).toBe(id);
    expect(collects() - before).toBe(1);
    const again = await http.post('/v1/subscriptions/checkout').set(auth).send(body({ id, account_id: m.id })).expect(201);
    expect(again.body).toMatchObject({ payment_id: id, status: 'initie', ussd_push: true, replayed: true, provider_ref: expect.stringMatching(/^TX-/) });
    expect(collects() - before).toBe(1);
    expect((await db.query(`SELECT count(*)::int AS n FROM payments WHERE id = $1`, [id])).rows[0].n).toBe(1);
    // Same id, other request: refused.
    const other = await http.post('/v1/subscriptions/checkout').set(auth).send(body({ id, account_id: m.id, period: 'yearly' })).expect(409);
    expect(other.body.error.details.rule).toBe('PAY-IDEMPOTENCY');
    await http.post('/v1/subscriptions/checkout').set(auth).send(body({ id: 'not-a-uuid', account_id: m.id })).expect(422);
  });

  it('checkout accepts an Idempotency-Key header, scoped to the user; a refused payment replays its refusal', async () => {
    const m = await login('+237690000001');
    const before = collects();
    const send = (key: string) => http.post('/v1/subscriptions/checkout').set({ authorization: `Bearer ${m.token}`, 'idempotency-key': key }).send(body({ account_id: m.id }));
    const a = await send('tap-1').expect(201);
    const b = await send('tap-1').expect(201);
    expect(b.body.payment_id).toBe(a.body.payment_id);
    expect(collects() - before).toBe(1);
    queued['/v1/payments/collect'] = [{ status: 400, body: { error: 'solde' } }];
    const refused = await send('tap-2').expect(422);
    const replay = await send('tap-2').expect(422);
    expect(replay.body.error.details).toMatchObject({ rule: 'PAY-INIT', payment_id: refused.body.error.details.payment_id, replayed: true });
    await http.post('/v1/subscriptions/checkout').set({ authorization: `Bearer ${m.token}`, 'idempotency-key': 'a b' }).send(body({ account_id: m.id })).expect(422);
  });

  it('only routed payment methods are offered (m12) and the global webhook is closed with connectors (m13)', async () => {
    const plans = await http.get('/v1/plans').expect(200);
    expect(plans.body.payment_methods.map((x: { code: string }) => x.code)).toEqual(['orange_money']);
    const m = await login('+237690000001');
    const r = await http.post('/v1/subscriptions/checkout').set({ authorization: `Bearer ${m.token}` }).send(body({ account_id: m.id, method: 'mtn_momo' })).expect(422);
    expect(r.body.error.fields.method).toBeDefined();
    await http.post('/v1/payments/webhook').send({ payment_id: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', status: 'confirme' }).expect(404);
  });

  it('pending payments are queried with growing delays, then flagged "a_verifier"; a late webhook still confirms', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    const co = await checkout(m.token, m.id).expect(201);
    const statusPath = `/v1/payments/by-reference/${co.body.payment_id}`;
    await db.query(`UPDATE payments SET created_at = now() - interval '10 minutes' WHERE id = $1`, [co.body.payment_id]);
    queued[statusPath] = Array.from({ length: 6 }, () => ({ status: 200, body: { state: 'PENDING' } }));
    const ops = opsService();
    let at = Date.now();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      await ops.pollPending(new Date(at));
      const raw = (await db.query(`SELECT status, raw FROM payments WHERE id = $1`, [co.body.payment_id])).rows[0];
      if (i < 5) {
        expect(raw.status).toBe('en_attente');
        delays.push(Math.round((Date.parse(raw.raw.poll.next_at) - at) / 60_000));
      } else expect(raw.status).toBe('a_verifier');
      at += 3 * 3600_000;
    }
    expect(delays).toEqual([5, 10, 20, 40, 60]);
    expect(received.filter((r) => r.path === statusPath && r.method === 'GET')).toHaveLength(6);
    const flagged = await http.get('/v1/admin/payments?status=a_verifier').set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(flagged.body.data.find((p: { id: string }) => p.id === co.body.payment_id)).toMatchObject({ connector: 'fakeagg', poll: expect.objectContaining({ count: 6 }) });
    await http.get('/v1/admin/payments').set({ authorization: `Bearer ${m.token}` }).expect(403);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co.body.payment_id, status: 'SUCCESS', amount: 2500 }).expect(200);
    expect(await status(m.token, co.body.payment_id)).toBe('confirme');
  });

  it('initiation timeout, then status query by our reference, then confirmed (M1)', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    queued['/v1/payments/collect'] = [{ status: 503, body: {} }];
    const r = await checkout(m.token, m.id).expect(422);
    const id = r.body.error.details.payment_id as string;
    expect((await db.query(`SELECT provider_ref FROM payments WHERE id = $1`, [id])).rows[0].provider_ref).toBeNull();
    queued[`/v1/payments/by-reference/${id}`] = [{ status: 200, body: { state: 'SUCCESS', amount: 2500 } }];
    const checked = await http.post(`/v1/admin/payments/${id}/check`).set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(checked.body).toMatchObject({ status: 'confirme', outcome: 'confirmed' });
    expect(received.some((x) => x.path === '/v1/payments/' || x.path === '/v1/payments/by-reference/')).toBe(false);
  });

  it('a status query confirms a payment whose webhook never came (admin "check now")', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    const co = await checkout(m.token, m.id).expect(201);
    queued[`/v1/payments/by-reference/${co.body.payment_id}`] = [{ status: 200, body: { state: 'SUCCESS', amount: 2500 } }];
    const r = await http.post(`/v1/admin/payments/${co.body.payment_id}/check`).set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(r.body).toMatchObject({ id: co.body.payment_id, status: 'confirme', checked: true, outcome: 'confirmed' });
    // A status with another amount is refused like a webhook.
    const co2 = await checkout(m.token, m.id).expect(201);
    queued[`/v1/payments/by-reference/${co2.body.payment_id}`] = [{ status: 200, body: { state: 'SUCCESS', amount: 1 } }];
    const r2 = await http.post(`/v1/admin/payments/${co2.body.payment_id}/check`).set({ authorization: `Bearer ${admin.token}` }).expect(200);
    expect(r2.body.status).toBe('en_attente');
  });

  it('refunds a confirmed payment once, with a stable key, journaled; late events do not re-activate it', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    const aauth = { authorization: `Bearer ${admin.token}` };
    const co = await checkout(m.token, m.id).expect(201);
    const id = co.body.payment_id;
    await http.post(`/v1/admin/payments/${id}/refund`).set(aauth).send({ reason: 'Erreur de formule' }).expect(422); // not confirmed yet
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'SUCCESS', amount: 2500 }).expect(200);
    await http.post(`/v1/admin/payments/${id}/refund`).set({ authorization: `Bearer ${m.token}` }).send({ reason: 'Erreur de formule' }).expect(403);
    // 503: unknown outcome, followed by the refund status query; the retry answers 409, declared "already refunded".
    queued['/v1/refunds'] = [{ status: 503, body: {} }, { status: 409, body: { error: 'already refunded' } }];
    const unknown = await http.post(`/v1/admin/payments/${id}/refund`).set(aauth).send({ reason: 'Erreur de formule' }).expect(422);
    expect(unknown.body.error.details).toMatchObject({ rule: 'PAY-REFUND-PENDING', refund_status: 'inconnu', error_code: 'http_503' });
    expect(await status(m.token, id)).toBe('remboursement_en_cours');
    const done = await http.post(`/v1/admin/payments/${id}/refund`).set(aauth).send({ reason: 'Erreur de formule' }).expect(200);
    expect(done.body).toMatchObject({ id, status: 'rembourse', refund: expect.objectContaining({ status: 'rembourse', http_status: 409, reason: 'Erreur de formule' }) });
    const calls = received.filter((r) => r.path === '/v1/refunds');
    expect(calls.slice(-2).map((c) => c.body.key)).toEqual([done.body.refund.id, done.body.refund.id]);
    expect(calls[calls.length - 1].body).toMatchObject({ transaction: co.body.provider_ref, amount: 2500, reason: 'Erreur de formule' });
    // Asking again does not call the aggregator a third time.
    await http.post(`/v1/admin/payments/${id}/refund`).set(aauth).send({ reason: 'Erreur de formule' }).expect(200);
    expect(received.filter((r) => r.path === '/v1/refunds')).toHaveLength(calls.length);
    const audit = await db.query(`SELECT action FROM audit_log WHERE entity = 'payments' AND entity_id = $1 ORDER BY id`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['refund_requested', 'refund_inconnu', 'refund_requested', 'refund_rembourse']);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'SUCCESS', amount: 2500 }).expect(200);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'FAILED' }).expect(200);
    expect(await status(m.token, id)).toBe('rembourse');
    // A refusal puts the payment back to "confirme".
    const co2 = await checkout(m.token, m.id).expect(201);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: co2.body.payment_id, status: 'SUCCESS', amount: 2500 }).expect(200);
    queued['/v1/refunds'] = [{ status: 200, body: { state: 'REFUSED' } }];
    const refused = await http.post(`/v1/admin/payments/${co2.body.payment_id}/refund`).set(aauth).send({ reason: 'Essai de refus' }).expect(422);
    expect(refused.body.error.details.rule).toBe('PAY-REFUND-REFUSED');
    expect(await status(m.token, co2.body.payment_id)).toBe('confirme');
  });

  it('two simultaneous refunds call the aggregator once; a pending refund is settled by the refund status query (M3)', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    const aauth = { authorization: `Bearer ${admin.token}` };
    const co = await checkout(m.token, m.id).expect(201);
    const id = co.body.payment_id;
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: id, status: 'SUCCESS', amount: 2500 }).expect(200);
    const before = received.filter((r) => r.path === '/v1/refunds').length;
    queued['/v1/refunds'] = [{ status: 202, body: { state: 'QUEUED', refund_id: 'RF-Q' } }, { status: 200, body: { state: 'DONE' } }];
    const send = () => http.post(`/v1/admin/payments/${id}/refund`).set(aauth).send({ reason: 'Double clic' });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.details.rule).toBe('PAY-REFUND-IN-PROGRESS');
    expect(received.filter((r) => r.path === '/v1/refunds').length - before).toBe(1);
    const ok = results.find((r) => r.status === 200)!;
    expect(ok.body).toMatchObject({ status: 'remboursement_en_cours', refund: expect.objectContaining({ status: 'en_attente', ref: 'RF-Q' }) });
    // Pending: a third request is refused as well, no new aggregator call.
    await send().expect(409);
    // The poller asks the refund status with the refund key.
    queued[`/v1/refunds/${ok.body.refund.id}`] = [{ status: 200, body: { state: 'DONE' } }];
    const r = await opsService().pollRefunds(new Date(Date.now() + 3600_000));
    expect(r).toMatchObject({ refunded: 1 });
    expect(await status(m.token, id)).toBe('rembourse');
    const audit = await db.query(`SELECT action, actor_role FROM audit_log WHERE entity = 'payments' AND entity_id = $1 ORDER BY id`, [id]);
    expect(audit.rows[audit.rows.length - 1]).toEqual({ action: 'refund_rembourse', actor_role: 'systeme' });
  });

  it('daily reconciliation: aggregator list ↔ database, payments without subscription, connectors that cannot be checked', async () => {
    const m = await login('+237690000001');
    const admin = await login('+237690000009');
    const aauth = { authorization: `Bearer ${admin.token}` };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala' }).format(new Date());
    const ok = await checkout(m.token, m.id).expect(201);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: ok.body.payment_id, status: 'SUCCESS', amount: 2500 }).expect(200);
    const diverging = await checkout(m.token, m.id).expect(201);
    await http.post('/v1/connectors/fakeagg/payment').set(CB).send({ reference: diverging.body.payment_id, status: 'SUCCESS', amount: 2500 }).expect(200);
    // A confirmed payment that lost its subscription link.
    await db.query(`UPDATE payments SET subscription_id = NULL WHERE id = $1`, [ok.body.payment_id]);
    queued['/v1/payments'] = [
      {
        status: 200,
        body: {
          items: [
            { reference: ok.body.payment_id, transaction_id: ok.body.provider_ref, status: 'SUCCESS', amount: 2500 },
            { reference: diverging.body.payment_id, transaction_id: diverging.body.provider_ref, status: 'FAILED', amount: 2500 },
            { reference: 'inconnu', transaction_id: 'TX-ETRANGER', status: 'SUCCESS', amount: 900 },
          ],
        },
      },
    ];
    await http.post('/v1/admin/payments/reconciliations').set({ authorization: `Bearer ${m.token}` }).send({ day: today }).expect(403);
    const r = await http.post('/v1/admin/payments/reconciliations').set(aauth).send({ day: today }).expect(200);
    const listCall = [...received].reverse().find((x) => x.path === '/v1/payments' && x.method === 'GET');
    expect(listCall).toBeDefined();
    expect(r.body.sources).toEqual([{ connector: 'fakeagg', source: 'liste' }]);
    expect(r.body.confirmes_sans_abonnement).toEqual([expect.objectContaining({ payment_id: ok.body.payment_id })]);
    expect(r.body.divergences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payment_id: diverging.body.payment_id, base: 'confirme', fournisseur: 'FAILED', ecart: 'statut' }),
        expect.objectContaining({ provider_ref: 'TX-ETRANGER', base: null, ecart: 'inconnu_en_base' }),
      ]),
    );
    // Confirmed today but missing from the aggregator's list.
    expect(r.body.divergences.filter((d: { ecart: string }) => d.ecart === 'absent_chez_fournisseur').length).toBeGreaterThan(0);
    expect(r.body.totals.confirmed_amounts).toEqual([expect.objectContaining({ currency: 'XAF' })]);
    const stored = await http.get(`/v1/admin/payments/reconciliations?day=${today}`).set(aauth).expect(200);
    expect(stored.body.data[0]).toMatchObject({ day: today, divergences: expect.any(Array) });
  });

  it('reconciliation falls back on status queries without a list, reports unverifiable connectors, and runs once a day', async () => {
    const admin = await login('+237690000009');
    const aauth = { authorization: `Bearer ${admin.token}` };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala' }).format(new Date());
    // The aggregator's list is down: the connector is reported as not verified.
    queued['/v1/payments'] = [{ status: 500, body: {} }];
    const down = await http.post('/v1/admin/payments/reconciliations').set(aauth).send({ day: today }).expect(200);
    expect(down.body.non_verifies).toEqual([{ connector: 'fakeagg', raison: 'http_500' }]);
    // Same connector described without a list: each payment of the day is checked with the status query.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const registry = app.get(require('../src/connectors/connector-registry').CONNECTOR_REGISTRY);
    const spec = registry.get('fakeagg').spec.payment;
    const list = spec.list;
    delete spec.list;
    try {
      const target = (await db.query(`SELECT id, provider_ref FROM payments WHERE status = 'confirme' AND raw->>'connector' = 'fakeagg' ORDER BY created_at DESC LIMIT 1`)).rows[0];
      queued[`/v1/payments/by-reference/${target.id}`] = [{ status: 200, body: { state: 'SUCCESS', amount: 999 } }];
      const r = await http.post('/v1/admin/payments/reconciliations').set(aauth).send({ day: today }).expect(200);
      expect(r.body.sources).toEqual([{ connector: 'fakeagg', source: 'statut' }]);
      expect(r.body.divergences).toEqual(expect.arrayContaining([expect.objectContaining({ payment_id: target.id, ecart: 'montant' })]));
      // Neither list nor status query: not verifiable.
      const status = spec.status;
      delete spec.status;
      const none = await http.post('/v1/admin/payments/reconciliations').set(aauth).send({ day: today }).expect(200);
      spec.status = status;
      expect(none.body.non_verifies).toEqual([{ connector: 'fakeagg', raison: 'ni liste ni requete de statut dans le connecteur' }]);
    } finally {
      spec.list = list;
    }
    // Hourly job: yesterday's report is produced once, after the configured local time (02:00).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scheduler = app.get(require('../src/billing/payments.scheduler').PaymentsScheduler);
    expect(await scheduler.reconcileIfDue(new Date(`${today}T00:30:00Z`))).toBeNull(); // 01:30 in Douala
    queued['/v1/payments'] = [{ status: 200, body: { items: [] } }];
    const day = await scheduler.reconcileIfDue(new Date(`${today}T12:00:00Z`));
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day < today).toBe(true);
    expect(await scheduler.reconcileIfDue(new Date(`${today}T13:00:00Z`))).toBeNull();
    expect(await opsService().hasReport(day)).toBe(true);
  });
});
