import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional PostGIS step: when the extension is available (production image postgis/postgis:16-3.4),
 * enables it and adds a generated geography column on farms. Without PostGIS this is a no-op:
 * lat/lng remain plain numeric columns.
 */
export class OptionalPostgis1761500000001 implements MigrationInterface {
  name = 'OptionalPostgis1761500000001';

  public async up(q: QueryRunner): Promise<void> {
    const rows: Array<{ n: number }> = await q.query(`SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = 'postgis'`);
    if (!rows[0] || rows[0].n === 0) return;
    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await q.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS geog geography(Point, 4326)
      GENERATED ALWAYS AS (
        CASE WHEN gps_lat IS NOT NULL AND gps_lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(gps_lng::float8, gps_lat::float8), 4326)::geography END
      ) STORED`);
    await q.query(`CREATE INDEX IF NOT EXISTS farms_geog_gist ON farms USING gist (geog)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const rows: Array<{ n: number }> = await q.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'farms' AND column_name = 'geog'`,
    );
    if (rows[0]?.n) await q.query(`ALTER TABLE farms DROP COLUMN geog`);
  }
}
