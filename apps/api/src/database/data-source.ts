import { types } from 'pg';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { InitSchema1761500000000 } from './migrations/1761500000000-InitSchema';
import { OptionalPostgis1761500000001 } from './migrations/1761500000001-OptionalPostgis';
import { PostgisLocation1761500000002 } from './migrations/1761500000002-PostgisLocation';
import { AnalyticsDaily1761500000003 } from './migrations/1761500000003-AnalyticsDaily';
import { Integrations1761500000004 } from './migrations/1761500000004-Integrations';

// Keep business dates as 'YYYY-MM-DD' strings and return numerics/bigints as JS numbers.
types.setTypeParser(1082, (v: string) => v); // date
types.setTypeParser(20, (v: string) => Number(v)); // int8
types.setTypeParser(1700, (v: string) => Number(v)); // numeric

export const MIGRATIONS = [InitSchema1761500000000, OptionalPostgis1761500000001, PostgisLocation1761500000002, AnalyticsDaily1761500000003, Integrations1761500000004];

export function dataSourceOptions(url: string, extra: Partial<DataSourceOptions> = {}): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    installExtensions: false, // ids default to gen_random_uuid() (PostgreSQL 13+ core)
    migrationsRun: false,
    logging: ['error'],
    extra: { max: Number(process.env.DB_POOL_MAX || 10) },
    ...extra,
  } as DataSourceOptions;
}

export function createDataSource(url = process.env.DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm'): DataSource {
  return new DataSource(dataSourceOptions(url));
}

/** Runs pending migrations on the given database URL. */
export async function runMigrations(url?: string): Promise<string[]> {
  const ds = createDataSource(url);
  await ds.initialize();
  try {
    const done = await ds.runMigrations({ transaction: 'each' });
    return done.map((m) => m.name);
  } finally {
    await ds.destroy();
  }
}
