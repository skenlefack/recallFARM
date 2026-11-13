/**
 * EF-ABO-01, PAY-OPEN: migration 1761500000005 (partial unique index: one open subscription payment per
 * payer, any plan) is reversible
 * (up, down, up), refuses to run over duplicates instead of changing money statuses, and the index
 * holds whatever the code path. Contract: the 409 PAY-OPEN answer is documented in openapi.json.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { OPEN_PAYMENT_STATUSES } from '../src/billing/billing.service';
import { OPENAPI, response } from './openapi-contract';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm_test';

let db: Client;
let ds: DataSource;

const indexExists = async () => (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'payments_open_payer_uq'`)).rows.length === 1;
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

  it('the index refuses a second open subscription payment of the same payer, whatever the plan, and only that', async () => {
    const payer = randomUUID();
    await insert(payer, 'en_attente');
    await expect(insert(payer, 'initie')).rejects.toThrow(/payments_open_payer_uq/);
    await expect(insert(payer, 'a_verifier')).rejects.toThrow(/payments_open_payer_uq/);
    await expect(insert(payer, 'initie', 'structure')).rejects.toThrow(/payments_open_payer_uq/);
    await insert(payer, 'echoue');
    await insert(payer, 'confirme', 'structure');
    await insert(randomUUID(), 'initie');
  });

  it('the index predicate lists exactly OPEN_PAYMENT_STATUSES (code and base cannot drift apart)', async () => {
    const def = (await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'payments_open_payer_uq'`)).rows[0].indexdef as string;
    expect(def).toMatch(/\(payer_type, payer_id\)/);
    expect(def).toMatch(/purpose = 'abonnement'/);
    const inList = /status = ANY \(?\(?ARRAY\[(.*?)\]/.exec(def)?.[1] ?? '';
    const statuses = [...inList.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(statuses.sort()).toEqual([...OPEN_PAYMENT_STATUSES].sort());
  });

  it('up stops on existing duplicates (two plans included), lists them, and changes no payment', async () => {
    await ds.undoLastMigration({ transaction: 'each' });
    const payer = randomUUID();
    await insert(payer, 'en_attente');
    await insert(payer, 'a_verifier', 'structure');
    await expect(ds.runMigrations({ transaction: 'each' })).rejects.toThrow(new RegExp(`plusieurs paiements d'abonnement ouverts.*${payer}.*\\(pro, en_attente\\).*\\(structure, a_verifier\\)`));
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
    expect(details.properties?.status.enum).toEqual(OPEN_PAYMENT_STATUSES);
    expect(Object.keys(details.properties ?? {})).toContain('plan');
    expect(details.properties?.rule.enum).toContain('PAY-RETRY');
    // Operator decision: platform_admin, body {outcome, reason}, 403 and 409 documented.
    const resolve = OPENAPI.paths['/v1/admin/payments/{id}/resolve'].post.responses;
    expect(Object.keys(resolve).sort()).toEqual(['200', '403', '409']);
    expect(OPENAPI.components.schemas.ResolveDto.required?.sort()).toEqual(['outcome', 'reason']);
    const event = OPENAPI.components.schemas.PaymentEventView;
    expect(Object.keys(event.properties ?? {}).sort()).toEqual(['at', 'detail', 'ignored', 'reason', 'source', 'status']);
    expect(event.required?.sort()).toEqual(['at', 'source', 'status']);
    expect(event.properties?.source.enum).toEqual(['webhook', 'statut', 'operateur', 'client']);
    expect(event.properties?.reason.enum).toEqual(['montant', 'devise']);
    // PAY-RECENT: documented with the payment, the plan and the date; confirm_repeat in the request.
    expect(details.properties?.rule.enum).toContain('PAY-RECENT');
    expect(details.properties?.paid_at).toMatchObject({ format: 'date-time' });
    expect(OPENAPI.components.schemas.CheckoutDto.properties?.confirm_repeat).toMatchObject({ type: 'string', format: 'uuid' });
    expect(Object.keys(OPENAPI.paths['/v1/admin/payments/{id}/reviewed'].post.responses).sort()).toEqual(['200', '403', '409']);
    expect(OPENAPI.components.schemas.ReviewedDto.required).toEqual(['reason']);
    expect(OPENAPI.components.schemas.AdminPaymentView.required).toContain('needs_review');
    // {id} of the payment routes are documented as UUIDs; /subscriptions/current has a schema (price nullable).
    const paths = OPENAPI.paths as unknown as Record<string, Record<string, { parameters?: Array<{ name: string; in: string; schema?: { format?: string } }> }>>;
    for (const [path, method] of [['/v1/payments/{id}', 'get'], ['/v1/admin/payments/{id}', 'get'], ['/v1/admin/payments/{id}/check', 'post'], ['/v1/admin/payments/{id}/resolve', 'post'], ['/v1/admin/payments/{id}/reviewed', 'post'], ['/v1/admin/payments/{id}/refund', 'post']]) {
      expect(paths[path][method].parameters?.find((x) => x.name === 'id' && x.in === 'path')?.schema?.format).toBe('uuid');
    }
    expect(response('/v1/subscriptions/current', 'get', '200')).toEqual({ $ref: '#/components/schemas/CurrentSubscriptionView' });
    expect(OPENAPI.components.schemas.CurrentSubscriptionView.properties?.price.oneOf).toEqual([{ $ref: '#/components/schemas/MoneyView' }, { type: 'null' }]);
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
      ['/v1/admin/payments/{id}/resolve', 'post', '200'],
      ['/v1/admin/payments/reconciliations', 'get', '200'],
      ['/v1/admin/payments/reconciliations', 'post', '200'],
    ];
    for (const [path, method, status] of routes) expect(() => response(path, method, status)).not.toThrow();
  });
});
