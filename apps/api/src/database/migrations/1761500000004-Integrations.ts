import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P1.1 / P1.2 integrations (ADR-002, revue M5, M6, m5):
 * - ussd_sessions: USSD session state when Redis is not configured (expires after a few minutes);
 * - outbound_messages.provider: delivery reports are matched per provider and channel;
 * - payment_reconciliations: daily provider ↔ database report;
 * - index for the pending-payment poller.
 * Reversible: down drops only what up created (no business data in these objects).
 */
export class Integrations1761500000004 implements MigrationInterface {
  name = 'Integrations1761500000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ussd_sessions (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      expires_at timestamptz NOT NULL
    )`);
    await q.query(`CREATE INDEX ussd_sessions_expires_idx ON ussd_sessions (expires_at)`);
    await q.query(`ALTER TABLE outbound_messages ADD COLUMN provider text`);
    await q.query(`CREATE INDEX outbound_messages_provider_ref_idx ON outbound_messages (provider_ref)`);
    await q.query(`CREATE TABLE payment_reconciliations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      day date NOT NULL,
      report jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payment_reconciliations_day_uq UNIQUE (day)
    )`);
    await q.query(`CREATE INDEX payments_status_created_idx ON payments (status, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS payments_status_created_idx`);
    await q.query(`DROP TABLE IF EXISTS payment_reconciliations`);
    await q.query(`DROP INDEX IF EXISTS outbound_messages_provider_ref_idx`);
    await q.query(`ALTER TABLE outbound_messages DROP COLUMN IF EXISTS provider`);
    await q.query(`DROP TABLE IF EXISTS ussd_sessions`);
  }
}
