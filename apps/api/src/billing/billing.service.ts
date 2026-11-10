import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, hasPlatformRole } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { Payment, Subscription } from '../database/entities';
import { ParamsService } from '../params/params.service';
import { EntitlementsService } from './entitlements.service';
import { PAYMENT_PROVIDER, PaymentProvider, PaymentProviderError, SimulatorPaymentProvider } from './payment.providers';

export interface CheckoutInput {
  account_type: 'user' | 'organisation';
  account_id: string;
  plan: string;
  period: 'monthly' | 'yearly';
  method: string;
  phone: string;
  /** UUID v4 created by the client: a repeated checkout with the same id returns the same payment. */
  id?: string;
  /** Alternative to `id` (header Idempotency-Key): the payment id is derived from (user, key). */
  idempotency_key?: string;
}

/** Statuses after which nothing can change the money flow without an operator (refund in progress or done). */
const REFUND_STATUSES = ['remboursement_en_cours', 'rembourse'];

/** Payment id derived from (user, idempotency key): same key, same payment (RFC 9562 version 8 layout). */
export function idFromKey(userId: string, key: string): string {
  const h = createHash('sha256').update(`${userId}:${key}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const GRACE_DAYS = 7;

@Injectable()
export class BillingService implements OnApplicationBootstrap {
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

  /** Routed method codes absent from every published country pack are reported at start-up (m12). */
  async onApplicationBootstrap(): Promise<void> {
    const routed = this.provider.methods?.();
    if (!routed?.length || config().openapiExport) return;
    try {
      const packs = await this.params.publishedPacks();
      const known = new Set(packs.flatMap((p) => (p.doc.objects ?? []).filter((o) => o.kind === 'payment_method').map((o) => o.code)));
      const unknown = routed.filter((m) => !known.has(m));
      if (known.size && unknown.length) this.logger.warn(`routing.payment : moyens absents des packs pays publies : ${unknown.join(', ')}`);
    } catch (e) {
      this.logger.warn(`controle des moyens de paiement impossible : ${(e as Error).message}`);
    }
  }

  /** GET /plans: plans, prices (Money), features and quotas for a country. */
  async plans(country = 'CM') {
    const r = await this.params.resolveBase(country);
    const prices = Object.values(r.objects).filter((o) => o.kind === 'plan_price');
    // Only methods that can actually be paid: with connectors, the routed ones (m12).
    const routed = this.provider.methods?.();
    const methods = Object.values(r.objects)
      .filter((o) => o.kind === 'payment_method' && (!routed || routed.includes(o.code)))
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
    // Idempotent checkout (M6): a double tap on a slow network gives one payment and one USSD prompt.
    const id = input.id ?? (input.idempotency_key ? idFromKey(user.id, input.idempotency_key) : randomUUID());
    const known = await repo.findOne({ where: { id } });
    if (known) return this.replayCheckout(user, known, input, plan.code);
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .into(Payment)
      .values({
        id,
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
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (!inserted.raw.length) {
      // Same id created by a concurrent request a moment ago.
      return this.replayCheckout(user, (await repo.findOne({ where: { id } }))!, input, plan.code);
    }
    // The routed connector is recorded before the call: a webhook faster than the HTTP answer is accepted.
    const route = this.provider.routeOf?.(input.method);
    if (route) await this.settle(id, {}, { connector: route });
    const payment = (await repo.findOne({ where: { id } }))!;
    let init: Awaited<ReturnType<PaymentProvider['initiate']>>;
    try {
      init = await this.provider.initiate(payment);
    } catch (e) {
      const known = e instanceof PaymentProviderError;
      const code = known ? e.code : (e as Error).name === 'TimeoutError' ? 'timeout' : 'network';
      const connector = known && e.connector ? { connector: e.connector } : {};
      this.logger.warn(`payment ${payment.id}: initiation failed (${code}) ${(e as Error).message}`);
      if (known && e.definitive) {
        // Explicit refusal by the aggregator: nothing can have been debited.
        await this.settle(id, { status: 'echoue' }, { error_code: code, ...connector });
        throw Errors.business('PAY-INIT', 'Le paiement n’a pas pu être lancé. Réessayez dans quelques minutes.', { payment_id: payment.id, error_code: code });
      }
      // Unknown outcome (timeout, network, 5xx): the payer may still validate the request on the phone.
      // The payment stays pending so that a later confirmation (webhook or status query) is applied, never lost.
      await this.settle(id, { status: 'en_attente' }, { error_code: code, ...connector });
      throw Errors.business('PAY-PENDING', 'Paiement en cours de vérification. Ne relancez pas : vous serez prévenu dès sa confirmation.', {
        payment_id: payment.id,
        status: 'en_attente',
        error_code: code,
      });
    }
    await this.settle(
      id,
      { status: 'en_attente', provider_ref: init.provider_ref },
      { ussd_push: init.ussd_push, ...(init.connector ? { connector: init.connector } : {}), ...(init.redirect_url ? { redirect_url: init.redirect_url } : {}) },
    );
    return {
      payment_id: payment.id,
      status: 'initie' as const,
      ussd_push: init.ussd_push,
      ...(init.redirect_url ? { redirect_url: init.redirect_url } : {}),
      amount: { amount_minor: Number(payment.amount_minor), currency: payment.currency },
      provider_ref: init.provider_ref,
    };
  }

  /**
   * Records the outcome of the initiation. The status changes only while the payment is still
   * "initie" (a confirmation that arrived during the call is never overwritten); the aggregator
   * reference and `raw` are always kept (m5), `raw` merged, not replaced.
   */
  private async settle(id: string, set: { status?: string; provider_ref?: string }, raw: Record<string, unknown>): Promise<void> {
    await this.ds.query(
      `UPDATE payments SET status = CASE WHEN status = 'initie' THEN COALESCE($2, status) ELSE status END,
              provider_ref = COALESCE(provider_ref, $3), raw = raw || $4::jsonb, updated_at = now()
        WHERE id = $1`,
      [id, set.status ?? null, set.provider_ref ?? null, JSON.stringify(raw)],
    );
  }

  /**
   * Answer to a repeated checkout: same payment, same outcome, the aggregator is not called again.
   * The id belongs to its creator and to one set of parameters (409 otherwise).
   */
  private replayCheckout(user: AuthUser, p: Payment, input: CheckoutInput, plan: string) {
    const period = input.period === 'yearly' ? 'annuel' : 'mensuel';
    const same =
      p.created_by === user.id && p.payer_type === input.account_type && p.payer_id === input.account_id && p.plan === plan && p.period === period && p.method === input.method && p.phone === input.phone;
    if (!same) throw Errors.conflict('Identifiant de paiement déjà utilisé pour une autre demande', { rule: 'PAY-IDEMPOTENCY' });
    const raw = (p.raw ?? {}) as { error_code?: string; ussd_push?: boolean; redirect_url?: string };
    if (p.status === 'echoue') {
      throw Errors.business('PAY-INIT', 'Le paiement n’a pas pu être lancé. Réessayez dans quelques minutes.', { payment_id: p.id, error_code: raw.error_code ?? null, replayed: true });
    }
    if (!p.provider_ref && raw.error_code && p.status !== 'confirme') {
      throw Errors.business('PAY-PENDING', 'Paiement en cours de vérification. Ne relancez pas : vous serez prévenu dès sa confirmation.', {
        payment_id: p.id,
        status: p.status,
        error_code: raw.error_code,
        replayed: true,
      });
    }
    return {
      payment_id: p.id,
      status: ['initie', 'en_attente'].includes(p.status) ? ('initie' as const) : p.status,
      ussd_push: raw.ussd_push ?? true,
      ...(raw.redirect_url ? { redirect_url: raw.redirect_url } : {}),
      amount: { amount_minor: Number(p.amount_minor), currency: p.currency },
      provider_ref: p.provider_ref,
      replayed: true,
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

  /**
   * Applies a provider result (webhook, simulator or dev endpoint). Idempotent and safe under
   * concurrent webhooks (row lock). A confirmation always wins over a failure: money taken must
   * give the subscription. With `from`, the payment must have been initiated by that connector
   * and, when given, the amount and currency must match; the webhook body is kept for audit.
   */
  async applyResult(
    input: { payment_id?: string; provider_ref?: string; status: string; fees_minor?: number },
    from?: { connector: string; amount_minor?: number; currency?: string; body?: unknown },
  ) {
    if (!input.payment_id && !input.provider_ref) throw Errors.notFound('Paiement');
    const ok = ['confirme', 'success', 'successful', 'paid'].includes(input.status.toLowerCase());
    const warnings: string[] = [];
    try {
      const p = await this.ds.transaction(async (m) => {
        const repo = m.getRepository(Payment);
        const found = await repo.findOne({
          where: input.payment_id ? { id: input.payment_id } : { provider_ref: input.provider_ref! },
          lock: { mode: 'pessimistic_write' },
        });
        if (!found) throw Errors.notFound('Paiement');
        const raw = (found.raw ?? {}) as { connector?: string; events?: unknown[] };
        if (from) {
          if (raw.connector !== from.connector) throw Errors.notFound('Paiement');
          const events = Array.isArray(raw.events) ? raw.events : [];
          found.raw = { ...found.raw, events: [...events, { at: new Date().toISOString(), status: input.status, body: from.body ?? null }].slice(-20) };
          const amountMismatch = from.amount_minor !== undefined && from.amount_minor !== Number(found.amount_minor);
          const currencyMismatch = from.currency !== undefined && from.currency !== found.currency;
          if (ok && (amountMismatch || currencyMismatch)) {
            await repo.save(found);
            warnings.push(`payment ${found.id}: confirmation refusee (montant ou devise differents)`);
            return found;
          }
        }
        if (REFUND_STATUSES.includes(found.status)) {
          // Refunded money: a late provider event never re-activates nor fails it; the operator decides.
          warnings.push(`payment ${found.id}: ${input.status} recu pendant ou apres remboursement (ignore)`);
          if (from) await repo.save(found);
          return found;
        }
        if (found.status === 'confirme') {
          if (!ok) warnings.push(`payment ${found.id}: echec recu apres confirmation (ignore)`);
          if (from) await repo.save(found);
          return found;
        }
        if (!ok) {
          found.status = 'echoue';
          await repo.save(found);
          return found;
        }
        if (found.status === 'echoue') warnings.push(`payment ${found.id}: confirmation tardive apres echec, abonnement active`);
        found.status = 'confirme';
        found.paid_at = new Date();
        found.fees_minor = input.fees_minor ?? null;
        const sub = await this.activate(m.getRepository(Subscription), found);
        found.subscription_id = sub.id;
        await repo.save(found);
        this.logger.log(`payment ${found.id} confirmed → ${found.payer_type}:${found.payer_id} ${found.plan}`);
        return found;
      });
      return this.serialize(p);
    } finally {
      warnings.forEach((w) => this.logger.warn(w));
    }
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
