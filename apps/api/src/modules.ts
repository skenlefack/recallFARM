import { Global, Module } from '@nestjs/common';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { AdminPaymentsController } from './billing/admin-payments.controller';
import { BillingController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { EntitlementsService } from './billing/entitlements.service';
import { PaymentOpsService } from './billing/payment-ops.service';
import { PaymentsScheduler } from './billing/payments.scheduler';
import { ConnectorPaymentProvider, PAYMENT_PROVIDER, SimulatorPaymentProvider } from './billing/payment.providers';
import { assertUssdLockBackend, CONNECTOR_REGISTRY, ConnectorRegistry } from './connectors/connector-registry';
import { ConnectorsController } from './connectors/connectors.controller';
import { AccessService } from './common/access.service';
import { TokenService } from './common/auth';
import { KeysService } from './common/keys.service';
import { KvService } from './common/kv.service';
import { config } from './config';
import { DevController } from './dev/dev.controller';
import { FarmsController } from './farms/farms.controller';
import { FarmsService } from './farms/farms.service';
import { GenealogyController } from './genealogy/genealogy.controller';
import { CertificatesService } from './health/certificates.service';
import { HealthController } from './health/health.controller';
import { HealthEventsService } from './health/health-events.service';
import { RemindersService } from './health/reminders.service';
import { SubjectsService } from './health/subjects.service';
import { TasksService } from './health/tasks.service';
import { ImportsExportsController } from './imports-exports/imports-exports.controller';
import { InboxController } from './inbox/inbox.controller';
import { JournalController } from './journal/journal.controller';
import { JournalService } from './journal/journal.service';
import { LivestockController } from './livestock/livestock.controller';
import { LivestockService } from './livestock/livestock.service';
import { MiscController } from './misc/misc.controller';
import { InboundController } from './notifications/inbound.controller';
import { MessagingService } from './notifications/messaging.service';
import { NotificationsScheduler } from './notifications/notifications.scheduler';
import { InboundService } from './notifications/inbound.service';
import { UssdSessionService } from './notifications/ussd-session.service';
import {
  ConnectorMessageProvider,
  HttpSmsProvider,
  SimulatorSmsProvider,
  SimulatorWhatsAppProvider,
  SMS_PROVIDER,
  WHATSAPP_PROVIDER,
} from './notifications/providers';
import { OrganisationsController } from './organisations/organisations.controller';
import { OrganisationsService } from './organisations/organisations.service';
import { ParamsController } from './params/params.controller';
import { ParamsService } from './params/params.service';
import { StockSalesController } from './stock-sales/stock-sales.controller';
import { StockSalesService } from './stock-sales/stock-sales.service';
import { StudioController } from './studio/studio.controller';
import { StudioService } from './studio/studio.service';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { AdminAnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AggregationService } from './analytics/aggregation.service';
import { AuthService } from './users/auth.service';
import { RetentionService } from './users/retention.service';
import { AuthController, DataRegistryController, MeController } from './users/users.controller';
import { UsersService } from './users/users.service';

/** Cross-cutting services: KV/locks (Redis or memory), Ed25519 keys, JWT, access control. */
@Global()
@Module({ providers: [KvService, KeysService, TokenService, AccessService], exports: [KvService, KeysService, TokenService, AccessService] })
export class CommonModule {}

/** Parameter packs: loading, signature, resolution with provenance, manifest. */
@Global()
@Module({ providers: [ParamsService], controllers: [ParamsController], exports: [ParamsService] })
export class ParamsModule {}

/** Connector routed for a messaging channel; fails fast at start-up when the configuration is incomplete. */
function routedMessaging(registry: ConnectorRegistry, channel: 'sms' | 'whatsapp'): ConnectorMessageProvider {
  const name = registry.route(channel);
  const found = name ? registry.get(name) : null;
  const spec = found?.spec[channel];
  if (!found || !spec) throw new Error(`${channel.toUpperCase()}_PROVIDER=connector mais routing.${channel} absent de PROVIDERS_CONFIG(_FILE)`);
  return new ConnectorMessageProvider(found.client, spec);
}

/** Channel adapters (simulator | HTTP | declarative connector, ADR-002) + outbound journal. */
@Global()
@Module({
  providers: [
    {
      provide: CONNECTOR_REGISTRY,
      useFactory: () => {
        const registry = ConnectorRegistry.fromEnv();
        assertUssdLockBackend(registry);
        return registry;
      },
    },
    {
      provide: SMS_PROVIDER,
      inject: [CONNECTOR_REGISTRY],
      useFactory: (registry: ConnectorRegistry) => {
        const p = config().smsProvider;
        if (p === 'connector') return routedMessaging(registry, 'sms');
        return p === 'http' ? new HttpSmsProvider() : new SimulatorSmsProvider();
      },
    },
    {
      provide: WHATSAPP_PROVIDER,
      inject: [CONNECTOR_REGISTRY],
      useFactory: (registry: ConnectorRegistry) =>
        config().whatsappProvider === 'connector' ? routedMessaging(registry, 'whatsapp') : new SimulatorWhatsAppProvider(),
    },
    MessagingService,
  ],
  exports: [MessagingService, SMS_PROVIDER, WHATSAPP_PROVIDER, CONNECTOR_REGISTRY],
})
export class MessagingModule {}

/** Plans, checkout, payments (simulator | declarative connectors), subscriptions, signed entitlements. */
@Global()
@Module({
  providers: [
    EntitlementsService,
    BillingService,
    PaymentOpsService,
    PaymentsScheduler,
    {
      provide: PAYMENT_PROVIDER,
      inject: [CONNECTOR_REGISTRY],
      useFactory: (registry: ConnectorRegistry) => {
        if (config().paymentProvider !== 'connector') return new SimulatorPaymentProvider();
        const p = new ConnectorPaymentProvider(registry);
        if (!p.methods().length) throw new Error('PAYMENT_PROVIDER=connector mais routing.payment absent de PROVIDERS_CONFIG(_FILE)');
        return p;
      },
    },
  ],
  controllers: [BillingController, AdminPaymentsController],
  exports: [EntitlementsService, BillingService, PaymentOpsService],
})
export class BillingModule {}

@Module({ providers: [UsersService, AuthService, RetentionService], controllers: [AuthController, MeController, DataRegistryController], exports: [UsersService] })
export class UsersModule {}

@Module({ providers: [AnalyticsService, AggregationService], controllers: [AdminAnalyticsController], exports: [AnalyticsService] })
export class AnalyticsModule {}

@Module({ providers: [FarmsService], controllers: [FarmsController], exports: [FarmsService] })
export class FarmsModule {}

/** Health events, protocols, reminder engine, tasks, certificates. */
@Module({
  providers: [SubjectsService, RemindersService, HealthEventsService, TasksService, CertificatesService],
  controllers: [HealthController],
  exports: [SubjectsService, RemindersService, HealthEventsService, TasksService],
})
export class HealthModule {}

/** Alerts + remote-monitoring demo (telemetry ingestion, live view, escalation). */
@Module({ providers: [AlertsService], controllers: [AlertsController], exports: [AlertsService] })
export class AlertsModule {}

@Module({ imports: [HealthModule], providers: [LivestockService], controllers: [LivestockController], exports: [LivestockService] })
export class LivestockModule {}

@Module({ imports: [HealthModule, LivestockModule, AlertsModule], providers: [JournalService], controllers: [JournalController], exports: [JournalService] })
export class JournalModule {}

@Module({ imports: [HealthModule], providers: [StockSalesService], controllers: [StockSalesController], exports: [StockSalesService] })
export class StockSalesModule {}

@Module({ imports: [HealthModule, StockSalesModule], controllers: [InboxController] })
export class InboxModule {}

/** Scheduler (J-7/J-1/J/J+3, quiet hours, caps) and inbound SMS / USSD. */
@Module({
  imports: [HealthModule, JournalModule],
  providers: [NotificationsScheduler, InboundService, UssdSessionService],
  controllers: [InboundController, ConnectorsController],
  exports: [NotificationsScheduler],
})
export class NotificationsModule {}

@Module({ providers: [OrganisationsService], controllers: [OrganisationsController] })
export class OrganisationsModule {}

@Module({ controllers: [GenealogyController] })
export class GenealogyModule {}

@Module({ imports: [HealthModule], providers: [StudioService], controllers: [StudioController] })
export class StudioModule {}

@Module({ imports: [FarmsModule, LivestockModule, JournalModule, HealthModule, StockSalesModule], providers: [SyncService], controllers: [SyncController] })
export class SyncModule {}

@Module({ controllers: [ImportsExportsController] })
export class ImportsExportsModule {}

@Module({ controllers: [MiscController] })
export class MiscModule {}

@Module({ imports: [NotificationsModule], controllers: [DevController] })
export class DevModule {}
