import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from './common/auth';
import { ThrottlerRedisStorage } from './common/throttler-redis.storage';
import { config } from './config';
import { dataSourceOptions } from './database/data-source';
import {
  AlertsModule, AnalyticsModule, BillingModule, CommonModule, DevModule, FarmsModule, GenealogyModule, HealthModule, ImportsExportsModule, InboxModule, JournalModule,
  LivestockModule, MessagingModule, MiscModule, NotificationsModule, OrganisationsModule, ParamsModule, StockSalesModule, StudioModule, SyncModule,
  UsersModule,
} from './modules';

@Module({})
export class AppModule {
  /**
   * @param opts.databaseUrl overrides DATABASE_URL (e2e uses TEST_DATABASE_URL)
   * With OPENAPI_EXPORT=true the DataSource is not initialised (no database needed).
   */
  static register(opts: { databaseUrl?: string } = {}): DynamicModule {
    const cfg = config();
    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot({ ...dataSourceOptions(opts.databaseUrl ?? cfg.databaseUrl), manualInitialization: cfg.openapiExport } as never),
        ScheduleModule.forRoot(),
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: cfg.throttleTtlMs, limit: cfg.throttleLimit }],
          storage: new ThrottlerRedisStorage(cfg.redisUrl),
        }),
        CommonModule,
        ParamsModule,
        MessagingModule,
        BillingModule,
        UsersModule,
        OrganisationsModule,
        FarmsModule,
        LivestockModule,
        JournalModule,
        HealthModule,
        InboxModule,
        StockSalesModule,
        AlertsModule,
        GenealogyModule,
        NotificationsModule,
        StudioModule,
        SyncModule,
        ImportsExportsModule,
        AnalyticsModule,
        MiscModule,
        ...(cfg.devEndpoints ? [DevModule] : []),
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
