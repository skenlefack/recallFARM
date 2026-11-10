import 'reflect-metadata';
import { runMigrations } from '../database/data-source';

/** Applies pending TypeORM migrations (`npm run migration:run`, container entrypoint). */
async function main() {
  const url = process.env.DATABASE_URL;
  const done = await runMigrations(url);
  // eslint-disable-next-line no-console
  console.log(done.length ? `Applied migrations: ${done.join(', ')}` : 'No pending migration');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
