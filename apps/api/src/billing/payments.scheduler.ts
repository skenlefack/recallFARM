import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addDays, dateIn, timeIn } from '../common/dates';
import { KvService } from '../common/kv.service';
import { config } from '../config';
import { PaymentOpsService } from './payment-ops.service';

/**
 * Payment background jobs (M6, P1.2), each under a Redis lock when available:
 * - every minute: status queries for payments still pending (capped exponential backoff);
 * - every hour: yesterday's reconciliation, once the configured local time is passed (catches up after downtime).
 */
@Injectable()
export class PaymentsScheduler {
  private readonly logger = new Logger('PaymentsScheduler');

  constructor(
    private readonly kv: KvService,
    private readonly ops: PaymentOpsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'payments-status' })
  async statusTick(): Promise<void> {
    if (!config().schedulerEnabled) return;
    try {
      const r = await this.kv.withLock('scheduler:payments-status', 55_000, () => this.ops.pollPending());
      if (r && r.checked) this.logger.log(`paiements en attente : ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`interrogation des paiements impossible : ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'payments-reconciliation' })
  async reconciliationTick(now = new Date()): Promise<string | null> {
    if (!config().schedulerEnabled) return null;
    try {
      return (await this.kv.withLock('scheduler:payments-reconciliation', 30 * 60_000, () => this.reconcileIfDue(now))) ?? null;
    } catch (e) {
      this.logger.error(`rapprochement impossible : ${(e as Error).message}`);
      return null;
    }
  }

  /** Produces yesterday's report when the local time is past `paymentReconcileAt` and it does not exist yet. */
  async reconcileIfDue(now = new Date()): Promise<string | null> {
    const cfg = config();
    if (timeIn(now, cfg.tz) < cfg.paymentReconcileAt) return null;
    const day = addDays(dateIn(now, cfg.tz), -1);
    if (await this.ops.hasReport(day)) return null;
    await this.ops.reconcile(day);
    return day;
  }
}
