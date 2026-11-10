import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly ds: DataSource) {}

  @Cron('0 3 * * *')
  async aggregate() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    await this.computeActiveUsersDaily(dateStr);
    await this.computeRemindersConfirmedRate(dateStr);
    await this.computeRemindersLate(dateStr);

    this.logger.log(`Daily aggregation completed for ${dateStr}`);
  }

  private async upsertMetric(date: string, metric: string, value: number, dimension?: string, dimensionValue?: string) {
    await this.ds.query(
      `INSERT INTO analytics_daily (id, date, metric, value, dimension, dimension_value, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
       ON CONFLICT DO NOTHING`,
      [date, metric, value, dimension ?? null, dimensionValue ?? null],
    );
  }

  private async computeActiveUsersDaily(date: string) {
    const rows: Array<{ count: string }> = await this.ds.query(
      `SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events WHERE ts::date = $1`,
      [date],
    );
    const count = parseInt(rows[0]?.count ?? '0', 10);
    await this.upsertMetric(date, 'active_users_daily', count);
    this.logger.debug(`active_users_daily(${date}) = ${count}`);
  }

  private async computeRemindersConfirmedRate(date: string) {
    const rows: Array<{ total: string; confirmed: string }> = await this.ds.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'confirme') AS confirmed
       FROM reminders WHERE due_date = $1 AND deleted_at IS NULL`,
      [date],
    );
    const total = parseInt(rows[0]?.total ?? '0', 10);
    const confirmed = parseInt(rows[0]?.confirmed ?? '0', 10);
    const rate = total > 0 ? confirmed / total : 0;
    await this.upsertMetric(date, 'reminders_confirmed_rate', parseFloat(rate.toFixed(4)));
    this.logger.debug(`reminders_confirmed_rate(${date}) = ${rate.toFixed(4)} (${confirmed}/${total})`);
  }

  private async computeRemindersLate(date: string) {
    const rows: Array<{ count: string }> = await this.ds.query(
      `SELECT COUNT(*) AS count FROM reminders WHERE due_date < $1 AND status IN ('a_venir','envoye') AND deleted_at IS NULL`,
      [date],
    );
    const count = parseInt(rows[0]?.count ?? '0', 10);
    await this.upsertMetric(date, 'reminders_late', count);
    this.logger.debug(`reminders_late(${date}) = ${count}`);
  }

  /** Query aggregated metrics for admin dashboard. */
  async dashboard(from: string, to: string) {
    const rows = await this.ds.query(
      `SELECT date, metric, value, dimension, dimension_value FROM analytics_daily WHERE date >= $1 AND date <= $2 ORDER BY date, metric`,
      [from, to],
    );
    return { data: rows };
  }
}
