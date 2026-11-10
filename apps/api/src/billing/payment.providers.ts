import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { ConnectorRegistry } from '../connectors/connector-registry';
import { ConnectorHttp } from '../connectors/connector-http';
import { ConnectorSpec, PaymentSpec } from '../connectors/connector.types';
import { amountMajor, formatPhone, getPath, getString } from '../connectors/template';
import { Payment } from '../database/entities';
import { parseMinor } from '../notifications/providers';

export interface PaymentInitResult {
  provider_ref: string;
  ussd_push: boolean;
  redirect_url?: string;
  /** Connector that initiated the payment; only it may later confirm it. */
  connector?: string;
}

/** Status read from the aggregator (status query or transaction list). */
export interface ProviderPaymentStatus {
  status: 'confirme' | 'echoue' | 'en_attente' | 'inconnu';
  /** Aggregator wording, for the report (never a secret). */
  raw_status: string;
  fees_minor?: number;
  amount_minor?: number;
  currency?: string;
}

/** One transaction of the aggregator's daily list. */
export interface ProviderTransaction extends ProviderPaymentStatus {
  payment_id?: string;
  provider_ref?: string;
}

export interface RefundResult {
  status: 'rembourse' | 'echoue' | 'en_attente';
  refund_ref?: string;
}

/** Mobile-money aggregator adapter (05 §16). Optional operations depend on what the aggregator offers. */
export interface PaymentProvider {
  readonly name: string;
  initiate(payment: Payment): Promise<PaymentInitResult>;
  /** Method codes that can be paid (undefined = every method of the country pack). */
  methods?(): string[];
  /** Connector that will initiate a payment by this method (recorded before the call). */
  routeOf?(method: string): string | undefined;
  /** Asks the aggregator for the status of a payment; null when it offers no status query. */
  status?(payment: Payment): Promise<ProviderPaymentStatus | null>;
  /** Refunds a confirmed payment; `refundId` is stable for the payment (idempotency key). */
  refund?(payment: Payment, refundId: string, reason: string): Promise<RefundResult>;
  /** Connectors involved in payments (for the daily reconciliation). */
  connectors?(): string[];
  /** Transactions of one day for a connector; null when it offers no list. */
  list?(connector: string, day: string, fromIso: string, toIso: string): Promise<ProviderTransaction[] | null>;
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

  /** The simulator has no status query: pending payments are handled like with a minimal aggregator. */
  async status(): Promise<ProviderPaymentStatus | null> {
    return null;
  }

  async refund(): Promise<RefundResult> {
    return { status: 'rembourse', refund_ref: `SIMREF-${randomBytes(5).toString('hex').toUpperCase()}` };
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

  routeOf(method: string): string | undefined {
    return this.registry.paymentRoute(method);
  }

  connectors(): string[] {
    return [...new Set(Object.values(this.registry.config.routing?.payment ?? {}))];
  }

  /** Connector that initiated the payment (it alone may answer for it), else the current route. */
  private connectorOf(payment: Payment): { client: ConnectorHttp; spec: ConnectorSpec; p: PaymentSpec } {
    const recorded = (payment.raw as { connector?: unknown } | null)?.connector;
    const name = typeof recorded === 'string' ? recorded : this.registry.paymentRoute(payment.method);
    const found = name ? this.registry.get(name) : null;
    if (!found?.spec.payment) throw new PaymentProviderError('not_configured', `aucun connecteur pour le paiement ${payment.id}`, true);
    return { client: found.client, spec: found.spec, p: found.spec.payment };
  }

  private vars(payment: Payment, spec: ConnectorSpec) {
    return {
      payment_id: payment.id,
      reference: payment.id,
      provider_ref: payment.provider_ref ?? '',
      amount_minor: Number(payment.amount_minor),
      amount: amountMajor(Number(payment.amount_minor), payment.currency),
      currency: payment.currency,
      phone: formatPhone(payment.phone ?? '', spec.phone_format, spec.national_prefix),
      phone_e164: payment.phone ?? '',
      method: payment.method,
    };
  }

  private mapStatus(body: unknown, r: { status: string; status_map: Record<string, ProviderPaymentStatus['status']>; fees_minor?: string; amount_minor?: string; currency?: string }): ProviderPaymentStatus {
    const raw = getString(body, r.status) ?? '';
    const status = Object.hasOwn(r.status_map, raw) ? r.status_map[raw] : 'inconnu';
    const fees = parseMinor(getPath(body, r.fees_minor));
    const amount = parseMinor(getPath(body, r.amount_minor));
    const currency = getString(body, r.currency);
    return { status, raw_status: raw.slice(0, 40), ...(fees !== undefined ? { fees_minor: fees } : {}), ...(amount !== undefined ? { amount_minor: amount } : {}), ...(currency ? { currency } : {}) };
  }

  async status(payment: Payment): Promise<ProviderPaymentStatus | null> {
    const { client, spec, p } = this.connectorOf(payment);
    if (!p.status) return null;
    const res = await client.call(p.status, this.vars(payment, spec));
    if (!res.ok) throw new PaymentProviderError(`http_${res.http_status}`, `${client.name}: statut illisible`, false, client.name);
    return this.mapStatus(res.body, p.status.result);
  }

  async refund(payment: Payment, refundId: string, reason: string): Promise<RefundResult> {
    const { client, spec, p } = this.connectorOf(payment);
    if (!p.refund) throw new PaymentProviderError('not_supported', `${client.name} ne propose pas de remboursement`, true, client.name);
    const res = await client.call(p.refund, { ...this.vars(payment, spec), refund_id: refundId, reason });
    if (!res.ok) throw new PaymentProviderError(`http_${res.http_status}`, `${client.name} a refuse le remboursement`, res.http_status < 500, client.name);
    const r = p.refund.result;
    const ref = getString(res.body, r?.ref);
    const raw = r?.status ? (getString(res.body, r.status) ?? '') : '';
    const status = r?.status_map && Object.hasOwn(r.status_map, raw) ? r.status_map[raw] : r?.status ? 'en_attente' : 'rembourse';
    return { status, ...(ref ? { refund_ref: ref } : {}) };
  }

  async list(connector: string, day: string, fromIso: string, toIso: string): Promise<ProviderTransaction[] | null> {
    const found = this.registry.get(connector);
    const l = found?.spec.payment?.list;
    if (!found || !l) return null;
    const res = await found.client.call(l, { date: day, from: fromIso, to: toIso });
    if (!res.ok) throw new PaymentProviderError(`http_${res.http_status}`, `${connector}: liste des transactions illisible`, false, connector);
    const items = getPath(res.body, l.result.items);
    if (!Array.isArray(items)) throw new PaymentProviderError('no_items', `${connector}: liste absente de la reponse`, false, connector);
    return items.map((it) => {
      const paymentId = getString(it, l.result.payment_id);
      const ref = getString(it, l.result.ref);
      return { ...this.mapStatus(it, l.result), ...(paymentId ? { payment_id: paymentId } : {}), ...(ref ? { provider_ref: ref } : {}) };
    });
  }

  async initiate(payment: Payment): Promise<PaymentInitResult> {
    const name = this.registry.paymentRoute(payment.method);
    const found = name ? this.registry.get(name) : null;
    if (!found?.spec.payment) throw new PaymentProviderError('not_configured', `aucun connecteur pour le moyen ${payment.method}`, true);
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
    if (!res.ok) {
      // 4xx, or 2xx with a refusal status: explicit refusal. 5xx: unknown outcome.
      throw new PaymentProviderError(`http_${res.http_status}`, `${client.name} a refuse le paiement`, res.http_status < 500, client.name);
    }
    const ref = getString(res.body, p.initiate.result.ref);
    if (!ref) throw new PaymentProviderError('no_reference', `${client.name} n'a pas renvoye de reference`, false, client.name);
    const redirect = getString(res.body, p.initiate.result.redirect_url);
    return { provider_ref: ref, ussd_push: p.initiate.ussd_push ?? true, connector: client.name, ...(redirect ? { redirect_url: redirect } : {}) };
  }
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** True when the aggregator explicitly refused (nothing can have been debited). */
    readonly definitive = false,
    readonly connector?: string,
  ) {
    super(message);
  }
}
