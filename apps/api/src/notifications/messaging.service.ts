import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboundMessage } from '../database/entities';
import { SMS_PROVIDER, SmsProvider, WHATSAPP_PROVIDER, WhatsAppProvider } from './providers';

export type DeliveryStatus = 'delivre' | 'echoue' | 'envoye';

export interface OutboundInput {
  channel: 'sms' | 'whatsapp' | 'push';
  phone: string;
  text: string;
  template_code: string;
  lang?: string;
  user_id?: string | null;
  reminder_id?: string | null;
  alert_event_id?: string | null;
  organisation_id?: string | null;
  plan_offset?: number | null;
  /** Never store the body (OTP codes with a real provider). */
  sensitive?: boolean;
}

/** Sends through the channel adapters and journals every message in outbound_messages (RG-NOT-02). */
@Injectable()
export class MessagingService {
  constructor(
    private readonly ds: DataSource,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  get smsProviderName(): string {
    return this.sms.name;
  }

  async record(input: OutboundInput, status: string, extra: Partial<OutboundMessage> = {}): Promise<OutboundMessage> {
    const repo = this.ds.getRepository(OutboundMessage);
    return repo.save(
      repo.create({
        reminder_id: input.reminder_id ?? null,
        alert_event_id: input.alert_event_id ?? null,
        organisation_id: input.organisation_id ?? null,
        recipient_user_id: input.user_id ?? null,
        recipient_phone: input.phone,
        channel: input.channel,
        template_code: input.template_code,
        lang: input.lang ?? 'fr',
        body: input.sensitive && !this.sms.storesBody ? null : input.text,
        plan_offset: input.plan_offset ?? null,
        status,
        ...extra,
      }),
    );
  }

  async send(input: OutboundInput): Promise<OutboundMessage> {
    if (input.channel === 'push') {
      // Push is delivered through the app inbox / sync in the MVP; journaled as sent.
      return this.record(input, 'envoye', { sent_at: new Date(), provider_ref: 'app' });
    }
    return this.sendWith(input.channel === 'whatsapp' ? this.whatsapp : this.sms, input);
  }

  /**
   * Journals the message first ("en_file"), then sends it with the journal id as idempotency key
   * (`{{message_id}}`, m6), then stores the outcome. A delivery report can quote either reference.
   */
  async sendWith(provider: SmsProvider | WhatsAppProvider, input: OutboundInput): Promise<OutboundMessage> {
    const row = await this.record(input, 'en_file', { provider: provider.name });
    const res = await provider.send(input.phone, input.text, { message_id: row.id });
    const sent = res.status === 'envoye';
    Object.assign(row, {
      status: res.status,
      provider_ref: res.provider_ref ?? null,
      error_code: res.error_code ?? null,
      sent_at: sent ? new Date() : null,
      cost_minor: sent && res.cost_minor !== undefined && res.currency ? res.cost_minor : null,
      currency: sent && res.cost_minor !== undefined && res.currency ? res.currency : null,
    });
    return this.ds.getRepository(OutboundMessage).save(row);
  }

  /**
   * Applies a delivery report (DLR) to the message sent by `provider` on `channel` whose provider
   * reference, or our own id (message_id), is `ref`. Statuses never go back (m5):
   * en_file < envoye < echoue | delivre; "delivre" is final. Returns the rows updated.
   */
  async applyDeliveryReport(provider: string, channel: 'sms' | 'whatsapp', ref: string, status: DeliveryStatus, errorCode?: string): Promise<number> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const res: [unknown[], number] = await this.ds.query(
      `UPDATE outbound_messages
          SET status = $4,
              delivered_at = CASE WHEN $4 = 'delivre' THEN now() ELSE delivered_at END,
              error_code = CASE WHEN $4 = 'echoue' THEN COALESCE($5, error_code, 'non_delivre') ELSE error_code END
        WHERE provider = $1 AND channel = $2
          AND (provider_ref = $3 ${isUuid ? 'OR id = $3::uuid' : ''})
          AND status <> 'delivre'
          AND NOT ($4 = 'envoye' AND status = 'echoue')
          AND NOT ($4 = status)`,
      [provider, channel, ref, status, errorCode ?? null],
    );
    return res[1] ?? 0;
  }

  async smsSentToday(phone: string, sinceIso: string): Promise<{ total: number; high: number }> {
    const rows: Array<{ total: number; high: number }> = await this.ds.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE r.priority IN ('haute','critique'))::int AS high
         FROM outbound_messages o LEFT JOIN reminders r ON r.id = o.reminder_id
        WHERE o.recipient_phone = $1 AND o.channel IN ('sms','whatsapp') AND o.status IN ('envoye','delivre')
          AND o.template_code <> 'otp_sms' AND o.queued_at >= $2`,
      [phone, sinceIso],
    );
    return rows[0] ?? { total: 0, high: 0 };
  }

  async usage(accountType: string, accountId: string, period: string, metric = 'sms'): Promise<number> {
    const rows: Array<{ value: number }> = await this.ds.query(
      `SELECT value FROM usage_counters WHERE account_type = $1 AND account_id = $2 AND period = $3 AND metric = $4`,
      [accountType, accountId, period, metric],
    );
    return rows[0]?.value ?? 0;
  }

  async incrementUsage(accountType: string, accountId: string, period: string, metric = 'sms', by = 1): Promise<void> {
    await this.ds.query(
      `INSERT INTO usage_counters (account_type, account_id, period, metric, value) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_type, account_id, period, metric) DO UPDATE SET value = usage_counters.value + EXCLUDED.value`,
      [accountType, accountId, period, metric, by],
    );
  }
}
