import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { ConnectorHttp } from '../connectors/connector-http';
import { SmsSpec } from '../connectors/connector.types';
import { formatPhone, getPath, getString, smsSegments } from '../connectors/template';

export interface SendResult {
  status: 'envoye' | 'echoue';
  provider_ref?: string;
  error_code?: string;
  /** Cost in ISO 4217 minor units, when known. */
  cost_minor?: number;
  currency?: string;
}

/** SMS adapter (simulator | generic HTTP | declarative connector). */
export interface SmsProvider {
  readonly name: string;
  /** Whether message bodies may be stored in outbound_messages (simulator only). */
  readonly storesBody: boolean;
  send(to: string, text: string): Promise<SendResult>;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(to: string, text: string): Promise<SendResult>;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';

/** Stores messages instead of sending them; readable through GET /v1/dev/outbox. */
@Injectable()
export class SimulatorSmsProvider implements SmsProvider {
  readonly name = 'simulator';
  readonly storesBody = true;
  private readonly logger = new Logger('SmsSimulator');

  async send(to: string, text: string): Promise<SendResult> {
    this.logger.debug(`SMS → ${to}: ${text}`);
    const cfg = config();
    return {
      status: 'envoye',
      provider_ref: `SIMSMS-${randomBytes(4).toString('hex')}`,
      cost_minor: cfg.smsSimCostMinor * smsSegments(text).segments,
      currency: cfg.smsSimCurrency,
    };
  }
}

/** Generic HTTP aggregator: POST SMS_HTTP_URL {from, to, text} with a bearer token. */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly storesBody = false;
  private readonly logger = new Logger('SmsHttp');

  async send(to: string, text: string): Promise<SendResult> {
    const cfg = config();
    if (!cfg.smsHttpUrl) return { status: 'echoue', error_code: 'not_configured' };
    try {
      const res = await fetch(cfg.smsHttpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.smsHttpToken ? { authorization: `Bearer ${cfg.smsHttpToken}` } : {}) },
        body: JSON.stringify({ from: cfg.smsSenderId, to, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { status: 'echoue', error_code: `http_${res.status}` };
      const body = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
      return { status: 'envoye', provider_ref: body.id ?? body.message_id };
    } catch (e) {
      this.logger.warn(`SMS send failed: ${(e as Error).message}`);
      return { status: 'echoue', error_code: 'network' };
    }
  }
}

@Injectable()
export class SimulatorWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'simulator';
  async send(): Promise<SendResult> {
    return { status: 'envoye', provider_ref: `SIMWA-${randomBytes(4).toString('hex')}` };
  }
}

/**
 * Any SMS or WhatsApp aggregator described in the providers configuration (ADR-002).
 * The request, authentication and response mapping come from the connector file, not from code.
 */
export class ConnectorMessageProvider implements SmsProvider, WhatsAppProvider {
  readonly storesBody = false;
  private readonly logger = new Logger('SmsConnector');

  constructor(
    private readonly client: ConnectorHttp,
    private readonly spec: SmsSpec,
  ) {}

  get name(): string {
    return this.client.name;
  }

  async send(to: string, text: string): Promise<SendResult> {
    const seg = smsSegments(text);
    const c = this.client.spec;
    try {
      const res = await this.client.call(this.spec.send, {
        to: formatPhone(to, c.phone_format, c.national_prefix),
        to_e164: to,
        text,
        sender: this.spec.sender_id ?? config().smsSenderId,
        segments: seg.segments,
        encoding: seg.encoding,
        message_id: randomBytes(8).toString('hex'),
      });
      if (!res.ok) return { status: 'echoue', error_code: `http_${res.http_status}` };
      const costRaw = getPath(res.body, this.spec.send.result?.cost_minor);
      const cost = Number.isInteger(Number(costRaw)) && costRaw !== undefined && costRaw !== null ? Number(costRaw) : undefined;
      return {
        status: 'envoye',
        provider_ref: getString(res.body, this.spec.send.result?.ref),
        cost_minor: cost ?? (this.spec.cost ? this.spec.cost.per_segment_minor * seg.segments : undefined),
        currency: this.spec.cost?.currency,
      };
    } catch (e) {
      this.logger.warn(`${this.name}: envoi impossible (${(e as Error).message})`);
      return { status: 'echoue', error_code: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }
}
