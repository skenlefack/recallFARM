import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, hasPlatformRole } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { Payment, Subscription } from '../database/entities';
import { ParamsService } from '../params/params.service';
import { EntitlementsService } from './entitlements.service';
import { PAYMENT_PROVIDER, PaymentProvider, SimulatorPaymentProvider } from './payment.providers';

export interface CheckoutInput {
  account_type: 'user' | 'organisation';
  account_id: string;
  plan: string;
  period: 'monthly' | 'yearly';
  method: string;
  phone: string;
}

const GRACE_DAYS = 7;

@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly ds: DataSource,
    private readonly params: ParamsService,
    private readonly entitlements: EntitlementsService,
    private readonly access: AccessService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {
    if (provider instanceof SimulatorPaymentProvider) {
      provider.onAutoConfirm = async (id) => {
        await this.applyResult({ payment_id: id, status: 'confirme' });
      };
    }
  }

  /** GET /plans: plans, prices (Money), features and quotas for a country. */
  async plans(country = 'CM') {
    const r = await this.params.resolveBase(country);
    const prices = Object.values(r.objects).filter((o) => o.kind === 'plan_price');
    const methods = Object.values(r.objects)
      .filter((o) => o.kind === 'payment_method')
      .map((o) => ({ code: o.code, label: o.label }));
    const plans = this.params.plans(r).map((p) => {
      const price = prices.find((x) => x.code === p.code) as { currency: string; monthly_minor: number; yearly_minor: number; note?: string } | undefined;
      const currency = price?.currency ?? 'XAF';
      return {
        code: p.code,
        label: this.params.label(r, p.code),
        rank: p.rank,
        features: p.features,
        quotas: p.quotas,
        prices: {
          monthly: { amount_minor: price?.monthly_minor ?? 0, currency },
          yearly: { amount_minor: price?.yearly_minor ?? 0, currency },
          from: !!price?.note || p.code === 'structure', // Structure: per tranche of followed farmers (D-10)
        },
        purchasable: !!price,
        note: price?.note ?? null,
      };
    });
    // `data` mirrors `plans` in the shape used by the web client: price null = « sur devis ».
    const data = plans.map((p) => ({
      code: p.code,
      name: p.label,
      rank: p.rank,
      features: p.features,
      quotas: p.quotas,
      monthly: p.purchasable || p.rank === 0 ? p.prices.monthly : null,
      yearly: p.purchasable || p.rank === 0 ? p.prices.yearly : null,
      price: p.purchasable
        ? { monthly: p.prices.monthly, yearly: p.prices.yearly, from: p.prices.from }
        : p.rank === 0
          ? { monthly: { amount_minor: 0, currency: p.prices.monthly.currency }, yearly: { amount_minor: 0, currency: p.prices.monthly.currency }, from: false }
          : null,
    }));
    return { country, currency: plans.find((p) => p.purchasable)?.prices.monthly.currency ?? 'XAF', data, plans, payment_methods: methods };
  }

  async checkout(user: AuthUser, input: CheckoutInput) {
    if (input.account_type === 'user') {
      if (input.account_id !== user.id && !hasPlatformRole(user)) throw Errors.forbidden('Vous ne pouvez payer que pour votre propre compte');
    } else {
      await this.access.assertOrgManager(user, input.account_id);
    }
    const catalog = await this.plans();
    const plan = catalog.plans.find((p) => p.code === input.plan);
    if (!plan || !plan.purchasable) throw Errors.validation({ plan: 'formule non disponible à l’achat' });
    if (!catalog.payment_methods.some((m) => m.code === input.method)) throw Errors.validation({ method: 'moyen de paiement non disponible' });
    const price = input.period === 'yearly' ? plan.prices.yearly : plan.prices.monthly;
    const repo = this.ds.getRepository(Payment);
    const payment = await repo.save(
      repo.create({
        payer_type: input.account_type,
        payer_id: input.account_id,
        purpose: 'abonnement',
        plan: plan.code,
        period: input.period === 'yearly' ? 'annuel' : 'mensuel',
        amount_minor: price.amount_minor,
        currency: price.currency,
        method: input.method,
        phone: input.phone,
        status: 'initie',
        created_by: user.id,
      }),
    );
    const init = await this.provider.initiate(payment);
    payment.provider_ref = init.provider_ref;
    payment.status = 'en_attente';
    await repo.save(payment);
    return {
      payment_id: payment.id,
      status: 'initie' as const,
      ussd_push: init.ussd_push,
      ...(init.redirect_url ? { redirect_url: init.redirect_url } : {}),
      amount: { amount_minor: Number(payment.amount_minor), currency: payment.currency },
      provider_ref: payment.provider_ref,
    };
  }

  async getPayment(user: AuthUser, id: string) {
    const p = await this.ds.getRepository(Payment).findOne({ where: { id } });
    if (!p) throw Errors.notFound('Paiement');
    if (p.created_by !== user.id && p.payer_id !== user.id && !hasPlatformRole(user)) {
      if (p.payer_type !== 'organisation') throw Errors.forbidden();
      await this.access.assertOrgManager(user, p.payer_id);
    }
    return this.serialize(p);
  }

  serialize(p: Payment) {
    return {
      id: p.id,
      status: p.status,
      purpose: p.purpose,
      plan: p.plan,
      period: p.period,
      amount: { amount_minor: Number(p.amount_minor), currency: p.currency },
      method: p.method,
      provider_ref: p.provider_ref,
      paid_at: p.paid_at,
      created_at: p.created_at,
    };
  }

  /** Verifies the aggregator HMAC (hex SHA-256 of the raw body) in X-Signature. */
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;
    const expected = createHmac('sha256', config().paymentWebhookSecret).update(rawBody).digest('hex');
    const given = signature.replace(/^sha256=/, '');
    if (given.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }

  /** Applies a provider result (webhook, simulator or dev endpoint). Idempotent. */
  async applyResult(input: { payment_id?: string; provider_ref?: string; status: string; fees_minor?: number }) {
    const repo = this.ds.getRepository(Payment);
    const p = input.payment_id
      ? await repo.findOne({ where: { id: input.payment_id } })
      : input.provider_ref
        ? await repo.findOne({ where: { provider_ref: input.provider_ref } })
        : null;
    if (!p) throw Errors.notFound('Paiement');
    const ok = ['confirme', 'success', 'successful', 'paid'].includes(input.status.toLowerCase());
    if (p.status === 'confirme' || p.status === 'echoue') return this.serialize(p);
    if (!ok) {
      p.status = 'echoue';
      await repo.save(p);
      return this.serialize(p);
    }
    await this.ds.transaction(async (m) => {
      p.status = 'confirme';
      p.paid_at = new Date();
      p.fees_minor = input.fees_minor ?? null;
      const sub = await this.activate(m.getRepository(Subscription), p);
      p.subscription_id = sub.id;
      await m.getRepository(Payment).save(p);
    });
    this.logger.log(`payment ${p.id} confirmed → ${p.payer_type}:${p.payer_id} ${p.plan}`);
    return this.serialize(p);
  }

  private async activate(repo: import('typeorm').Repository<Subscription>, p: Payment): Promise<Subscription> {
    const now = new Date();
    let sub = await repo.findOne({ where: { account_type: p.payer_type, account_id: p.payer_id } });
    const startFrom = sub && sub.plan === p.plan && sub.expires_at && sub.expires_at > now ? sub.expires_at : now;
    const expires = new Date(startFrom);
    if (p.period === 'annuel') expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    else expires.setUTCMonth(expires.getUTCMonth() + 1);
    const grace = new Date(expires.getTime() + GRACE_DAYS * 86400_000);
    if (!sub) sub = repo.create({ account_type: p.payer_type, account_id: p.payer_id });
    Object.assign(sub, {
      plan: p.plan!,
      period: p.period ?? 'mensuel',
      price_minor: p.amount_minor,
      currency: p.currency,
      payment_provider: p.method,
      started_at: sub.started_at && sub.plan === p.plan ? sub.started_at : now,
      expires_at: expires,
      grace_until: grace,
      status: 'actif',
    });
    sub = await repo.save(sub);
    return sub;
  }

  /**
   * GET /subscriptions/current — the subscription in force for the requested account
   * (default: the caller's organisation when they administer one, otherwise the caller).
   */
  async current(user: AuthUser, accountType?: 'user' | 'organisation', accountId?: string) {
    if (!accountType && accountId) accountType = accountId === user.id ? 'user' : 'organisation';
    if (!accountType) {
      const admin: Array<{ organisation_id: string }> = await this.ds.query(
        `SELECT organisation_id FROM memberships WHERE user_id = $1 AND status = 'actif' AND deleted_at IS NULL AND role IN ('admin','proprietaire') ORDER BY created_at LIMIT 1`,
        [user.id],
      );
      if (admin[0]) {
        accountType = 'organisation';
        accountId = admin[0].organisation_id;
      } else accountType = 'user';
    }
    let e;
    if (accountType === 'organisation') {
      if (!accountId) throw Errors.validation({ account_id: 'obligatoire' });
      await this.access.assertOrgMember(user, accountId);
      e = await this.entitlements.forOrganisation(accountId);
      e = { ...e, token: await this.entitlements.sign(accountId, e) };
    } else {
      if (accountId && accountId !== user.id && !hasPlatformRole(user)) throw Errors.forbidden();
      accountId = user.id;
      e = await this.entitlements.forUser(user.id);
    }
    // Subscription row actually in force (a member may benefit from their organisation's plan).
    const src = e.source.account_type !== 'none' ? e.source : { account_type: accountType, account_id: accountId };
    const sub = await this.ds.getRepository(Subscription).findOne({ where: { account_type: src.account_type, account_id: src.account_id! } });
    return {
      account_type: accountType,
      account_id: accountId,
      plan: e.plan,
      status: e.status,
      period: sub?.period ?? null,
      started_at: sub?.started_at ?? null,
      expires_at: e.expires_at,
      grace_until: e.grace_until,
      price: sub?.price_minor !== null && sub?.price_minor !== undefined ? { amount_minor: Number(sub.price_minor), currency: sub.currency ?? 'XAF' } : null,
      subscription: sub ? { id: sub.id, account_type: sub.account_type, account_id: sub.account_id } : null,
      entitlements: e,
    };
  }
}
