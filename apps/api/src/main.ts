import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp, prepareRuntime } from './bootstrap';
import { config } from './config';

async function main() {
  const cfg = config();
  process.env.TZ = cfg.tz;
  const app = await createApp();
  await prepareRuntime(app);
  await app.listen(cfg.port, '0.0.0.0');
  Logger.log(`RecallFarm API on http://0.0.0.0:${cfg.port}/v1 (docs /v1/docs, env ${cfg.nodeEnv}, kv ${cfg.redisUrl ? 'redis' : 'memory'})`, 'Bootstrap');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
