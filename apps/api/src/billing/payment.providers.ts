import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../config';
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

/** Interfaces ready for the real aggregators; not wired in the MVP. */
@Injectable()
export class OrangeMoneyProvider implements PaymentProvider {
  readonly name = 'orange';
  async initiate(): Promise<PaymentInitResult> {
    throw new Error('Orange Money provider is not wired in the MVP (PAYMENT_PROVIDER=simulator)');
  }
}

@Injectable()
export class MtnMomoProvider implements PaymentProvider {
  readonly name = 'mtn';
  async initiate(): Promise<PaymentInitResult> {
    throw new Error('MTN MoMo provider is not wired in the MVP (PAYMENT_PROVIDER=simulator)');
  }
}
