/**
 * Recette MVP automatisee (dossier 11, scenarios T-NN) : exigences que le parcours pilote ne prouvait pas.
 * Chaque test cite les ID du dossier 01 dans son nom, pour la matrice docs/plan/tracabilite-mvp.md.
 * Runs against TEST_DATABASE_URL (schema reset + migrations + seed).
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';
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

/* eslint-disable @typescript-eslint/no-var-requires */
const { reloadConfig } = require('../src/config');
const { runMigrations } = require('../src/database/data-source');
const { createApp } = require('../src/bootstrap');
const { runSeed } = require('../src/seed/seed');
const { todayIn, addDays } = require('../src/common/dates');
/* eslint-enable @typescript-eslint/no-var-requires */

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
const today: string = todayIn('Africa/Douala');
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(phone: string, provisionalUserId?: string): Promise<{ token: string; user: any }> {
  const r1 = await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await http
    .post('/v1/auth/otp/verify')
    .send({ phone, code: r1.body.dev_code, ...(provisionalUserId ? { provisional_user_id: provisionalUserId } : {}) })
    .expect(200);
  return { token: r2.body.access_token, user: r2.body.user };
}

async function sql(query: string, params: unknown[] = []): Promise<any[]> {
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows;
  } finally {
    await c.end();
  }
}

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

describe('recette MVP — exploitation volaille (stock, ventes, depenses, taches)', () => {
  const farmId = randomUUID();
  const batchId = randomUUID();
  let token = '';

  beforeAll(async () => {
    token = (await login('+237690010001')).token;
    await http.post('/v1/farms').set(auth(token)).send({ id: farmId, name: 'Ferme recette', speculations: ['volaille'], country: 'CM' }).expect(201);
    await http
      .post(`/v1/farms/${farmId}/batches`)
      .set(auth(token))
      .send({ id: batchId, name: 'Ponte 1', production_type: 'ponte', start_date: addDays(today, -120), initial_count: 200 })
      .expect(201);
  });

  it('T-04 RG-STK-01 EF-STK-01: stock = entrees - sorties (500 kg - 24 kg = 476 kg)', async () => {
    const items = await http.get(`/v1/stock-items?farm_id=${farmId}`).set(auth(token)).expect(200);
    const feed = items.body.data.find((i: any) => i.category === 'aliment');
    expect(feed).toBeDefined();
    const move = (direction: string, quantity: number, extra: Record<string, unknown> = {}) =>
      http.post(`/v1/farms/${farmId}/stock-movements`).set(auth(token)).send({ id: randomUUID(), item_id: feed.id, movement_date: today, direction, quantity, ...extra });
    await move('entree', 500, { unit_cost: { amount_minor: 300, currency: 'XAF' }, supplier: 'Provenderie du Centre' }).expect(201);
    await move('sortie', 24).expect(201);
    const s = await http.get(`/v1/farms/${farmId}/stock-summary`).set(auth(token)).expect(200);
    expect(s.body.data.find((r: any) => r.item_id === feed.id)).toMatchObject({ quantity: 476, unit: feed.unit });
    // RG-STK-01 "± ajustements": a negative adjustment lowers the stock
    await move('ajustement', -6).expect(201);
    const s2 = await http.get(`/v1/farms/${farmId}/stock-summary`).set(auth(token)).expect(200);
    expect(s2.body.data.find((r: any) => r.item_id === feed.id).quantity).toBe(470);
  });

  it('EF-STK-01: refuses an unknown input, a zero quantity and a malformed date (422 with field paths)', async () => {
    const post = (body: Record<string, unknown>) =>
      http.post(`/v1/farms/${farmId}/stock-movements`).set(auth(token)).send({ id: randomUUID(), item_id: 'aliment_ponte', movement_date: today, direction: 'entree', quantity: 1, ...body });
    const unknown = await post({ item_id: 'inconnu', quantity: 0 }).expect(422);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(unknown.body.error.fields).sort()).toEqual(['item_id', 'quantity']);
    const badDate = await post({ movement_date: '10/11/2026' }).expect(422);
    expect(Object.keys(badDate.body.error.fields)).toEqual(['movement_date']);
    await post({ direction: 'vol' }).expect(422);
  });

  it('T-10 RG-VEN-01 EF-VEN-01: 50 plateaux x 2 500 XAF = 125 000 (entier, devise de la ferme)', async () => {
    const id = randomUUID();
    const r = await http
      .post(`/v1/farms/${farmId}/sales`)
      .set(auth(token))
      .send({ id, product: 'oeufs_plateau', quantity: 50, unit: 'plateau', unit_price: { amount_minor: 2500, currency: 'XAF' }, client_name: 'Epicerie Soa', payment: 'orange_money', payment_status: 'paye', sale_date: today })
      .expect(201);
    expect(r.body).toMatchObject({ amount: { amount_minor: 125000, currency: 'XAF' }, unit_price: { amount_minor: 2500, currency: 'XAF' }, payment: 'orange_money' });
    // idempotent POST (same client-generated id): one row only
    await http.post(`/v1/farms/${farmId}/sales`).set(auth(token)).send({ id, product: 'oeufs_plateau', quantity: 50, unit: 'plateau', unit_price: { amount_minor: 2500, currency: 'XAF' }, sale_date: today }).expect(201);
    const list = await http.get(`/v1/farms/${farmId}/sales`).set(auth(token)).expect(200);
    expect(list.body.data.filter((s: any) => s.id === id)).toHaveLength(1);
    // the amount is derived, whatever the client sends; fractional quantities round to a minor unit
    const frac = await http
      .post(`/v1/farms/${farmId}/sales`)
      .set(auth(token))
      .send({ id: randomUUID(), product: 'fumier', quantity: 2.5, unit: 'sac', unit_price: { amount_minor: 1001, currency: 'XAF' }, amount: { amount_minor: 1, currency: 'XAF' }, sale_date: today })
      .expect(201);
    expect(frac.body.amount).toEqual({ amount_minor: 2503, currency: 'XAF' });
  });

  it('EF-VEN-01 RG-MDD-06: a sale in another currency than the farm is refused, as are unknown products and payments', async () => {
    const r = await http
      .post(`/v1/farms/${farmId}/sales`)
      .set(auth(token))
      .send({ id: randomUUID(), product: 'licorne', quantity: 1, unit: 'tonne', unit_price: { amount_minor: 100, currency: 'EUR' }, payment: 'troc', sale_date: today })
      .expect(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['payment', 'product', 'unit', 'unit_price.currency']);
  });

  it('T-20 RG-VEN-02 EF-VAC-05: an egg sale is refused during the withdrawal period, with its end date', async () => {
    const until = addDays(today, 7);
    await http
      .post('/v1/health-events')
      .set(auth(token))
      .send({ id: randomUUID(), subject_type: 'batch', subject_id: batchId, event_type: 'traitement', event_date: today, product: 'Oxytetracycline', withdrawal_eggs_until: until })
      .expect(201);
    const sale = (day: string, product = 'oeufs_plateau') =>
      http
        .post(`/v1/farms/${farmId}/sales`)
        .set(auth(token))
        .send({ id: randomUUID(), product, quantity: 10, unit: 'plateau', unit_price: { amount_minor: 2500, currency: 'XAF' }, sale_date: day, subject_type: 'batch', subject_id: batchId });
    const refused = await sale(addDays(today, 3)).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'BUSINESS_RULE', details: { rule: 'RG-VEN-02', until } });
    expect(refused.body.error.message).toContain(until);
    await sale(addDays(today, 8)).expect(201); // after the withdrawal
    await sale(addDays(today, 3), 'fumier').expect(201); // a product not concerned by eggs
  });

  it('RG-JOU-02 RG-CHE-01: cumulative mortality = sum of deaths / initial count, and the live count follows', async () => {
    const day = (n: number, mortality: number) =>
      http.post(`/v1/farms/${farmId}/daily-logs`).set(auth(token)).send({ id: randomUUID(), subject_type: 'batch', subject_id: batchId, log_date: addDays(today, -n), mortality, eggs: 150 });
    await day(2, 4).expect(201);
    await day(1, 6).expect(201);
    const b = await http.get(`/v1/batches/${batchId}`).set(auth(token)).expect(200);
    expect(b.body).toMatchObject({ initial_count: 200, mortality_total: 10, current_count: 190, mortality_pct: 5 });
  });

  it('T-21 EF-DEP-01 RG-MDD-06: expenses are whole minor units; a foreign currency is refused', async () => {
    const ok = await http
      .post(`/v1/farms/${farmId}/expenses`)
      .set(auth(token))
      .send({ id: randomUUID(), category: 'aliment', amount: { amount_minor: 125050, currency: 'XAF' }, payment_method: 'especes', supplier: 'Provenderie', expense_date: today, subject_type: 'batch', subject_id: batchId })
      .expect(201);
    expect(ok.body.amount).toEqual({ amount_minor: 125050, currency: 'XAF' });
    const cdf = await http
      .post(`/v1/farms/${farmId}/expenses`)
      .set(auth(token))
      .send({ id: randomUUID(), category: 'aliment', amount: { amount_minor: 125050, currency: 'CDF' }, expense_date: today })
      .expect(422);
    expect(cdf.body.error.fields['amount.currency']).toContain('XAF');
    await http.post(`/v1/farms/${farmId}/expenses`).set(auth(token)).send({ id: randomUUID(), category: 'autre', amount: { amount_minor: 12.5, currency: 'XAF' }, expense_date: today }).expect(422);
    const list = await http.get(`/v1/farms/${farmId}/expenses`).set(auth(token)).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('EF-KPI-01: KPIs per batch and the month margin (revenue - expenses) in the farm currency', async () => {
    const k = await http.get(`/v1/farms/${farmId}/kpis?period=30d`).set(auth(token)).expect(200);
    expect(k.body.margin).toMatchObject({ revenue: { currency: 'XAF' }, expenses: { amount_minor: 125050, currency: 'XAF' } });
    expect(k.body.margin.margin.amount_minor).toBe(k.body.margin.revenue.amount_minor - k.body.margin.expenses.amount_minor);
    expect(Array.isArray(k.body.kpis)).toBe(true);
    await http.get(`/v1/farms/${farmId}/kpis?period=1y`).set(auth(token)).expect(422);
  });

  it('T-31 EF-TAC-01: ticking a weekly task creates the next occurrence 7 days later', async () => {
    const id = randomUUID();
    await http.post(`/v1/farms/${farmId}/tasks`).set(auth(token)).send({ id, title: 'Pesee hebdomadaire', category: 'pesee', due_date: today, recurrence: 'FREQ=WEEKLY;INTERVAL=1', subject_type: 'batch', subject_id: batchId }).expect(201);
    const done = await http.post(`/v1/tasks/${id}/done`).set(auth(token)).expect(200);
    expect(done.body.task.status).toBe('fait');
    expect(done.body.next).toMatchObject({ title: 'Pesee hebdomadaire', due_date: addDays(today, 7), status: 'a_faire', recurrence: 'FREQ=WEEKLY;INTERVAL=1' });
    // ticking twice does not multiply the occurrences
    const again = await http.post(`/v1/tasks/${id}/done`).set(auth(token)).expect(200);
    expect(again.body.next).toBeNull();
    const open = await http.get(`/v1/farms/${farmId}/tasks?status=a_faire`).set(auth(token)).expect(200);
    expect(open.body.data).toHaveLength(1);
    await http.post(`/v1/farms/${farmId}/tasks`).set(auth(token)).send({ id: randomUUID(), title: 'x', category: 'danse', due_date: today }).expect(422);
  });

  it('EF-CHE-01: a batch can be read, modified (full body), archived; the archive is a soft delete', async () => {
    const id = randomUUID();
    await http.post(`/v1/farms/${farmId}/batches`).set(auth(token)).send({ id, name: 'Chair 2', production_type: 'chair', start_date: addDays(today, -3), initial_count: 100 }).expect(201);
    const read = await http.get(`/v1/batches/${id}`).set(auth(token)).expect(200);
    const patched = await http
      .patch(`/v1/batches/${id}`)
      .set(auth(token))
      .send({ name: 'Chair 2 (renomme)', start_date: read.body.start_date, initial_count: read.body.initial_count })
      .expect(200);
    expect(patched.body.name).toBe('Chair 2 (renomme)');
    await http.delete(`/v1/batches/${id}`).set(auth(token)).expect(204);
    await http.get(`/v1/batches/${id}`).set(auth(token)).expect(404);
    const list = await http.get(`/v1/farms/${farmId}/batches`).set(auth(token)).expect(200);
    expect(list.body.data.map((b: any) => b.id)).not.toContain(id);
  });

  // DEFECT D-QA-02 (docs/plan/requests.md): PATCH is not partial. DTO classes emit own `undefined` fields, and
  // `{ ...serializeBatch(existing), ...clean }` in livestock.service.ts lets them override the stored start_date /
  // initial_count, so renaming a batch answers 422. `it.failing` passes while the defect exists and turns red
  // as soon as it is fixed: then replace `it.failing` by `it`.
  it.failing('EF-CHE-01: PATCH /batches/:id with only the changed field (partial update) answers 200', async () => {
    const id = randomUUID();
    await http.post(`/v1/farms/${farmId}/batches`).set(auth(token)).send({ id, name: 'Chair 3', production_type: 'chair', start_date: addDays(today, -3), initial_count: 100 }).expect(201);
    const patched = await http.patch(`/v1/batches/${id}`).set(auth(token)).send({ name: 'Chair 3 (renomme)' }).expect(200);
    expect(patched.body).toMatchObject({ name: 'Chair 3 (renomme)', initial_count: 100 });
  });
});

describe('recette MVP — authentification, portee, consentements, donnees personnelles', () => {
  it('RG-AUT-01 EF-AUT-01: 5 wrong codes lock the OTP for 15 minutes, even with the right code', async () => {
    const phone = '+237690010002';
    const r1 = await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    for (let i = 0; i < 5; i++) {
      const wrong = r1.body.dev_code === '000000' ? '111111' : '000000';
      await http.post('/v1/auth/otp/verify').send({ phone, code: wrong }).expect(401);
    }
    const locked = await http.post('/v1/auth/otp/verify').send({ phone, code: r1.body.dev_code }).expect(429);
    expect(locked.body.error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('RG-AUT-01: an OTP older than 10 minutes is refused', async () => {
    const phone = '+237690010003';
    const r1 = await http.post('/v1/auth/otp/request').send({ phone }).expect(200);
    const ttl = await sql(`SELECT extract(epoch FROM (expires_at - now()))::float AS left_s FROM otp_codes WHERE phone = $1`, [phone]);
    expect(ttl).toHaveLength(1);
    expect(ttl[0].left_s).toBeGreaterThan(9 * 60);
    expect(ttl[0].left_s).toBeLessThanOrEqual(10 * 60);
    await sql(`UPDATE otp_codes SET expires_at = now() - interval '1 minute' WHERE phone = $1`, [phone]);
    await http.post('/v1/auth/otp/verify').send({ phone, code: r1.body.dev_code }).expect(401);
  });

  // DEFECT D-QA-01 (docs/plan/requests.md): auth.service.ts mergeProvisionalAccount runs
  // `UPDATE devices SET user_id = ...` but `devices` has no user_id column (it belongs to a farm), so the first login
  // with a provisional account answers 500. `it.failing` turns red once fixed: then replace it by `it`.
  it.failing('EF-AUT-02: an offline provisional account is attached at the first login and its farm follows', async () => {
    const provisional = randomUUID();
    const farmId = randomUUID();
    await sql(`INSERT INTO users (id, phone, account_status) VALUES ($1, $2, 'provisoire')`, [provisional, `+2376900${Math.floor(10000 + Math.random() * 89999)}`]);
    await sql(`INSERT INTO farms (id, owner_id, name, speculations, country, currency) VALUES ($1, $2, 'Ferme hors ligne', ARRAY['volaille'], 'CM', 'XAF')`, [farmId, provisional]);
    const s = await login('+237690010004', provisional);
    const farms = await http.get('/v1/farms').set(auth(s.token)).expect(200);
    expect(farms.body.data.map((f: any) => f.id)).toEqual([farmId]);
    const gone = await sql(`SELECT account_status FROM users WHERE id = $1`, [provisional]);
    expect(gone[0].account_status).toBe('fusionne');
  });

  it('EF-AUT-04: a user cannot read, write or list the farm of someone else (scope), and anonymous calls are refused', async () => {
    const owner = await login('+237690010005');
    const intruder = await login('+237690010006');
    const farmId = randomUUID();
    await http.post('/v1/farms').set(auth(owner.token)).send({ id: farmId, name: 'Privee', speculations: ['volaille'], country: 'CM' }).expect(201);
    for (const path of [`/v1/farms/${farmId}`, `/v1/farms/${farmId}/batches`, `/v1/farms/${farmId}/stock-summary`, `/v1/farms/${farmId}/sales`]) {
      const r = await http.get(path).set(auth(intruder.token));
      expect([403, 404]).toContain(r.status);
    }
    const w = await http.post(`/v1/farms/${farmId}/expenses`).set(auth(intruder.token)).send({ id: randomUUID(), category: 'aliment', amount: { amount_minor: 1, currency: 'XAF' }, expense_date: today });
    expect([403, 404]).toContain(w.status);
    expect((await http.get('/v1/farms').set(auth(intruder.token)).expect(200)).body.data).toEqual([]);
    await http.get(`/v1/farms/${farmId}`).expect(401);
  });

  it('EF-CON-01 EF-CON-02 RG-CON-01: consents are versioned, timestamped, separate per scope and revocable', async () => {
    const { token } = await login('+237690010007');
    const post = (scope: string, granted: boolean, version = '2026-10') => http.post('/v1/me/consents').set(auth(token)).send({ scope, granted, text_version: version });
    await post('cgu_confidentialite', true).expect(201);
    await post('surveillance_agregats', true).expect(201);
    const revoked = await post('surveillance_agregats', false, '2026-11').expect(201);
    expect(revoked.body).toMatchObject({ scope: 'surveillance_agregats', granted: false, text_version: '2026-11' });
    expect(revoked.body.revoked_at).toBeTruthy();
    const list = await http.get('/v1/me/consents').set(auth(token)).expect(200);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data.find((c: any) => c.scope === 'cgu_confidentialite')).toMatchObject({ granted: true, text_version: '2026-10', revoked_at: null });
    expect(list.body.data.every((c: any) => c.granted_at)).toBe(true);
    await post('partage_inconnu', true).expect(422);
    await http.post('/v1/me/consents').set(auth(token)).send({ scope: 'messages_sms', granted: true }).expect(422);
  });

  it('T-25 EF-CON-03: the export contains the user data (JSON), as a request and as a direct download', async () => {
    const { token, user } = await login('+237690010008');
    const farmId = randomUUID();
    await http.post('/v1/farms').set(auth(token)).send({ id: farmId, name: 'Ferme export', speculations: ['volaille'], country: 'CM' }).expect(201);
    const req = await http.post('/v1/me/export').set(auth(token)).expect(202);
    expect(req.body).toMatchObject({ status: 'prete', export_uri: expect.stringContaining('.json') });
    const status = await http.get(`/v1/me/requests/${req.body.request_id}`).set(auth(token)).expect(200);
    expect(status.body).toMatchObject({ type: 'export', status: 'prete' });
    const dump = await http.get('/v1/me/export').set(auth(token)).expect(200);
    expect(dump.body.user).toMatchObject({ id: user.id, phone: '+237690010008' });
    expect(dump.body.farms.map((f: any) => f.id)).toEqual([farmId]);
    expect(dump.body.generated_at).toBeTruthy();
  });

  it('T-25 EF-CON-04: deletion is scheduled 30 days later and can be cancelled in the meantime', async () => {
    const { token } = await login('+237690010009');
    const del = await http.delete('/v1/me').set(auth(token)).send({}).expect(202);
    expect(del.body.status).toBe('recue');
    const days = (new Date(del.body.scheduled_for).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const cancelled = await http.post('/v1/me/delete/cancel').set(auth(token)).expect(200);
    expect(cancelled.body.status).toBe('annulee');
    await http.post('/v1/me/delete/cancel').set(auth(token)).expect(404); // nothing left to cancel
    const again = await http.delete('/v1/me').set(auth(token)).send({}).expect(202);
    await http.post(`/v1/me/requests/${again.body.request_id}/cancel`).set(auth(token)).expect(200);
    const twice = await http.post(`/v1/me/requests/${again.body.request_id}/cancel`).set(auth(token)).expect(422);
    expect(twice.body.error.code).toBe('BUSINESS_RULE');
  });
});

describe('recette MVP — integration (speculations, calendrier type)', () => {
  it('EF-ONB-01 EF-ONB-04: the speculations chosen drive the forms and the task calendar offered (nothing hard-coded)', async () => {
    const { token } = await login('+237690010013');
    const poultry = randomUUID();
    const dogs = randomUUID();
    await http.post('/v1/farms').set(auth(token)).send({ id: poultry, name: 'Volailles', speculations: ['volaille'], country: 'CM' }).expect(201);
    // Decouverte plan: one farm per account (quota), so the kennel belongs to another account.
    const second = await login('+237690010014');
    await http.post('/v1/farms').set(auth(token)).send({ id: randomUUID(), name: 'Seconde ferme', speculations: ['volaille'], country: 'CM' }).expect(429);
    await http.post('/v1/farms').set(auth(second.token)).send({ id: dogs, name: 'Chenil', speculations: ['chien'], country: 'CM' }).expect(201);
    const codes = async (farm: string, kind: string) => {
      const r = await http.get(`/v1/params/resolved?farm_id=${farm}&kind=${kind}`).set(auth(farm === dogs ? second.token : token));
      return r.status === 404 ? [] : Object.values(r.body.objects).map((o: any) => o.code);
    };
    const poultryTemplates = await codes(poultry, 'task_template');
    expect(poultryTemplates).toEqual(expect.arrayContaining(['nettoyage_abreuvoirs', 'pesee_hebdo_chair']));
    expect(await codes(dogs, 'task_template')).not.toContain('pesee_hebdo_chair');
    expect(await codes(poultry, 'form')).toContain('batch_volaille');
    expect(await codes(dogs, 'form')).not.toContain('batch_volaille');
    expect(await codes(dogs, 'form')).toContain('dog');
  });
});

describe('recette MVP — analytique, drapeaux, referentiels', () => {
  it('EF-ANA-01: usage events are pseudonymised (device hash, no user text) and refused once the user opted out', async () => {
    const { token, user } = await login('+237690010010');
    const ts = new Date().toISOString();
    const ok = await http
      .post('/v1/analytics/events')
      .set(auth(token))
      .send({ device_id_hash: 'h-abc', events: [{ name: 'screen_view', ts, props: { screen: 'E05' } }, { name: 'reminder_confirmed', ts }] })
      .expect(202);
    expect(ok.body).toEqual({ accepted: 2 });
    const rows = await sql(`SELECT name, device_id_hash, props FROM analytics_events WHERE device_id_hash = 'h-abc' ORDER BY name DESC`);
    expect(rows).toEqual([
      { name: 'screen_view', device_id_hash: 'h-abc', props: { screen: 'E05' } },
      { name: 'reminder_confirmed', device_id_hash: 'h-abc', props: {} },
    ]);
    await http.post('/v1/analytics/events').set(auth(token)).send({ events: [{ ts }] }).expect(422);
    await sql(`UPDATE users SET analytics_opt_out = true WHERE id = $1`, [user.id]);
    const refused = await http.post('/v1/analytics/events').set(auth(token)).send({ events: [{ name: 'screen_view', ts }] }).expect(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    expect(await sql(`SELECT 1 FROM analytics_events WHERE user_id = $1`, [user.id])).toHaveLength(2);
  });

  it('EF-ANA-04: feature flags are resolved per user (country, plan, cohort) and returned as booleans', async () => {
    const { token } = await login('+237690010011');
    const f = await http.get('/v1/feature-flags').set(auth(token)).expect(200);
    expect(Object.keys(f.body.flags).length).toBeGreaterThan(0);
    expect(Object.values(f.body.flags).every((v) => typeof v === 'boolean')).toBe(true);
    await http.get('/v1/feature-flags').expect(401);
  });

  it('T-34 RG-ABO-01 EF-ABO-02: an expired Pro subscription keeps its modules 7 days (grace), then falls back; data stays', async () => {
    const { token, user } = await login('+237690010015');
    const farmId = randomUUID();
    await http.post('/v1/farms').set(auth(token)).send({ id: farmId, name: 'Ferme grace', speculations: ['volaille'], country: 'CM' }).expect(201);
    const setExpiry = (daysAgo: number, graceDays: number) =>
      sql(
        `INSERT INTO subscriptions (account_type, account_id, plan, period, status, started_at, expires_at, grace_until)
         VALUES ('user', $1, 'pro', 'mensuel', 'actif', now() - interval '40 days', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval + ($3 || ' days')::interval)
         ON CONFLICT (account_type, account_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, grace_until = EXCLUDED.grace_until`,
        [user.id, String(daysAgo), String(graceDays)],
      );
    await setExpiry(3, 7); // expired 3 days ago, 4 days of grace left
    const inGrace = (await http.get('/v1/me').set(auth(token)).expect(200)).body.entitlements;
    expect(inGrace).toMatchObject({ plan: 'pro', status: 'grace' });
    expect(inGrace.features).toContain('certificat_qr');
    await setExpiry(8, 7); // expired 8 days ago, grace over
    const after = (await http.get('/v1/me').set(auth(token)).expect(200)).body.entitlements;
    expect(after.plan).toBe('decouverte');
    expect(after.features).not.toContain('certificat_qr');
    // the data is never deleted for non payment
    await http.get(`/v1/farms/${farmId}`).set(auth(token)).expect(200);
  });

  it('EF-ABO-02 EF-ABO-01: the catalogue prices are integers in minor units with a currency, never floats', async () => {
    const plans = await http.get('/v1/plans?country=CM').expect(200);
    const pro = plans.body.data.find((p: any) => p.code === 'pro');
    expect(Number.isInteger(pro.price.monthly.amount_minor)).toBe(true);
    expect(pro.price.monthly.currency).toMatch(/^[A-Z]{3}$/);
    const { token } = await login('+237690010012');
    const me = await http.get('/v1/me').set(auth(token)).expect(200);
    expect(me.body.entitlements).toMatchObject({ plan: 'decouverte', token: expect.any(String) });
    expect(me.body.entitlements.features).not.toContain('certificat_qr');
  });
});
