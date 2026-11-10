import 'reflect-metadata';
import { createDataSource } from '../database/data-source';

/** Reverts the last applied migration. */
async function main() {
  const ds = createDataSource();
  await ds.initialize();
  await ds.undoLastMigration({ transaction: 'each' });
  await ds.destroy();
  // eslint-disable-next-line no-console
  console.log('Reverted last migration');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
