import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
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
  /** After 409 PAY-RECENT: details.payment_id, the recent payment the payer saw and confirms paying again. */
  confirm_repeat?: string;
}

/** Statuses after which nothing can change the money flow without an operator (refund in progress or done). */
const REFUND_STATUSES = ['remboursement_en_cours', 'rembourse'];

/**
 * Payments whose money may still be taken (EF-ABO-01, PAY-OPEN): while one of them exists for a payer
 * (any plan: an account has one subscription), a new checkout is refused. Same list as the partial
 * unique index payments_open_payer_uq (migration 1761500000005), which makes the rule hold under
 * concurrent requests (checked against pg_indexes by test/payment-open-migration.e2e-spec.ts).
 */
export const OPEN_PAYMENT_STATUSES = ['initie', 'en_attente', 'a_verifier'];

/** Inserts ignored without a readable open payment before answering 409 PAY-RETRY. */
const MAX_INSERT_ATTEMPTS = 3;

export type PaymentEventSource = 'webhook' | 'statut' | 'operateur' | 'client';
/** Refused events kept on the payment. An event from another connector is never written on it (log + counter). */
export type IgnoredReason = 'montant' | 'devise';
export type EventDetail = 'repeat_confirmed' | 'late_confirm_after_resolve';

/** Provider or operator event as shown to clients: no raw aggregator body (Q-WEB-03). */
export interface PaymentEvent {
  at: string;
  status: string;
  source: PaymentEventSource;
  /** Administration only: event received but not applied. */
  ignored?: true;
  reason?: IgnoredReason;
  detail?: EventDetail;
}

const SOURCES: PaymentEventSource[] = ['webhook', 'statut', 'operateur', 'client'];
const REASONS: IgnoredReason[] = ['montant', 'devise'];
const DETAILS: EventDetail[] = ['repeat_confirmed', 'late_confirm_after_resolve'];

/**
 * Cleans the journal kept in payments.raw.events (webhook bodies may hold phone numbers or names).
 * `source` is the one written by our code when the event was recorded, never read from the body
 * (an event recorded before it existed shows "webhook"). The payer view leaves out refused events:
 * they never gave the payment its status; the administration sees them with the reason.
 */
export function paymentEvents(raw: unknown, view: 'payeur' | 'admin' = 'payeur'): PaymentEvent[] {
  const events = raw && typeof raw === 'object' ? (raw as { events?: unknown }).events : undefined;
  if (!Array.isArray(events)) return [];
  return events.flatMap((e): PaymentEvent[] => {
    if (!e || typeof e !== 'object') return [];
    const { at, status, source, ignored, reason, detail } = e as { at?: unknown; status?: unknown; source?: unknown; ignored?: unknown; reason?: unknown; detail?: unknown };
    if (typeof at !== 'string' || typeof status !== 'string') return [];
    const src = SOURCES.includes(source as PaymentEventSource) ? (source as PaymentEventSource) : 'webhook';
    const det = DETAILS.includes(detail as EventDetail) ? { detail: detail as EventDetail } : {};
    if (ignored === true) {
      if (view === 'payeur') return [];
      return [{ at, status, source: src, ignored: true, ...(REASONS.includes(reason as IgnoredReason) ? { reason: reason as IgnoredReason } : {}), ...det }];
    }
    return [{ at, status, source: src, ...det }];
  });
}

/** Payment id derived from (user, idempotency key): same key, same payment (RFC 9562 version 8 layout). */
export function idFromKey(userId: string, key: string): string {
  const h = createHash('sha256').update(`${userId}:${key}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const GRACE_DAYS = 7;

/** Where a result comes from; written by our code into the payment journal. */
export interface ResultSource {
  source: PaymentEventSource;
  /** Required for provider events: the connector that sends them. */
  connector?: string;
  amount_minor?: number;
  currency?: string;
  /** Kept for audit in payments.raw, never shown. */
  body?: unknown;
  /** Applied only from this status (operator decision), 409 PAY-RESOLVE-STATUS otherwise. */
  expect_status?: string;
}

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

  /**
   * Currency of a country (ISO 4217), from its published country pack (`currency`). Never a default
   * written in the code: null when no country pack gives one.
   */
  async countryCurrency(country: string): Promise<string | null> {
    const packs = await this.params.publishedPacks();
    const pack = packs
      .filter((p) => p.doc.level === 'pays' && p.doc.country === country && typeof p.doc.currency === 'string' && /^[A-Z]{3}$/.test(p.doc.currency))
      .at(-1);
    return pack?.doc.currency ?? null;
  }

  /**
   * Price of a subscription. Recorded without its currency: the currency of the account's country pack;
   * without one, no price (null) rather than an invented currency or an error on the whole answer.
   */
  private async subscriptionPrice(sub: Subscription): Promise<{ amount_minor: number; currency: string } | null> {
    if (sub.currency) return { amount_minor: Number(sub.price_minor), currency: sub.currency };
    const table = sub.account_type === 'organisation' ? 'organisations' : 'users';
    const rows: Array<{ country: string }> = await this.ds.query(`SELECT country FROM ${table} WHERE id = $1`, [sub.account_id]);
    const country = rows[0]?.country;
    const currency = country ? await this.countryCurrency(country) : null;
    if (!currency) {
      this.logger.warn(`abonnement ${sub.id} : prix sans devise et aucune devise pour le pays ${country ?? 'inconnu'} (price: null)`);
      return null;
    }
    return { amount_minor: Number(sub.price_minor), currency };
  }

  private noCurrency(country: string) {
    return Errors.business('PAY-CURRENCY', `Aucune devise n’est paramétrée pour le pays ${country}.`, { country });
  }

  /** GET /plans: plans, prices (Money), features and quotas for a country. */
  async plans(country = 'CM') {
    const r = await this.params.resolveBase(country);
    const prices = Object.values(r.objects).filter((o) => o.kind === 'plan_price');
    // Currency of the country pack; a pack without one but with prices uses the currency of its prices.
    const countryCurrency = (await this.countryCurrency(country)) ?? (prices.map((x) => x.currency).find((c) => typeof c === 'string') as string | undefined);
    if (!countryCurrency) throw this.noCurrency(country);
    // Only methods that can actually be paid: with connectors, the routed ones (m12).
    const routed = this.provider.methods?.();
    const methods = Object.values(r.objects)
      .filter((o) => o.kind === 'payment_method' && (!routed || routed.includes(o.code)))
      .map((o) => ({ code: o.code, label: o.label }));
    const plans = this.params.plans(r).map((p) => {
      const price = prices.find((x) => x.code === p.code) as { currency: string; monthly_minor: number; yearly_minor: number; note?: string } | undefined;
      const currency = price?.currency ?? countryCurrency;
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
    return { country, currency: countryCurrency, data, plans, payment_methods: methods };
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
    const keyId = input.idempotency_key ? idFromKey(user.id, input.idempotency_key) : undefined;
    // Both given: they must designate the same payment, otherwise the replay would depend on which one wins.
    if (input.id && keyId && input.id !== keyId) throw Errors.validation({ 'Idempotency-Key': 'incompatible avec id : envoyer l’un ou l’autre' });
    const id = input.id ?? keyId ?? randomUUID();
    const known = await repo.findOne({ where: { id } });
    if (known) return this.replayCheckout(user, known, input, plan.code);
    // PAY-OPEN, then PAY-RECENT (PO decision 2026-11-13), checked at each try in the insert transaction under
    // a per-payer lock: concurrent checkouts of a payer are decided one after the other. The partial unique
    // index payments_open_payer_uq stays the last guard (two simultaneous checkouts give one payment).
    const labelOf = (code: string | null) => catalog.plans.find((p) => p.code === code)?.label ?? code ?? '';
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.ds.transaction(async (m): Promise<{ same?: Payment; created?: boolean }> => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`checkout:${input.account_type}:${input.account_id}`]);
        // Same id created by a concurrent request a moment ago: answered like a replay.
        const same = await m.getRepository(Payment).findOne({ where: { id } });
        if (same) return { same };
        const open = await this.openPayment(m, input.account_type, input.account_id);
        if (open) throw this.payOpen(open);
        const repeatOf = await this.recentGuard(m, input, labelOf);
        const r = await m
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
            ...(repeatOf ? { raw: { events: [{ at: new Date().toISOString(), status: 'initie', source: 'client', detail: 'repeat_confirmed' }] } } : {}),
          })
          .orIgnore()
          .returning('id')
          .execute();
        const created = r.raw.length > 0;
        // The payer's confirmation is journaled with the payment, in the same transaction.
        if (created && repeatOf) {
          const role = input.account_type === 'organisation' ? 'gestionnaire_org' : input.account_id === user.id ? 'payeur' : user.platform_roles.join(',') || 'payeur';
          await this.audit(m, id, 'checkout_repeat_confirmed', user, { recent_payment_id: repeatOf.id, plan: repeatOf.plan, paid_at: repeatOf.paid_at, new_plan: plan.code }, role);
        }
        return { created };
      });
      if (outcome.same) return this.replayCheckout(user, outcome.same, input, plan.code);
      if (outcome.created) break;
      // Insert ignored by the index: another subscription payment of this payer is open (EF-ABO-01).
      const open = await this.openPayment(this.ds, input.account_type, input.account_id);
      if (open) throw this.payOpen(open);
      // The open payment ended between the insert and the read: tried again, then a clean 409.
      if (attempt >= MAX_INSERT_ATTEMPTS - 1) {
        this.logger.warn(`checkout ${id}: insertion ignoree ${MAX_INSERT_ATTEMPTS} fois sans paiement ouvert lisible`);
        throw Errors.conflict('Un autre paiement de ce compte vient de changer d’état. Réessayez dans un instant.', { rule: 'PAY-RETRY' });
      }
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

  private payOpen(open: Payment) {
    return Errors.conflict('Un paiement d’abonnement est déjà en cours pour ce compte. Validez-le sur votre téléphone ou attendez son issue.', {
      rule: 'PAY-OPEN',
      payment_id: open.id,
      status: open.status,
      plan: open.plan,
    });
  }

  /**
   * PAY-RECENT: the most recent subscription payment of the payer confirmed within the window (database
   * clock). Paying again needs `confirm_repeat` = that payment's id, i.e. the payment shown to the payer;
   * a confirmation of an older payment gets a new 409 with the current one. Without a recent payment,
   * `confirm_repeat` is ignored. Returns the payment the new one repeats, or null.
   */
  private async recentGuard(m: EntityManager, input: CheckoutInput, labelOf: (code: string | null) => string) {
    const minutes = config().paymentRecentGuardMin;
    if (minutes <= 0) return null;
    const rows: Array<{ id: string; plan: string | null; paid_at: Date; ago_min: number }> = await m.query(
      `SELECT id, plan, paid_at, floor(extract(epoch FROM now() - paid_at) / 60)::int AS ago_min FROM payments
        WHERE payer_type = $1 AND payer_id = $2 AND purpose = 'abonnement' AND status = 'confirme'
          AND paid_at > now() - make_interval(mins => $3)
        ORDER BY paid_at DESC LIMIT 1`,
      [input.account_type, input.account_id, minutes],
    );
    const recent = rows[0];
    if (!recent) return null;
    if (input.confirm_repeat === recent.id) return recent;
    throw Errors.conflict(`Vous avez déjà payé la formule ${labelOf(recent.plan)} il y a ${Math.max(1, recent.ago_min)} min. Confirmez pour payer encore.`, {
      rule: 'PAY-RECENT',
      payment_id: recent.id,
      plan: recent.plan,
      paid_at: new Date(recent.paid_at).toISOString(),
    });
  }

  /** Journal entry in audit_log; `user` null = the system. */
  private async audit(m: EntityManager, paymentId: string, action: string, user: AuthUser | null, diff: Record<string, unknown>, role?: string): Promise<void> {
    await m.query(`INSERT INTO audit_log (entity, entity_id, action, actor_id, actor_role, diff) VALUES ('payments', $1, $2, $3, $4, $5)`, [
      paymentId,
      action,
      user?.id ?? null,
      role ?? (user ? user.platform_roles.join(',') : 'systeme'),
      JSON.stringify(diff),
    ]);
  }

  /** Events from another connector than the payment's, refused without writing on the payment (per connector). */
  private readonly foreignEvents = new Map<string, number>();

  foreignEventCounts(): Record<string, number> {
    return Object.fromEntries(this.foreignEvents);
  }

  /** Open subscription payment of a payer, whatever the plan (at most one: partial unique index). */
  private openPayment(m: EntityManager | DataSource, payerType: string, payerId: string): Promise<Payment | null> {
    return m
      .getRepository(Payment)
      .createQueryBuilder('p')
      .where('p.payer_type = :payerType AND p.payer_id = :payerId AND p.purpose = :purpose AND p.status IN (:...open)', {
        payerType,
        payerId,
        purpose: 'abonnement',
        open: OPEN_PAYMENT_STATUSES,
      })
      .orderBy('p.created_at', 'DESC')
      .getOne();
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

  /** Payment view; `admin` adds the refused provider events to the journal. */
  serialize(p: Payment, view: 'payeur' | 'admin' = 'payeur') {
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
      events: paymentEvents(p.raw, view),
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
   * Applies a provider result (webhook, status query, simulator, dev endpoint) or an operator decision.
   * Idempotent and safe under concurrent webhooks (row lock). A confirmation always wins over a failure:
   * money taken must give the subscription. With `from`, the event is journaled with the source given
   * here by our code; a provider event must come from the connector that initiated the payment and,
   * when given, carry the same amount and currency, otherwise it is journaled as ignored (with its
   * reason) and not applied. `expect_status`: applied only from that status (409 otherwise).
   */
  async applyResult(
    input: { payment_id?: string; provider_ref?: string; status: string; fees_minor?: number },
    from?: ResultSource,
    /** Runs in the same transaction once the result is applied (e.g. the operator's audit entry). */
    within?: (m: EntityManager, p: Payment) => Promise<void>,
  ) {
    if (!input.payment_id && !input.provider_ref) throw Errors.notFound('Paiement');
    const ok = ['confirme', 'success', 'successful', 'paid'].includes(input.status.toLowerCase());
    const warnings: string[] = [];
    try {
      const { p } = await this.ds.transaction(async (m) => {
        const result = await this.decide(m, input, ok, warnings, from);
        if (within && !result.refused) await within(m, result.p);
        return result;
      });
      return this.serialize(p);
    } finally {
      warnings.forEach((w) => this.logger.warn(w));
    }
  }

  private async decide(
    m: EntityManager,
    input: { payment_id?: string; provider_ref?: string; status: string; fees_minor?: number },
    ok: boolean,
    warnings: string[],
    from?: ResultSource,
  ): Promise<{ p: Payment; refused: IgnoredReason | null }> {
    const repo = m.getRepository(Payment);
    const provider = from && from.source !== 'operateur';
    const q = repo.createQueryBuilder('p').setLock('pessimistic_write');
    if (input.payment_id) q.where('p.id = :id', { id: input.payment_id });
    else {
      q.where('p.provider_ref = :ref', { ref: input.provider_ref });
      // An aggregator reference is only looked up among the payments of the connector that sends it.
      if (provider) q.andWhere(`p.raw->>'connector' = :connector`, { connector: from.connector ?? '' });
    }
    const found = await q.getOne();
    if (!found) throw Errors.notFound('Paiement');
    if (from?.expect_status && found.status !== from.expect_status) {
      throw Errors.conflict(`Ce paiement n’est plus « ${from.expect_status} ».`, { rule: 'PAY-RESOLVE-STATUS', status: found.status });
    }
    const raw = (found.raw ?? {}) as { connector?: string; events?: unknown[]; resolved?: { outcome?: string } };
    if (provider && raw.connector !== from.connector) {
      // Another connector: nothing is written on the payment (its journal cannot be flooded); log + counter.
      const n = (this.foreignEvents.get(from.connector ?? '') ?? 0) + 1;
      this.foreignEvents.set(from.connector ?? '', n);
      warnings.push(`payment ${found.id}: ${input.status} de ${from.connector ?? '?'} refuse (connecteur different, ${n} depuis le demarrage)`);
      throw Errors.notFound('Paiement');
    }
    let event: Record<string, unknown> | null = null;
    if (from) {
      let ignored: IgnoredReason | null = null;
      if (ok && from.amount_minor !== undefined && from.amount_minor !== Number(found.amount_minor)) ignored = 'montant';
      else if (ok && from.currency !== undefined && from.currency !== found.currency) ignored = 'devise';
      const events = Array.isArray(raw.events) ? raw.events : [];
      event = { at: new Date().toISOString(), status: input.status, source: from.source, ...(ignored ? { ignored: true, reason: ignored } : {}), body: from.body ?? null };
      found.raw = { ...found.raw, events: [...events, event].slice(-20) };
      // An operator decision is remembered: a later provider confirmation must be reviewed.
      if (from.source === 'operateur') found.raw = { ...found.raw, resolved: { outcome: ok ? 'confirme' : 'echoue', at: event.at } };
      if (ignored) {
        await repo.save(found);
        warnings.push(`payment ${found.id}: ${input.status} de ${from.connector ?? from.source} ignore (${ignored})`);
        return { p: found, refused: ignored };
      }
    }
    if (REFUND_STATUSES.includes(found.status)) {
      // Refunded money: a late provider event never re-activates nor fails it; the operator decides.
      warnings.push(`payment ${found.id}: ${input.status} recu pendant ou apres remboursement (ignore)`);
      if (from) await repo.save(found);
      return { p: found, refused: null };
    }
    if (found.status === 'confirme') {
      if (!ok) warnings.push(`payment ${found.id}: echec recu apres confirmation (ignore)`);
      if (from) await repo.save(found);
      return { p: found, refused: null };
    }
    if (!ok) {
      found.status = 'echoue';
      await repo.save(found);
      return { p: found, refused: null };
    }
    if (found.status === 'echoue') warnings.push(`payment ${found.id}: confirmation tardive apres echec, abonnement active`);
    if (found.status === 'echoue' && raw.resolved?.outcome === 'echoue') {
      // The operator had decided "echoue": the money arrived after all. Activated (a confirmation always
      // wins) but flagged for review, and journaled.
      found.raw = { ...found.raw, needs_review: true };
      if (event) event.detail = 'late_confirm_after_resolve';
      await this.audit(m, found.id, 'late_confirm_after_resolve', null, { resolved: raw.resolved, source: from?.source ?? 'webhook', connector: from?.connector ?? null });
      warnings.push(`payment ${found.id}: confirmation apres decision operateur "echoue" : a revoir (needs_review)`);
    }
    found.status = 'confirme';
    found.paid_at = new Date();
    found.fees_minor = input.fees_minor ?? null;
    const sub = await this.activate(m.getRepository(Subscription), found);
    found.subscription_id = sub.id;
    await repo.save(found);
    this.logger.log(`payment ${found.id} confirmed → ${found.payer_type}:${found.payer_id} ${found.plan}`);
    return { p: found, refused: null };
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
      price: sub?.price_minor !== null && sub?.price_minor !== undefined ? await this.subscriptionPrice(sub) : null,
      subscription: sub ? { id: sub.id, account_type: sub.account_type, account_id: sub.account_id } : null,
      entitlements: e,
    };
  }
}
