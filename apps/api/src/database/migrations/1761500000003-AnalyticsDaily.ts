import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsDaily1761500000003 implements MigrationInterface {
  name = 'AnalyticsDaily1761500000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE analytics_daily (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      date date NOT NULL,
      metric varchar NOT NULL,
      value numeric NOT NULL,
      dimension varchar,
      dimension_value varchar,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE INDEX analytics_daily_date_metric_idx ON analytics_daily (date, metric)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS analytics_daily`);
  }
}
