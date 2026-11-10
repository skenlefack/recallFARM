import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `location` geometry(Point, 4326) column on farms and a GIST index.
 * Backfills from existing gps_lat / gps_lng when PostGIS is available.
 * Falls back to a no-op when PostGIS is not installed (the generated `geog` column from migration 001 already covers the read path).
 */
export class PostgisLocation1761500000002 implements MigrationInterface {
  name = 'PostgisLocation1761500000002';

  public async up(q: QueryRunner): Promise<void> {
    const rows: Array<{ n: number }> = await q.query(
      `SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = 'postgis'`,
    );
    if (!rows[0] || rows[0].n === 0) return; // no PostGIS — skip gracefully

    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await q.query(`ALTER TABLE farms ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)`);

    // Backfill from existing lat/lng columns
    await q.query(`
      UPDATE farms
         SET location = ST_SetSRID(ST_MakePoint(gps_lng::float8, gps_lat::float8), 4326)
       WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL AND location IS NULL
    `);

    await q.query(`CREATE INDEX IF NOT EXISTS farms_location_gist ON farms USING gist (location)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const rows: Array<{ n: number }> = await q.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'farms' AND column_name = 'location'`,
    );
    if (rows[0]?.n) {
      await q.query(`DROP INDEX IF EXISTS farms_location_gist`);
      await q.query(`ALTER TABLE farms DROP COLUMN location`);
    }
  }
}
