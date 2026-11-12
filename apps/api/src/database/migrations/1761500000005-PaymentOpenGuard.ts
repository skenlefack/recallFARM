import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EF-ABO-01, PAY-OPEN: at most one open subscription payment (initie, en_attente, a_verifier) per payer
 * and plan. The partial unique index is the guard against double debits under concurrent checkouts
 * (BillingService.checkout inserts with ON CONFLICT DO NOTHING and answers 409 PAY-OPEN).
 * The status list must stay equal to OPEN_PAYMENT_STATUSES (billing.service.ts).
 *
 * Existing duplicates are never changed by the migration (money statuses are decided by the aggregator
 * or an operator): up stops with the list of payments to settle first (runbook: apps/api/README.md, « PAY-OPEN »).
 * Reversible: down drops only the index.
 */
export class PaymentOpenGuard1761500000005 implements MigrationInterface {
  name = 'PaymentOpenGuard1761500000005';

  public async up(q: QueryRunner): Promise<void> {
    const dup: Array<{ payer_type: string; payer_id: string; plan: string; ids: string[] }> = await q.query(
      `SELECT payer_type, payer_id, plan, array_agg(id::text ORDER BY created_at) AS ids FROM payments
        WHERE purpose = 'abonnement' AND status IN ('initie', 'en_attente', 'a_verifier')
        GROUP BY payer_type, payer_id, plan HAVING count(*) > 1`,
    );
    if (dup.length) {
      const list = dup.map((d) => `${d.payer_type}:${d.payer_id} ${d.plan} -> ${d.ids.join(', ')}`).join(' ; ');
      throw new Error(
        `PaymentOpenGuard : ${dup.length} payeur(s) ont plusieurs paiements ouverts pour la meme formule. ` +
          `Les faire aboutir (POST /v1/admin/payments/:id/check) avant de relancer la migration : ${list}`,
      );
    }
    await q.query(
      `CREATE UNIQUE INDEX payments_open_payer_plan_uq ON payments (payer_type, payer_id, plan)
        WHERE purpose = 'abonnement' AND status IN ('initie', 'en_attente', 'a_verifier')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS payments_open_payer_plan_uq`);
  }
}
