import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Writes apps/api/openapi.json without a database (OPENAPI_EXPORT=true → TypeORM manual initialisation).
 * Output is deterministic: sorted keys, no timestamps, OpenAPI 3.1 nullable conversion.
 */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** OpenAPI 3.0 `nullable: true` → 3.1 type arrays. */
function to31(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(to31);
  if (v && typeof v === 'object') {
    const o = { ...(v as Record<string, unknown>) };
    if (o.nullable === true) {
      delete o.nullable;
      if (typeof o.type === 'string') o.type = [o.type, 'null'];
    }
    for (const k of Object.keys(o)) o[k] = to31(o[k]);
    return o;
  }
  return v;
}

async function main() {
  process.env.OPENAPI_EXPORT = 'true';
  process.env.SCHEDULER_ENABLED = 'false';
  const { reloadConfig } = await import('../config');
  reloadConfig();
  const { AppModule } = await import('../app.module');
  const { configureApp, buildOpenApi } = await import('../bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(), { logger: ['error'], abortOnError: false });
  configureApp(app);
  const doc = buildOpenApi(app) as unknown as Record<string, unknown>;
  doc.openapi = '3.1.0';
  const out = resolve(__dirname, '../../openapi.json');
  writeFileSync(out, `${JSON.stringify(sortDeep(to31(doc)), null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths as object).length} paths)`);
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
