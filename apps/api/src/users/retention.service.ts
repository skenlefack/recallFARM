import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

/**
 * Nightly job: purge expired deletion requests and anonymize old outbound logs.
 * Runs daily at 03:00.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly ds: DataSource) {}

  @Cron('0 3 * * *')
  async run() {
    await this.purgeExpiredDeletions();
    await this.anonymizeOldLogs();
  }

  /** Process account deletion requests whose 30-day withdrawal period has elapsed. */
  async purgeExpiredDeletions(): Promise<number> {
    const requests: Array<{ id: string; user_id: string }> = await this.ds.query(
      `SELECT id, user_id FROM account_requests WHERE type = 'suppression' AND status = 'recue' AND scheduled_for < now()`,
    );

    for (const req of requests) {
      await this.ds.transaction(async (em) => {
        // Soft-delete user
        await em.query(`UPDATE users SET deleted_at = now(), account_status = 'cloture' WHERE id = $1`, [req.user_id]);

        // Soft-delete user's farms and all farm-dependent data
        const farms: Array<{ id: string }> = await em.query(`SELECT id FROM farms WHERE owner_id = $1 AND deleted_at IS NULL`, [req.user_id]);
        const farmIds = farms.map((f) => f.id);

        if (farmIds.length) {
          for (const table of ['batches', 'dogs', 'animals', 'daily_logs', 'health_events', 'reminders', 'tasks', 'stock_movements', 'products_sales', 'expenses']) {
            await em.query(`UPDATE ${table} SET deleted_at = now() WHERE farm_id = ANY($1) AND deleted_at IS NULL`, [farmIds]);
          }
          await em.query(`UPDATE farms SET deleted_at = now() WHERE id = ANY($1) AND deleted_at IS NULL`, [farmIds]);
        }

        // Soft-delete consents
        await em.query(`UPDATE consents SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.user_id]);

        // Mark request as completed
        await em.query(`UPDATE account_requests SET status = 'executee', completed_at = now() WHERE id = $1`, [req.id]);
      });
    }

    this.logger.log(`purgeExpiredDeletions: ${requests.length} account(s) purged`);
    return requests.length;
  }

  /** Anonymize outbound messages older than 3 years (RGPD retention limit for messaging). */
  async anonymizeOldLogs(): Promise<number> {
    const result = await this.ds.query(
      `UPDATE outbound_messages SET recipient_phone = '***', body = NULL WHERE queued_at < now() - interval '3 years' AND recipient_phone <> '***'`,
    );
    const count = typeof result === 'number' ? result : (result as [unknown, number])?.[1] ?? 0;
    this.logger.log(`anonymizeOldLogs: ${count} message(s) anonymized`);
    return count;
  }
}
