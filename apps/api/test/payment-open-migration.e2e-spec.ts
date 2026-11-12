/**
 * EF-ABO-01, PAY-OPEN: migration 1761500000005 (partial unique index on open payments) is reversible
 * (up, down, up), refuses to run over duplicates instead of changing money statuses, and the index
 * holds whatever the code path. Contract: the 409 PAY-OPEN answer is documented in openapi.json.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { OPENAPI, response } from './openapi-contract';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm_test';

let db: Client;
let ds: DataSource;

const indexExists = async () => (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'payments_open_payer_plan_uq'`)).rows.length === 1;
const insert = (payer: string, status: string, plan = 'pro') =>
  db.query(`INSERT INTO payments (id, payer_type, payer_id, plan, amount_minor, currency, method, status) VALUES ($1, 'user', $2, $3, 2500, 'XAF', 'orange_money', $4)`, [
    randomUUID(),
    payer,
    plan,
    status,
  ]);

beforeAll(async () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { createDataSource, runMigrations } = require('../src/database/data-source');
  /* eslint-enable @typescript-eslint/no-var-requires */
  db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(TEST_DB);
  ds = createDataSource(TEST_DB);
  await ds.initialize();
});

afterAll(async () => {
  await ds?.destroy();
  await db?.end();
});

describe('EF-ABO-01 PAY-OPEN: migration and contract', () => {
  it('migration PaymentOpenGuard: up, down, up', async () => {
    expect(await indexExists()).toBe(true);
    await ds.undoLastMigration({ transaction: 'each' });
    expect(await indexExists()).toBe(false);
    const done = await ds.runMigrations({ transaction: 'each' });
    expect(done.map((m) => m.name)).toEqual(['PaymentOpenGuard1761500000005']);
    expect(await indexExists()).toBe(true);
  });

  it('the index refuses a second open payment of the same payer and plan, and only that', async () => {
    const payer = randomUUID();
    await insert(payer, 'en_attente');
    await expect(insert(payer, 'initie')).rejects.toThrow(/payments_open_payer_plan_uq/);
    await expect(insert(payer, 'a_verifier')).rejects.toThrow(/payments_open_payer_plan_uq/);
    await insert(payer, 'echoue');
    await insert(payer, 'confirme');
    await insert(payer, 'initie', 'structure');
    await insert(randomUUID(), 'initie');
  });

  it('up stops on existing duplicates, lists them, and changes no payment', async () => {
    await ds.undoLastMigration({ transaction: 'each' });
    const payer = randomUUID();
    await insert(payer, 'en_attente');
    await insert(payer, 'a_verifier');
    await expect(ds.runMigrations({ transaction: 'each' })).rejects.toThrow(new RegExp(`plusieurs paiements ouverts.*${payer}`));
    expect(await indexExists()).toBe(false);
    const rows = await db.query(`SELECT status FROM payments WHERE payer_id = $1 ORDER BY status`, [payer]);
    expect(rows.rows.map((r) => r.status)).toEqual(['a_verifier', 'en_attente']);
    // The operator settles one of them, then the migration passes.
    await db.query(`UPDATE payments SET status = 'echoue' WHERE payer_id = $1 AND status = 'en_attente'`, [payer]);
    await ds.runMigrations({ transaction: 'each' });
    expect(await indexExists()).toBe(true);
  });

  it('contract: checkout documents 409 PAY-OPEN with payment_id and status; payment views carry the event journal', () => {
    const conflict = OPENAPI.components.schemas.CheckoutConflictDetailView;
    expect(response('/v1/subscriptions/checkout', 'post', '409')).toEqual({ $ref: '#/components/schemas/CheckoutConflictView' });
    expect(conflict.required).toEqual(expect.arrayContaining(['code', 'message', 'details']));
    const details = OPENAPI.components.schemas.PayOpenDetailsView;
    expect(details.properties?.rule.enum).toContain('PAY-OPEN');
    expect(Object.keys(details.properties ?? {})).toEqual(expect.arrayContaining(['payment_id', 'status']));
    expect(details.properties?.status.enum).toEqual(['initie', 'en_attente', 'a_verifier']);
    const event = OPENAPI.components.schemas.PaymentEventView;
    expect(Object.keys(event.properties ?? {}).sort()).toEqual(['at', 'source', 'status']);
    expect(OPENAPI.components.schemas.PaymentView.required).toContain('events');
    // Every payment endpoint has a response schema (no more `{"description": ""}`).
    const routes: Array<[string, string, string]> = [
      ['/v1/plans', 'get', '200'],
      ['/v1/subscriptions/checkout', 'post', '201'],
      ['/v1/payments/{id}', 'get', '200'],
      ['/v1/admin/payments', 'get', '200'],
      ['/v1/admin/payments/{id}', 'get', '200'],
      ['/v1/admin/payments/{id}/check', 'post', '200'],
      ['/v1/admin/payments/{id}/refund', 'post', '200'],
      ['/v1/admin/payments/reconciliations', 'get', '200'],
      ['/v1/admin/payments/reconciliations', 'post', '200'],
    ];
    for (const [path, method, status] of routes) expect(() => response(path, method, status)).not.toThrow();
  });
});
