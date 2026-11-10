import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/error.filter';
import { Errors } from './common/errors';
import { config } from './config';
import { ParamsService } from './params/params.service';

function flatten(errors: ValidationError[], prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const e of errors) {
    const path = prefix ? (/^\d+$/.test(e.property) ? `${prefix}[${e.property}]` : `${prefix}.${e.property}`) : e.property;
    if (e.constraints) {
      const c = Object.entries(e.constraints);
      out[path] = c.some(([k]) => k === 'whitelistValidation') ? 'champ non autorisé' : c.map(([, v]) => v).join('; ');
    }
    if (e.children?.length) flatten(e.children, path, out);
  }
  return out;
}

export async function createApp(opts: { databaseUrl?: string; logger?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ databaseUrl: opts.databaseUrl }), {
    rawBody: true,
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  configureApp(app);
  return app;
}

/** Global pipes/filters/security shared by main, e2e tests and the OpenAPI export. */
export function configureApp(app: NestExpressApplication): void {
  const cfg = config();
  app.set('trust proxy', 1);
  app.setGlobalPrefix('v1');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: cfg.corsOrigins, credentials: true, exposedHeaders: ['x-export-job-id', 'content-disposition'] });
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => Errors.validation(flatten(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('RecallFarm API')
    .setDescription('API du MVP RecallFarm — gestion d’élevage hors ligne d’abord (volaille, chiens). Erreurs : { error: { code, message, fields?, details? } }.')
    .setVersion('0.1.0')
    .addServer('/')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, doc, { operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, '')}_${method}` });
}

/** Loads source packs on start (idempotent) and mounts Swagger UI on /v1/docs. */
export async function prepareRuntime(app: NestExpressApplication): Promise<void> {
  await app.get(ParamsService).ensureSourcePacks();
  const doc = buildOpenApi(app);
  SwaggerModule.setup('v1/docs', app, doc, { jsonDocumentUrl: 'v1/openapi.json' });
}
