import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { ConnectorRegistry } from '../connectors/connector-registry';
import { amountMajor, formatPhone, getString } from '../connectors/template';
import { Payment } from '../database/entities';

export interface PaymentInitResult {
  provider_ref: string;
  ussd_push: boolean;
  redirect_url?: string;
}

/** Mobile-money aggregator adapter (05 §16). */
export interface PaymentProvider {
  readonly name: string;
  initiate(payment: Payment): Promise<PaymentInitResult>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

/**
 * Simulator: accepts every payment and, unless disabled (PAYMENT_SIM_AUTOCONFIRM_MS=0),
 * confirms it automatically after 5 s through the same code path as the webhook.
 */
@Injectable()
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';
  private readonly logger = new Logger('PaymentSimulator');
  onAutoConfirm: ((paymentId: string) => Promise<void>) | null = null;

  async initiate(payment: Payment): Promise<PaymentInitResult> {
    const ref = `SIM-${randomBytes(5).toString('hex').toUpperCase()}`;
    const delay = config().paymentSimAutoConfirmMs;
    if (delay > 0 && this.onAutoConfirm) {
      const cb = this.onAutoConfirm;
      setTimeout(() => {
        cb(payment.id).catch((e) => this.logger.warn(`auto-confirm failed: ${e.message}`));
      }, delay).unref();
    }
    return { provider_ref: ref, ussd_push: true };
  }
}

/**
 * Any mobile-money aggregator described in the providers configuration (ADR-002),
 * routed by payment method code (pack pays.*: orange_money, mtn_momo, ...).
 */
export class ConnectorPaymentProvider implements PaymentProvider {
  readonly name = 'connector';

  constructor(private readonly registry: ConnectorRegistry) {}

  /** Methods that have a configured connector. */
  methods(): string[] {
    return Object.keys(this.registry.config.routing?.payment ?? {});
  }

  async initiate(payment: Payment): Promise<PaymentInitResult> {
    const name = this.registry.paymentRoute(payment.method);
    const found = name ? this.registry.get(name) : null;
    if (!found?.spec.payment) throw new PaymentProviderError('not_configured', `aucun connecteur pour le moyen ${payment.method}`);
    const { client, spec } = found;
    const p = spec.payment!;
    const cfg = config();
    const res = await client.call(p.initiate, {
      payment_id: payment.id,
      reference: payment.id,
      amount_minor: Number(payment.amount_minor),
      amount: amountMajor(Number(payment.amount_minor), payment.currency),
      currency: payment.currency,
      phone: formatPhone(payment.phone ?? '', spec.phone_format, spec.national_prefix),
      phone_e164: payment.phone ?? '',
      method: payment.method,
      description: `RecallFarm ${payment.plan ?? payment.purpose} ${payment.period ?? ''}`.trim(),
      callback_url: `${cfg.publicApiUrl.replace(/\/+$/, '')}/v1/connectors/${client.name}/payment`,
      return_url: cfg.publicAppUrl,
    });
    if (!res.ok) throw new PaymentProviderError(`http_${res.http_status}`, `${client.name} a refuse le paiement`);
    const ref = getString(res.body, p.initiate.result.ref);
    if (!ref) throw new PaymentProviderError('no_reference', `${client.name} n'a pas renvoye de reference`);
    const redirect = getString(res.body, p.initiate.result.redirect_url);
    return { provider_ref: ref, ussd_push: p.initiate.ussd_push ?? true, ...(redirect ? { redirect_url: redirect } : {}) };
  }
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
