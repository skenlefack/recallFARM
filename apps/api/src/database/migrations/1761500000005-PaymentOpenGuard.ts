import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EF-ABO-01, PAY-OPEN: at most one open subscription payment (initie, en_attente, a_verifier) per payer,
 * whatever the plan (an account has one subscription: two open payments for two plans would debit the
 * payer twice). The partial unique index is the guard against double debits under concurrent checkouts
 * (BillingService.checkout inserts with ON CONFLICT DO NOTHING and answers 409 PAY-OPEN).
 * The status list must stay equal to OPEN_PAYMENT_STATUSES (billing.service.ts; compared with
 * pg_indexes by test/payment-open-migration.e2e-spec.ts).
 *
 * Existing duplicates are never changed by the migration (money statuses are decided by the aggregator
 * or an operator): up stops with the list of payments to settle first (runbook: apps/api/README.md,
 * « PAY-OPEN »). The table is locked against writes between the duplicate check and the index creation,
 * so no duplicate can slip in meanwhile. Reversible: down drops only the index.
 */
export class PaymentOpenGuard1761500000005 implements MigrationInterface {
  name = 'PaymentOpenGuard1761500000005';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`LOCK TABLE payments IN SHARE ROW EXCLUSIVE MODE`);
    const dup: Array<{ payer_type: string; payer_id: string; ids: string[] }> = await q.query(
      `SELECT payer_type, payer_id, array_agg(id::text || ' (' || COALESCE(plan, '-') || ', ' || status || ')' ORDER BY created_at) AS ids FROM payments
        WHERE purpose = 'abonnement' AND status IN ('initie', 'en_attente', 'a_verifier')
        GROUP BY payer_type, payer_id HAVING count(*) > 1`,
    );
    if (dup.length) {
      const list = dup.map((d) => `${d.payer_type}:${d.payer_id} -> ${d.ids.join(', ')}`).join(' ; ');
      throw new Error(
        `PaymentOpenGuard : ${dup.length} payeur(s) ont plusieurs paiements d'abonnement ouverts. ` +
          `Les trancher (POST /v1/admin/payments/:id/check, ou /resolve pour un paiement a_verifier) avant de relancer la migration : ${list}`,
      );
    }
    await q.query(
      `CREATE UNIQUE INDEX payments_open_payer_uq ON payments (payer_type, payer_id)
        WHERE purpose = 'abonnement' AND status IN ('initie', 'en_attente', 'a_verifier')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS payments_open_payer_uq`);
  }
}
