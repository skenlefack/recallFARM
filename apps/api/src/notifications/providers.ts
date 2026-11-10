import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';

export interface SendResult {
  status: 'envoye' | 'echoue';
  provider_ref?: string;
  error_code?: string;
}

/** SMS adapter (simulator | generic HTTP aggregator). */
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
    return { status: 'envoye', provider_ref: `SIMSMS-${randomBytes(4).toString('hex')}` };
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
