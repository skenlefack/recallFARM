import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { reloadConfig } from '../config';
import { runSeed } from '../seed/seed';

/** Idempotent demo seed (`npm run seed`, `node dist/scripts/seed.js`). Run migrations first. */
async function main() {
  process.env.SCHEDULER_ENABLED = 'false';
  process.env.PAYMENT_SIM_AUTOCONFIRM_MS = '0';
  reloadConfig();
  const app = await NestFactory.createApplicationContext(AppModule.register(), { logger: ['error', 'warn', 'log'] });
  try {
    await runSeed(app);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
