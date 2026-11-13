/**
 * Pilot journey (MVP-SCOPE §6): OTP → farm → batch (form) → daily log (alert) → health event → reminders →
 * SMS "OK <code>" → checkout + webhook → entitlements JWS → sync push/pull (replay + daily_log merge) →
 * certificate verify → studio four-eyes → organisation dashboard k-anonymity.
 * Runs against TEST_DATABASE_URL (schema reset + migrations + seed).
 */
import { createHmac, randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { importJWK, jwtVerify } from 'jose';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import request from 'supertest';
import { deflatedZip, workbookEntries } from './xlsx-fixtures';
import type { NestExpressApplication } from '@nestjs/platform-express';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm_test';
Object.assign(process.env, {
  NODE_ENV: 'test',
  TZ: 'Africa/Douala',
  DATABASE_URL: TEST_DB,
  OTP_DEV_ECHO: 'true',
  SCHEDULER_ENABLED: 'false',
  PAYMENT_SIM_AUTOCONFIRM_MS: '0',
  THROTTLE_LIMIT: '100000',
  PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || 'e2e-webhook-secret',
  KEYS_DIR: mkdtempSync(join(tmpdir(), 'rf-keys-')),
  EXPORTS_DIR: mkdtempSync(join(tmpdir(), 'rf-exports-')),
});
delete process.env.REDIS_URL;

// Imported after the environment is set (config is read lazily).
/* eslint-disable @typescript-eslint/no-var-requires */
const { reloadConfig } = require('../src/config');
const { runMigrations } = require('../src/database/data-source');
const { createApp } = require('../src/bootstrap');
const { runSeed } = require('../src/seed/seed');
const { DEMO } = require('../src/seed/demo');
const { todayIn, addDays } = require('../src/common/dates');
const { NotificationsScheduler } = require('../src/notifications/notifications.scheduler');
/* eslint-enable @typescript-eslint/no-var-requires */

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
const today: string = todayIn('Africa/Douala');

async function login(phone: string): Promise<{ token: string; refresh: string; user: any }> {
  const r1 = await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
  expect(r1.body.dev_code).toMatch(/^\d{6}$/);
  const r2 = await http.post('/v1/auth/otp/verify').send({ phone, code: r1.body.dev_code }).expect(200);
  return { token: r2.body.access_token, refresh: r2.body.refresh_token, user: r2.body.user };
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  reloadConfig();
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await runMigrations(TEST_DB);
  app = await createApp({ databaseUrl: TEST_DB, logger: false });
  await app.init();
  await runSeed(app);
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
});

afterAll(async () => {
  await app?.close();
});

describe('pilot journey', () => {
  const phone = '+237690001234';
  const farmId = randomUUID();
  const batchId = randomUUID();
  const logId = randomUUID();
  let token = '';
  let refresh = '';

  it('health endpoints', async () => {
    await http.get('/v1/health').expect(200, /ok/);
    const r = await http.get('/v1/ready').expect(200);
    expect(r.body).toMatchObject({ db: 'ok', redis: 'disabled' });
  });

  it('EF-AUT-01 RG-AUT-01: OTP request/verify creates the account, refresh works, 4th request in 15 min is rate limited', async () => {
    const s = await login(phone);
    token = s.token;
    refresh = s.refresh;
    expect(s.user).toMatchObject({ phone, platform_roles: [], farms: [] });
    expect(s.user.entitlements.plan).toBe('decouverte');
    const r = await http.post('/v1/auth/refresh').send({ refresh_token: refresh }).expect(200);
    expect(r.body.access_token).toBeTruthy();
    await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    const limited = await http.post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    await http.get('/v1/me').expect(401);
  });

  it('uniform validation errors (whitelist + forbidNonWhitelisted)', async () => {
    const r = await http.post('/v1/farms').set(auth(token)).send({ id: farmId, name: 'X', speculations: ['volaille'], country: 'CM', hacker: 1 }).expect(422);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { hacker: 'champ non autorisé' } });
  });

  it('EF-ONB-02: creates a farm (idempotent upsert)', async () => {
    const body = { id: farmId, name: 'Ferme pilote Soa', speculations: ['volaille'], country: 'CM', locality: 'Soa' };
    const r = await http.post('/v1/farms').set(auth(token)).send(body).expect(201);
    expect(r.body).toMatchObject({ id: farmId, currency: 'XAF', name: 'Ferme pilote Soa' });
    await http.post('/v1/farms').set(auth(token)).send(body).expect(201);
    const list = await http.get('/v1/farms').set(auth(token)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.next_cursor).toBeNull();
  });

  it('EF-CHE-02 EF-VAC-02 EF-ONB-01: validates a batch against the resolved form, then creates it with reminders', async () => {
    const bad = await http
      .post(`/v1/farms/${farmId}/batches`)
      .set(auth(token))
      .send({ id: batchId, name: 'B1', production_type: 'canard', initial_count: 0, attributes: { age_at_start_days: 'x' } })
      .expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.fields).toMatchObject({ production_type: expect.any(String), start_date: expect.any(String), initial_count: expect.any(String), 'attributes.age_at_start_days': expect.any(String) });

    const r = await http
      .post(`/v1/farms/${farmId}/batches`)
      .set(auth(token))
      .send({ id: batchId, name: 'B1', production_type: 'chair', start_date: addDays(today, -8), initial_count: 500, attributes: { strain: 'Cobb 500' } })
      .expect(201);
    expect(r.body).toMatchObject({ id: batchId, species: 'volaille', current_count: 500, attributes: { strain: 'Cobb 500', age_at_start_days: 1 } });
    expect(r.body.param_version).toContain('filiere.volaille@1.0.0');

    const rem = await http.get(`/v1/reminders?farm_id=${farmId}`).set(auth(token)).expect(200);
    const steps = rem.body.data.map((x: any) => x.step);
    expect(steps).toEqual(['marek_j1', 'newcastle_bi_j7', 'gumboro_j12', 'newcastle_rappel_j19', 'gumboro_rappel_j21']);
    expect(rem.body.data[0]).toMatchObject({ timing: 'en_retard', status: 'a_venir' });
  });

  it('EF-JOU-01 RG-JOU-05 RG-CHE-01: daily log: high mortality opens a critical alert; duplicates → 409; RG-JOU-03', async () => {
    const r = await http
      .post(`/v1/farms/${farmId}/daily-logs`)
      .set(auth(token))
      .send({ id: logId, subject_type: 'batch', subject_id: batchId, log_date: today, mortality: 10, feed_kg: 30 })
      .expect(201);
    expect(r.body.present_count).toBe(500);
    expect(r.body.alerts).toHaveLength(1);
    expect(r.body.alerts[0]).toMatchObject({ rule_code: 'mortalite_journaliere', severity: 'critique', status: 'ouverte' });
    expect(r.body.alert_event_id).toBe(r.body.alerts[0].id);

    const dup = await http
      .post(`/v1/farms/${farmId}/daily-logs`)
      .set(auth(token))
      .send({ id: randomUUID(), subject_type: 'batch', subject_id: batchId, log_date: today, mortality: 1 })
      .expect(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', details: { existing_id: logId } });

    const tooMany = await http
      .post(`/v1/farms/${farmId}/daily-logs`)
      .set(auth(token))
      .send({ id: randomUUID(), subject_type: 'batch', subject_id: batchId, log_date: addDays(today, -1), mortality: 900 })
      .expect(422);
    expect(tooMany.body.error).toMatchObject({ code: 'BUSINESS_RULE', details: { rule: 'RG-JOU-03' } });

    const batch = await http.get(`/v1/batches/${batchId}`).set(auth(token)).expect(200);
    expect(batch.body.current_count).toBe(490);
    const alerts = await http.get(`/v1/alerts?farm_id=${farmId}&status=open`).set(auth(token)).expect(200);
    expect(alerts.body.data).toHaveLength(1);
  });

  let eventId = '';
  it('EF-VAC-01 EF-VAC-04 EF-VAC-06: health event recomputes reminders; certificate requires Pro', async () => {
    eventId = randomUUID();
    const r = await http
      .post('/v1/health-events')
      .set(auth(token))
      .send({ id: eventId, subject_type: 'batch', subject_id: batchId, event_type: 'vaccination', protocol_step: 'newcastle_bi_j7', event_date: addDays(today, -1), product: 'Hitchner B1' })
      .expect(201);
    expect(r.body).toMatchObject({ id: eventId, disease: 'newcastle', protocol_id: 'volaille_chair_cm' });
    expect(r.body.reminders.map((x: any) => x.step)).not.toContain('newcastle_bi_j7');
    const cert = await http.get(`/v1/health-events/${eventId}/certificate.json`).set(auth(token)).expect(403);
    expect(cert.body.error).toMatchObject({ code: 'PLAN_REQUIRED', details: { required_plan: 'pro' } });
  });

  it('EF-VAC-04 T-02: inbound SMS "OK <code>" confirms the reminder', async () => {
    const rem = await http.get(`/v1/reminders?farm_id=${farmId}&status=ouvert`).set(auth(token)).expect(200);
    const marek = rem.body.data.find((x: any) => x.step === 'marek_j1');
    const r = await http.post('/v1/inbound/sms').send({ from: phone, text: `ok ${marek.short_code}` }).expect(200);
    expect(r.body).toMatchObject({ handled: true, reminder_id: marek.id });
    const after = await http.get(`/v1/reminders?farm_id=${farmId}&status=confirme`).set(auth(token)).expect(200);
    expect(after.body.data.find((x: any) => x.id === marek.id)).toMatchObject({ status: 'confirme', confirmed_via: 'sms' });
    const outbox = await http.get(`/v1/dev/outbox?phone=${encodeURIComponent(phone)}`).expect(200);
    expect(outbox.body.data[0].text).toMatch(/merci/i);
  });

  it('T-08 EF-ABO-01 EF-ABO-02: checkout + signed webhook activates Pro; entitlements JWS verifies offline', async () => {
    const me = await http.get('/v1/me').set(auth(token)).expect(200);
    const co = await http
      .post('/v1/subscriptions/checkout')
      .set(auth(token))
      .send({ account_type: 'user', account_id: me.body.id, plan: 'pro', period: 'monthly', method: 'orange_money', phone })
      .expect(201);
    expect(co.body).toMatchObject({ status: 'initie', ussd_push: true, amount: { amount_minor: 2500, currency: 'XAF' } });
    const payload = JSON.stringify({ payment_id: co.body.payment_id, status: 'confirme' });
    await http.post('/v1/payments/webhook').set('content-type', 'application/json').set('x-signature', 'deadbeef').send(payload).expect(401);
    const sig = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!).update(payload).digest('hex');
    const wh = await http.post('/v1/payments/webhook').set('content-type', 'application/json').set('x-signature', sig).send(payload).expect(200);
    expect(wh.body.status).toBe('confirme');
    const pay = await http.get(`/v1/payments/${co.body.payment_id}`).set(auth(token)).expect(200);
    expect(pay.body.status).toBe('confirme');

    const me2 = await http.get('/v1/me').set(auth(token)).expect(200);
    expect(me2.body.entitlements.plan).toBe('pro');
    const pk = await http.get('/v1/params/public-key').expect(200);
    const key = await importJWK(pk.body.jwk, 'EdDSA');
    const { payload: claims } = await jwtVerify(me2.body.entitlements.token, key, { issuer: 'recallfarm' });
    expect(claims).toMatchObject({ plan: 'pro', sub: me.body.id });
    expect(claims.features).toContain('certificat_qr');
    await http.get(`/v1/health-events/${eventId}/certificate.json`).set(auth(token)).expect(200);
  });

  it('T-07 T-33 EF-SYN-01 EF-SYN-02 EF-SYN-03 EF-SYN-04 RG-SYN-01: sync push/pull round trip with idempotent replay and daily_log conflict merge', async () => {
    const newLog = randomUUID();
    const changes = [
      { entity: 'batches', op: 'upsert', id: batchId, client_rev: 2, data: { farm_id: farmId, strain: 'Cobb 500 (hors ligne)', current_count: 1 } },
      { entity: 'daily_logs', op: 'upsert', id: newLog, client_rev: 1, data: { farm_id: farmId, subject_type: 'batch', subject_id: batchId, log_date: addDays(today, -2), mortality: 2, feed_kg: 28 } },
    ];
    const p1 = await http.post('/v1/sync/push').set(auth(token)).send({ device_id: 'device-A', changes }).expect(200);
    expect(p1.body.rejected).toEqual([]);
    expect(p1.body.applied.map((a: any) => a.id)).toEqual([batchId, newLog]);
    const replay = await http.post('/v1/sync/push').set(auth(token)).send({ device_id: 'device-A', changes }).expect(200);
    expect(replay.body.applied).toEqual(p1.body.applied);
    const logs = await http.get(`/v1/farms/${farmId}/daily-logs`).set(auth(token)).expect(200);
    expect(logs.body.data).toHaveLength(2);
    const batch = await http.get(`/v1/batches/${batchId}`).set(auth(token)).expect(200);
    expect(batch.body).toMatchObject({ strain: 'Cobb 500 (hors ligne)', current_count: 488 }); // derived count ignored in push

    // Device B recorded the same day offline under another id: mortalities are summed, counts take the max.
    const conflict = await http
      .post('/v1/sync/push')
      .set(auth(token))
      .send({ device_id: 'device-B', changes: [{ entity: 'daily_logs', op: 'upsert', id: randomUUID(), client_rev: 1, data: { subject_type: 'batch', subject_id: batchId, log_date: today, mortality: 3, feed_kg: 35 } }] })
      .expect(200);
    expect(conflict.body.conflicts).toHaveLength(1);
    expect(conflict.body.conflicts[0].server_data).toMatchObject({ id: logId, mortality: 10 });
    expect(conflict.body.conflicts[0].merged_data).toMatchObject({ id: logId, mortality: 13, feed_kg: 35 });

    const pull = await http.get('/v1/sync/pull?since=0&entities=farms,batches,daily_logs,reminders,alerts,params').set(auth(token)).expect(200);
    const entities = new Set(pull.body.changes.map((c: any) => c.entity));
    for (const e of ['farms', 'batches', 'daily_logs', 'reminders', 'alerts', 'params']) expect(entities).toContain(e);
    expect(pull.body.has_more).toBe(false);
    expect(pull.body.params_manifest.map((m: any) => m.pack)).toEqual(['global.core', 'filiere.volaille', 'pays.CM']);
    const versions = pull.body.changes.map((c: any) => c.sync_version);
    expect([...versions].sort((a: number, b: number) => a - b)).toEqual(versions);
    const delta = await http.get(`/v1/sync/pull?since=${pull.body.server_version}`).set(auth(token)).expect(200);
    expect(delta.body.changes).toEqual([]);
  });

  it('T-35 EF-VAC-06 EF-CAN-01 EF-CAN-02: certificate QR payload verifies publicly (Marthe, Rex, rabies)', async () => {
    const marthe = await login(DEMO.phones.marthe);
    const book = await http.get(`/v1/dogs/${DEMO.marthe.rex}`).set(auth(marthe.token)).expect(200);
    expect(book.body).toMatchObject({ name: 'Rex', chip_number: '120093000418271', rabies_status: 'a_jour' });
    const rabies = book.body.health_book.find((h: any) => h.disease === 'rage' && !h.protocol_step);
    const cert = await http.get(`/v1/health-events/${rabies.id}/certificate.json`).set(auth(marthe.token)).expect(200);
    expect(cert.body.valid_until).toBe(addDays(rabies.event_date, 365));
    const v = await http.get('/v1/certificates/verify').query({ payload: cert.body.qr_payload }).expect(200);
    expect(v.body).toMatchObject({ valid: true, animal_name: 'Rex', species: 'chien', disease: 'Rage', event_date: rabies.event_date });
    const tampered = cert.body.qr_payload.replace(/^./, (c: string) => (c === 'e' ? 'f' : 'e'));
    expect((await http.get('/v1/certificates/verify').query({ payload: tampered }).expect(200)).body.valid).toBe(false);
    const pdf = await http.get(`/v1/health-events/${rabies.id}/certificate`).set(auth(marthe.token)).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const mc = await http.post('/v1/mating-checks').set(auth(marthe.token)).send({ species: 'chien', sire_id: DEMO.marthe.rex, dam_id: DEMO.marthe.nala }).expect(200);
    expect(mc.body).toMatchObject({ verdict: 'attention', threshold: 0.0625 });
    expect(mc.body.expected_coef).toBeCloseTo(0.03125, 5);
  });

  it('T-43 EF-PAR-06 RG-PAR-04: studio four-eyes: the author cannot publish, the reviewer can', async () => {
    const author = await login(DEMO.phones.jeanMarc);
    const reviewer = await login(DEMO.phones.mbarga);
    const draft = await http.post('/v1/studio/packs/pays.CM/versions').set(auth(author.token)).send({ changelog: 'Texte SMS' }).expect(201);
    expect(draft.body).toMatchObject({ version: '1.0.1', status: 'brouillon' });
    const content = draft.body.content;
    content.objects = content.objects.map((o: any) => (o.kind === 'message_template' && o.code === 'rappel_sms' && o.lang === 'fr' ? { ...o, text: `${o.text} Merci.` } : o));
    await http.patch(`/v1/studio/versions/${draft.body.id}`).set(auth(author.token)).send({ content }).expect(200);
    const val = await http.post(`/v1/studio/versions/${draft.body.id}/validate`).set(auth(author.token)).expect(200);
    expect(val.body).toEqual({ valid: true, errors: [] });
    const diff = await http.get(`/v1/studio/versions/${draft.body.id}/diff`).set(auth(author.token)).expect(200);
    expect(diff.body).toMatchObject({ base_version: '1.0.0', major: false, impact: { subjects_recomputed: 0 } });
    expect(diff.body.changes).toEqual([expect.objectContaining({ op: 'change', path: 'message_template:rappel_sms:sms:fr.text' })]);
    await http.post(`/v1/studio/versions/${draft.body.id}/submit`).set(auth(author.token)).expect(200);
    const tests = await http.post(`/v1/studio/versions/${draft.body.id}/test`).set(auth(author.token)).expect(200);
    expect(tests.body).toMatchObject({ passed: true, total: 5 });
    expect(tests.body.results.every((r: any) => r.ok)).toBe(true);

    const selfPublish = await http.post(`/v1/studio/versions/${draft.body.id}/publish`).set(auth(author.token)).send({}).expect(422);
    expect(selfPublish.body.error).toMatchObject({ code: 'BUSINESS_RULE', details: { rule: 'RG-PAR-04' } });
    await http.post(`/v1/studio/versions/${draft.body.id}/reviews`).set(auth(author.token)).send({ decision: 'approuve' }).expect(422);
    await http.post(`/v1/studio/versions/${draft.body.id}/reviews`).set(auth(reviewer.token)).send({ decision: 'approuve', comments: 'OK' }).expect(201);
    const approved = await http.get(`/v1/studio/versions/${draft.body.id}`).set(auth(author.token)).expect(200);
    expect(approved.body).toMatchObject({ status: 'teste', author_name: 'Jean-Marc', content: expect.any(Object) });
    expect(approved.body.reviews[0]).toMatchObject({ decision: 'approuve', reviewer_name: 'Dr Mbarga' });
    const pub = await http.post(`/v1/studio/versions/${draft.body.id}/publish`).set(auth(reviewer.token)).send({}).expect(200);
    expect(pub.body).toMatchObject({ status: 'publie', version: '1.0.1' });
    expect(pub.body.signature).toBeTruthy();
    const manifest = await http.get('/v1/params/manifest').set(auth(token)).expect(200);
    expect(manifest.body.find((m: any) => m.pack === 'pays.CM').version).toBe('1.0.1');

    const sim = await http.post('/v1/studio/simulate-protocol').set(auth(author.token)).send({ version_id: draft.body.id, protocol_code: 'chien_cm', birth_or_start_date: '2026-11-01' }).expect(200);
    expect(sim.body.events.map((s: any) => s.step)).toEqual(['chppil_s8', 'chppil_s12', 'rage_m3', 'rage_recurrent']);
    expect(sim.body.events[2]).toMatchObject({ offset_days: 90, due_date: '2027-01-30', kind: 'vaccin', conditional: false });
    expect(sim.body.reminder_offsets).toEqual([-7, -1, 0, 3]);
    const packs = await http.get('/v1/studio/packs').set(auth(author.token)).expect(200);
    expect(packs.body.data.find((p: any) => p.code === 'global.core')).toMatchObject({ level: 'global', published_version: '1.0.0', draft: null });
    await http.post('/v1/studio/packs/pays.CM/rollback').set(auth(reviewer.token)).send({ to_version: '1.0.0', reason: 'test' }).expect(200);
  });

  it('T-36 RG-SUR-02 EF-ANA-02: organisation dashboard (Structure) masks cells under 5 farms', async () => {
    const aicha = await login(DEMO.phones.aicha);
    const d = await http.get(`/v1/organisations/${DEMO.orgId}/dashboard`).set(auth(aicha.token)).expect(200);
    expect(d.body.kpis).toMatchObject({ total_farmers: 312, active_farmers_7d: 241, farmers_without_smartphone: 64, overdue_reminders: 48, overdue_j3: 17, batches_over_threshold: 2 });
    expect(d.body.kpis.confirmed_rate).toBeCloseTo(87.4, 0);
    expect(d.body.weekly).toHaveLength(12);
    const bikok = d.body.coverage.cells.find((c: any) => c.zone === 'Bikok');
    expect(bikok).toMatchObject({ zone: 'Bikok', rate: null, masked: true });
    expect(bikok.farms).toBeUndefined();
    expect(d.body.coverage.cells.filter((c: any) => !c.masked).every((c: any) => c.farms >= 5 && typeof c.rate === 'number')).toBe(true);
    expect(d.body.todo[0]).toMatchObject({ severity: 'critique', farm_name: 'Ferme Biyong' });
    expect(d.body.sms).toEqual({ used: 3412, quota: 5000 });
    await http.get(`/v1/organisations/${DEMO.orgId}/dashboard`).set(auth(token)).expect(403);
  });

  it('EF-NOT-01 EF-NOT-02 EF-VAC-03 RG-NOT-02: notification scheduler applies the plan and journals messages', async () => {
    const r = await app.get(NotificationsScheduler).runOnce(new Date(`${today}T09:00:00+01:00`));
    expect(r.considered).toBeGreaterThan(0);
    expect(r.push + r.sent + r.capped).toBeGreaterThan(0);
    const quiet = await app.get(NotificationsScheduler).runOnce(new Date(`${today}T22:30:00+01:00`));
    expect(quiet.skipped).toBe('quiet_hours');
  });
});

describe('regressions from real-stack testing', () => {
  let aicha = '';
  let jeanMarc = '';
  beforeAll(async () => {
    aicha = (await login(DEMO.phones.aicha)).token;
    jeanMarc = (await login(DEMO.phones.jeanMarc)).token;
  });

  it('Q-SEC-01 ADR-006: xlsx import goes through the guard (nominal, lying <dimension>, shared entries)', async () => {
    const rows = [['phone', 'name', 'farm_name', 'region', 'speculations'], ['+237690009881', 'Import Xlsx', 'Ferme Xlsx', 'Centre', 'volaille']];
    const upload = (file: Buffer) =>
      http.post('/v1/imports').set(auth(aicha)).field('kind', 'farmers').field('organisation_id', DEMO.orgId).attach('file', file, 'eleveurs.xlsx');

    const ok = await upload(deflatedZip(workbookEntries(rows))).expect(201);
    expect(ok.body.job_id).toEqual(expect.any(String));

    // 8 KB file announcing A1:XFD20001 (328 million cells): refused, the process survives.
    const lying = workbookEntries(rows).map((e) =>
      /worksheets\/sheet1\.xml$/.test(e.name)
        ? { ...e, content: Buffer.from(e.content.toString('utf8').replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:XFD20001"/>')) }
        : e,
    );
    expect(lying.some((e) => e.content.includes('A1:XFD20001'))).toBe(true);
    const dim = await upload(deflatedZip(lying)).expect(422);
    expect(JSON.stringify(dim.body)).toContain('trop de colonnes');

    // Every central entry pointing at the same bytes (repeated inflate): refused.
    const shared = await upload(deflatedZip(workbookEntries(rows), { sharedLocal: true })).expect(422);
    expect(JSON.stringify(shared.body)).toContain('se chevauchent');

    await http.get('/v1/health').expect(200);
  });

  it('GET /organisations/:id/reminders?status=en_retard (timing-only filter) does not 500', async () => {
    const r = await http.get(`/v1/organisations/${DEMO.orgId}/reminders?status=en_retard`).set(auth(aicha)).expect(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((x: any) => x.timing === 'en_retard')).toBe(true);
    const multi = await http.get(`/v1/organisations/${DEMO.orgId}/reminders?status=en_retard,confirme&limit=500`).set(auth(aicha)).expect(200);
    const statuses = new Set(multi.body.data.map((x: any) => x.status));
    expect(statuses.has('confirme')).toBe(true);
    expect([...statuses].every((st) => st === 'confirme' || st === 'envoye' || st === 'a_venir')).toBe(true);
  });

  it('1. GET /alerts accepts a comma-separated status list', async () => {
    const one = await http.get(`/v1/alerts?organisation_id=${DEMO.orgId}&status=ouverte`).set(auth(aicha)).expect(200);
    const many = await http.get(`/v1/alerts?organisation_id=${DEMO.orgId}&status=ouverte,escaladee`).set(auth(aicha)).expect(200);
    expect(one.body.data.length).toBeGreaterThanOrEqual(4);
    expect(many.body.data.length).toBeGreaterThanOrEqual(one.body.data.length);
  });

  it('2. confirming a seeded coop reminder without subject works (no act recorded)', async () => {
    const list = await http.get(`/v1/organisations/${DEMO.orgId}/reminders?status=en_retard`).set(auth(aicha)).expect(200);
    const r = await http.post(`/v1/reminders/${list.body.data[0].id}/confirm`).set(auth(aicha)).send({}).expect(200);
    expect(r.body).toMatchObject({ reminder: { status: 'confirme', confirmed_via: 'app' }, health_event: null });
  });

  it('3. RG-PAR-04: an author never reviews nor publishes alone an org pack under review', async () => {
    const versions = await http.get('/v1/studio/packs/org.coop-centre/versions').set(auth(aicha)).expect(200);
    const v030 = versions.body.data.find((v: any) => v.version === '0.3.0');
    const review = await http.post(`/v1/studio/versions/${v030.id}/reviews`).set(auth(aicha)).send({ decision: 'approuve' }).expect(422);
    expect(review.body.error.details.rule).toBe('RG-PAR-04');
    const publish = await http.post(`/v1/studio/versions/${v030.id}/publish`).set(auth(aicha)).send({}).expect(422);
    expect(publish.body.error.details.rule).toBe('RG-PAR-04');
    // Same rule at any level for reviews.
    const draft = await http.post('/v1/studio/packs/filiere.canin/versions').set(auth(jeanMarc)).send({}).expect(201);
    await http.post(`/v1/studio/versions/${draft.body.id}/submit`).set(auth(jeanMarc)).expect(200);
    await http.post(`/v1/studio/versions/${draft.body.id}/reviews`).set(auth(jeanMarc)).send({ decision: 'approuve' }).expect(422);
  });

  it('4. validate checks overrides against the inherited object (params-only alert_rule override is valid)', async () => {
    const draft = await http.post('/v1/studio/packs/org.coop-centre/versions').set(auth(aicha)).send({}).expect(201);
    const v = await http.post(`/v1/studio/versions/${draft.body.id}/validate`).set(auth(aicha)).expect(200);
    expect(v.body).toEqual({ valid: true, errors: [] });
    // A brand-new rule without condition is still refused.
    const content = { ...draft.body.content, objects: [...draft.body.content.objects, { kind: 'alert_rule', code: 'nouvelle_regle', source: 'daily_logs' }] };
    await http.patch(`/v1/studio/versions/${draft.body.id}`).set(auth(aicha)).send({ content }).expect(200);
    const bad = await http.post(`/v1/studio/versions/${draft.body.id}/validate`).set(auth(aicha)).expect(200);
    expect(bad.body.errors).toEqual([expect.objectContaining({ path: 'objects[3].when', message: 'condition obligatoire' })]);
  });

  it('5. /plans: Structure is priced "from" (per tranche of farmers)', async () => {
    const r = await http.get('/v1/plans?country=CM').expect(200);
    expect(r.body.data.find((p: any) => p.code === 'structure').price).toMatchObject({ from: true, monthly: { amount_minor: 15000 } });
    expect(r.body.data.find((p: any) => p.code === 'pro').price.from).toBe(false);
    expect(r.body.data.find((p: any) => p.code === 'institution').price).toBeNull();
    expect(r.body.plans.find((p: any) => p.code === 'structure').prices.from).toBe(true);
  });

  it('6. /subscriptions/current returns the subscription in force for the account', async () => {
    const def = await http.get('/v1/subscriptions/current').set(auth(aicha)).expect(200);
    expect(def.body).toMatchObject({ account_type: 'organisation', account_id: DEMO.orgId, plan: 'structure', period: 'annuel', status: 'actif' });
    const explicit = await http.get(`/v1/subscriptions/current?account_type=organisation&account_id=${DEMO.orgId}`).set(auth(aicha)).expect(200);
    expect(explicit.body.period).toBe('annuel');
    const marthe = await login(DEMO.phones.marthe);
    const own = await http.get('/v1/subscriptions/current').set(auth(marthe.token)).expect(200);
    expect(own.body).toMatchObject({ account_type: 'user', plan: 'pro', period: 'mensuel' });
  });

  it('re-running the seed restores the demo organisation', async () => {
    await http.post(`/v1/organisations/${DEMO.orgId}/members`).set(auth(aicha)).send({ phone: '+237690009876', name: 'Agent Test', role: 'agent' }).expect(201);
    const imp = await http
      .post('/v1/imports')
      .set(auth(aicha))
      .send({ kind: 'farmers', organisation_id: DEMO.orgId, csv: 'phone,name,farm_name,region,speculations\n+237690009877,Test Import,Ferme Test,Centre,volaille\n' })
      .expect(201);
    await http.post(`/v1/imports/${imp.body.job_id}/commit`).set(auth(aicha)).expect(200);
    await http.post(`/v1/alerts/${(await http.get(`/v1/alerts?organisation_id=${DEMO.orgId}&severity=critique`).set(auth(aicha))).body.data[0].id}/ack`).set(auth(aicha)).expect(200);
    await runSeed(app);
    const d = await http.get(`/v1/organisations/${DEMO.orgId}/dashboard`).set(auth(aicha)).expect(200);
    expect(d.body.kpis.total_farmers).toBe(312);
    expect(d.body.coverage.cells.map((c: any) => c.zone)).not.toContain('Inconnue');
    expect(d.body.todo[0]).toMatchObject({ farm_name: 'Ferme Biyong', severity: 'critique' });
    expect(d.body.pending_change).toMatchObject({ version: '0.3.0', status: 'en_revue' });
    const members = await http.get(`/v1/organisations/${DEMO.orgId}/members?limit=500`).set(auth(aicha)).expect(200);
    expect(members.body.data.find((m: any) => m.phone === '+237690009876')).toBeUndefined();
    expect((await http.get('/v1/subscriptions/current').set(auth(aicha))).body).toMatchObject({ plan: 'structure', period: 'annuel' });
  });
});
