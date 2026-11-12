import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { AppError, Errors } from '../common/errors';
import { config } from '../config';
import { Payment } from '../database/entities';
import { BillingService } from './billing.service';
import { isNetworkError, PAYMENT_PROVIDER, PaymentProvider, PaymentProviderError, ProviderPaymentStatus, ProviderTransaction, RefundResult } from './payment.providers';

/** Lease written on claimed rows: another run (or instance) does not take them meanwhile (m1). */
const LEASE_MS = 5 * 60_000;
/** A batch stops before the scheduler lock (55 s) expires; claimed rows left are taken after the lease. */
const BATCH_BUDGET_MS = 45_000;
/** A refund call older than this, still "en_cours", is considered interrupted (process stopped). */
const REFUND_IN_FLIGHT_MS = 10 * 60_000;

/** Error code for the payment journal: aggregator code, network, or a programming error (rethrown, m7). */
function errorCode(e: unknown): string {
  if (e instanceof PaymentProviderError) return e.code;
  if (isNetworkError(e)) return (e as Error).name === 'TimeoutError' ? 'timeout' : 'network';
  throw e;
}

/** Pending payments whose outcome is still unknown. */
const OPEN = ['initie', 'en_attente'];

/** Delay before the next status query: N, 2N, 4N... minutes, capped (exponential backoff). */
export function nextPollDelayMin(attempt: number, baseMin: number, capMin: number): number {
  return Math.min(baseMin * 2 ** Math.max(0, attempt), capMin);
}

export interface PollReport {
  checked: number;
  confirmed: number;
  failed: number;
  still_pending: number;
  flagged: number;
  errors: number;
}

export interface Divergence {
  connector: string;
  payment_id: string | null;
  provider_ref: string | null;
  /** Our status (null: unknown to us). */
  base: string | null;
  /** Aggregator status (null: absent from its list). */
  fournisseur: string | null;
  ecart: 'statut' | 'montant' | 'inconnu_en_base' | 'absent_chez_fournisseur';
}

export interface ReconciliationReport {
  day: string;
  generated_at: string;
  totals: { payments: number; confirmes: number; confirmed_amounts: Array<{ amount_minor: number; currency: string }> };
  confirmes_sans_abonnement: Array<{ payment_id: string; payer_type: string; payer_id: string; plan: string | null }>;
  abonnements_sans_paiement: Array<{ subscription_id: string; account_type: string; account_id: string; plan: string }>;
  divergences: Divergence[];
  /** Connectors that could not be checked against the aggregator (no list nor status query, or error). */
  non_verifies: Array<{ connector: string; raison: string }>;
  /** Payments that could not be checked one by one (the others are, m3). */
  erreurs: Array<{ connector: string; payment_id: string; raison: string }>;
  /** False when a temporary error left something unchecked: the hourly job produces the report again. */
  complet: boolean;
  sources: Array<{ connector: string; source: 'liste' | 'statut' }>;
}

/** Same money outcome? (a refunded payment was confirmed at the aggregator.) */
function sameOutcome(base: string, provider: ProviderPaymentStatus['status']): boolean {
  if (provider === 'confirme') return ['confirme', 'remboursement_en_cours', 'rembourse'].includes(base);
  if (provider === 'echoue') return base === 'echoue';
  if (provider === 'en_attente') return [...OPEN, 'a_verifier'].includes(base);
  return true;
}

/**
 * Operations on payments after the checkout (M6, P1.2, EF-ABO-01): status queries for payments left
 * pending, refunds, and the daily provider ↔ database reconciliation.
 */
@Injectable()
export class PaymentOpsService {
  private readonly logger = new Logger('PaymentOps');

  constructor(
    private readonly ds: DataSource,
    private readonly billing: BillingService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /* ---------------- pending payments ---------------- */

  /**
   * Queries the aggregator for payments still open after `paymentStatusAfterMin` minutes, again after
   * N, 2N, 4N... minutes (capped). After `paymentStatusMaxAttempts` unanswered queries, the payment is
   * set to "a_verifier": visible to the administration, and still confirmed if a webhook arrives later.
   */
  async pollPending(now = new Date()): Promise<PollReport> {
    const cfg = config();
    const report: PollReport = { checked: 0, confirmed: 0, failed: 0, still_pending: 0, flagged: 0, errors: 0 };
    // Rows are claimed atomically (lease on next_at, SKIP LOCKED): overlapping runs never query twice (m1).
    const [due]: [Payment[], number] = await this.ds.query(
      `UPDATE payments SET raw = raw || jsonb_build_object('poll', COALESCE(raw->'poll', '{}'::jsonb) || jsonb_build_object('next_at', $4::text))
        WHERE id IN (
          SELECT id FROM payments
           WHERE status = ANY($1) AND created_at <= $2::timestamptz - make_interval(mins => $3)
             AND COALESCE((raw->'poll'->>'next_at')::timestamptz, '-infinity') <= $2::timestamptz
           ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [OPEN, now.toISOString(), cfg.paymentStatusAfterMin, new Date(now.getTime() + LEASE_MS).toISOString()],
    );
    const started = Date.now();
    for (const p of due) {
      if (Date.now() - started > BATCH_BUDGET_MS) break;
      report.checked++;
      try {
        report[await this.checkOne(p, now)]++;
      } catch (e) {
        // One payment in error never blocks the others; it is queried again at the next run.
        report.errors++;
        this.logger.warn(`payment ${p.id}: verification impossible (${(e as Error).message})`);
      }
    }
    return report;
  }

  /** One status query; returns how the payment ended up. */
  async checkOne(p: Payment, now = new Date()): Promise<'confirmed' | 'failed' | 'still_pending' | 'flagged' | 'errors'> {
    const cfg = config();
    const raw = (p.raw ?? {}) as { poll?: { count?: number }; connector?: string };
    const attempt = (raw.poll?.count ?? 0) + 1;
    let st: ProviderPaymentStatus | null = null;
    let error: string | null = null;
    try {
      st = this.provider.status ? await this.provider.status(p) : null;
    } catch (e) {
      // "non_interrogeable_sans_reference": no query sent, nothing concluded (M1).
      error = errorCode(e);
      this.logger.warn(`payment ${p.id}: statut illisible (${error})`);
    }
    if (st && (st.status === 'confirme' || st.status === 'echoue')) {
      const res = await this.billing.applyResult(
        { payment_id: p.id, status: st.status, ...(st.fees_minor !== undefined ? { fees_minor: st.fees_minor } : {}) },
        raw.connector
          ? {
              connector: raw.connector,
              body: { source: 'statut', status: st.raw_status },
              ...(st.amount_minor !== undefined ? { amount_minor: st.amount_minor } : {}),
              ...(st.currency ? { currency: st.currency } : {}),
            }
          : undefined,
      );
      if (res.status === 'confirme') return 'confirmed';
      if (res.status === 'echoue') return 'failed';
    }
    const exhausted = attempt >= cfg.paymentStatusMaxAttempts;
    const next = new Date(now.getTime() + nextPollDelayMin(attempt - 1, cfg.paymentStatusAfterMin, cfg.paymentStatusBackoffCapMin) * 60_000);
    const poll = { count: attempt, last_at: now.toISOString(), next_at: next.toISOString(), last: st ? st.raw_status || st.status : (error ?? 'pas_de_requete_de_statut') };
    // Conditional update: a confirmation applied meanwhile is kept.
    await this.ds.query(
      `UPDATE payments SET raw = raw || $2::jsonb, status = CASE WHEN $3 THEN 'a_verifier' ELSE status END, updated_at = now()
        WHERE id = $1 AND status = ANY($4)`,
      [p.id, JSON.stringify({ poll }), exhausted, OPEN],
    );
    if (exhausted) {
      this.logger.warn(`payment ${p.id}: statut inconnu apres ${attempt} interrogations, passe a "a_verifier"`);
      return 'flagged';
    }
    return error ? 'errors' : 'still_pending';
  }

  /** Forces a status query now (administration). */
  async checkNow(id: string) {
    const p = await this.ds.getRepository(Payment).findOne({ where: { id } });
    if (!p) throw Errors.notFound('Paiement');
    if (![...OPEN, 'a_verifier'].includes(p.status)) return { ...this.billing.serialize(p), checked: false };
    // An "a_verifier" payment is queried again without changing its status if nothing is known.
    const outcome = p.status === 'a_verifier' ? await this.checkFlagged(p) : await this.checkOne(p);
    const fresh = (await this.ds.getRepository(Payment).findOne({ where: { id } }))!;
    return { ...this.billing.serialize(fresh), checked: true, outcome };
  }

  private async checkFlagged(p: Payment): Promise<string> {
    let st: ProviderPaymentStatus | null;
    try {
      st = this.provider.status ? await this.provider.status(p) : null;
    } catch (e) {
      return errorCode(e);
    }
    if (!st || (st.status !== 'confirme' && st.status !== 'echoue')) return st?.status ?? 'pas_de_requete_de_statut';
    const raw = (p.raw ?? {}) as { connector?: string };
    const res = await this.billing.applyResult({ payment_id: p.id, status: st.status }, raw.connector ? { connector: raw.connector, body: { source: 'statut', status: st.raw_status } } : undefined);
    return res.status;
  }

  async list(status?: string, limit = 50) {
    const rows: Payment[] = await this.ds.getRepository(Payment).find({
      where: status ? { status } : {},
      order: { created_at: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return { data: rows.map((p) => this.adminView(p)) };
  }

  /** One payment for the administration, with its provider event journal (Q-WEB-03). */
  async get(id: string) {
    const p = await this.ds.getRepository(Payment).findOne({ where: { id } });
    if (!p) throw Errors.notFound('Paiement');
    return this.adminView(p);
  }

  private adminView(p: Payment) {
    const raw = (p.raw ?? {}) as { connector?: string; poll?: unknown; refund?: unknown; error_code?: string };
    return { ...this.billing.serialize(p), payer_type: p.payer_type, payer_id: p.payer_id, connector: raw.connector ?? null, error_code: raw.error_code ?? null, poll: raw.poll ?? null, refund: raw.refund ?? null };
  }

  /* ---------------- refunds ---------------- */

  /** Journal entry; `user` null = the system (scheduled refund status query). */
  private async audit(paymentId: string, action: string, user: AuthUser | null, diff: Record<string, unknown>) {
    await this.ds.query(`INSERT INTO audit_log (entity, entity_id, action, actor_id, actor_role, diff) VALUES ('payments', $1, $2, $3, $4, $5)`, [
      paymentId,
      action,
      user?.id ?? null,
      user ? user.platform_roles.join(',') : 'systeme',
      JSON.stringify(diff),
    ]);
  }

  /**
   * Refunds a confirmed payment through its connector (administration, journaled in audit_log).
   * The refund key is created once and reused. One call at a time (M3): the transition to
   * "remboursement_en_cours" with refund.status "en_cours" is taken under a row lock, and a second
   * request meanwhile gets 409. The outcome is read only as the descriptor says; a refund still
   * pending is followed by the refund status query (poller), or shown "a_verifier" without one.
   * The subscription is not changed here (docs/plan/questions.md Q-INT-01).
   */
  async refund(user: AuthUser, id: string, reason: string) {
    if (!this.provider.refund) throw Errors.business('PAY-REFUND-UNSUPPORTED', 'Le remboursement n’est pas disponible avec ce fournisseur.');
    const prepared = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(Payment);
      const p = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw Errors.notFound('Paiement');
      if (p.status === 'rembourse') return { p, done: true };
      const raw = (p.raw ?? {}) as { refund?: { id?: string; status?: string; requested_at?: string } };
      if (p.status === 'remboursement_en_cours') {
        const st = raw.refund?.status;
        const age = Date.now() - Date.parse(raw.refund?.requested_at ?? '');
        if (st === 'en_attente' || (st === 'en_cours' && age < REFUND_IN_FLIGHT_MS)) {
          throw new AppError('CONFLICT', 'Un remboursement est déjà en cours pour ce paiement.', { details: { rule: 'PAY-REFUND-IN-PROGRESS', refund_status: st } });
        }
        // "inconnu", "a_verifier" or an interrupted call: retried with the same key.
      } else if (p.status !== 'confirme') {
        throw Errors.business('PAY-REFUND-STATUS', 'Seul un paiement confirmé peut être remboursé.', { status: p.status });
      }
      const refund = { ...(raw.refund ?? {}), id: raw.refund?.id ?? randomUUID(), requested_at: new Date().toISOString(), requested_by: user.id, reason, status: 'en_cours' };
      p.raw = { ...p.raw, refund };
      p.status = 'remboursement_en_cours';
      await repo.save(p);
      return { p, done: false };
    });
    if (prepared.done) return { ...this.billing.serialize(prepared.p), refund: (prepared.p.raw as { refund?: unknown }).refund ?? null };
    const p = prepared.p;
    const refundId = (p.raw as { refund: { id: string } }).refund.id;
    await this.audit(p.id, 'refund_requested', user, { reason, refund_id: refundId, amount_minor: Number(p.amount_minor), currency: p.currency });
    let r: RefundResult;
    try {
      r = await this.provider.refund(p, refundId, reason);
    } catch (e) {
      const code = errorCode(e);
      if (e instanceof PaymentProviderError && e.definitive) {
        // Nothing sent (no refund operation, or no aggregator reference): back to "confirme".
        await this.finishRefund(p.id, 'confirme', { status: 'refuse', error: code }, user);
        throw Errors.business('PAY-REFUND-REFUSED', 'Remboursement impossible avec ce fournisseur.', { payment_id: p.id, error_code: code });
      }
      r = { status: 'inconnu' };
      (r as RefundResult & { error?: string }).error = code;
    }
    return this.applyRefund(p, r, user);
  }

  /** Applies a refund outcome (call or status query). */
  private async applyRefund(p: Payment, r: RefundResult & { error?: string }, user: AuthUser | null) {
    const extra = { ...(r.refund_ref ? { ref: r.refund_ref } : {}), ...(r.http_status ? { http_status: r.http_status } : {}), ...(r.error ? { error: r.error } : {}) };
    if (r.status === 'rembourse') {
      this.logger.log(`payment ${p.id}: rembourse (${r.refund_ref ?? 'sans reference'})`);
      return this.finishRefund(p.id, 'rembourse', { status: 'rembourse', done_at: new Date().toISOString(), ...extra }, user);
    }
    if (r.status === 'echoue') {
      await this.finishRefund(p.id, 'confirme', { status: 'refuse', ...extra }, user);
      throw Errors.business('PAY-REFUND-REFUSED', 'Le fournisseur a refusé le remboursement.', { payment_id: p.id });
    }
    // Pending or unknown: followed by the refund status query when the connector has one.
    const followed = !!this.provider.refundStatus && !!this.provider.refundStatusAvailable?.(p);
    const status = r.status === 'en_attente' ? (followed ? 'en_attente' : 'a_verifier') : followed ? 'inconnu' : 'a_verifier';
    const next = new Date(Date.now() + config().paymentStatusAfterMin * 60_000).toISOString();
    const out = await this.finishRefund(p.id, 'remboursement_en_cours', { status, ...extra, ...(followed ? { poll: { count: 0, next_at: next } } : {}) }, user);
    if (r.status === 'inconnu') {
      throw Errors.business('PAY-REFUND-PENDING', 'Remboursement en cours de vérification. Il ne sera pas fait deux fois.', {
        payment_id: p.id,
        refund_status: status,
        ...(r.error ? { error_code: r.error } : r.http_status ? { error_code: `http_${r.http_status}` } : {}),
      });
    }
    return out;
  }

  private async finishRefund(id: string, status: string, refundPatch: Record<string, unknown>, user: AuthUser | null) {
    await this.ds.query(
      `UPDATE payments SET status = $2, raw = jsonb_set(raw, '{refund}', COALESCE(raw->'refund', '{}'::jsonb) || $3::jsonb), updated_at = now()
        WHERE id = $1 AND status = 'remboursement_en_cours'`,
      [id, status, JSON.stringify(refundPatch)],
    );
    await this.audit(id, `refund_${refundPatch.status as string}`, user, refundPatch);
    const fresh = (await this.ds.getRepository(Payment).findOne({ where: { id } }))!;
    return { ...this.billing.serialize(fresh), refund: (fresh.raw as { refund?: unknown }).refund ?? null };
  }

  /**
   * Refunds whose outcome is pending or unknown: refund status query at growing intervals (claimed
   * like payments); after `paymentStatusMaxAttempts` the refund is shown "a_verifier".
   */
  async pollRefunds(now = new Date()): Promise<{ checked: number; refunded: number; refused: number; flagged: number }> {
    const cfg = config();
    const out = { checked: 0, refunded: 0, refused: 0, flagged: 0 };
    if (!this.provider.refundStatus) return out;
    const [due]: [Payment[], number] = await this.ds.query(
      `UPDATE payments SET raw = jsonb_set(raw, '{refund,poll,next_at}', to_jsonb($2::text), true)
        WHERE id IN (
          SELECT id FROM payments
           WHERE status = 'remboursement_en_cours' AND raw->'refund'->>'status' IN ('en_attente','inconnu')
             AND COALESCE((raw->'refund'->'poll'->>'next_at')::timestamptz, '-infinity') <= $1::timestamptz
           ORDER BY updated_at LIMIT 50 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [now.toISOString(), new Date(now.getTime() + LEASE_MS).toISOString()],
    );
    for (const p of due) {
      out.checked++;
      const refund = (p.raw as { refund: { id: string; ref?: string; poll?: { count?: number } } }).refund;
      const attempt = (refund.poll?.count ?? 0) + 1;
      let r: RefundResult | null = null;
      try {
        r = await this.provider.refundStatus(p, refund.id, refund.ref);
      } catch (e) {
        this.logger.warn(`payment ${p.id}: statut du remboursement illisible (${errorCode(e)})`);
      }
      if (r?.status === 'rembourse' || r?.status === 'echoue') {
        try {
          await this.applyRefund(p, r, null);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
        }
        out[r.status === 'rembourse' ? 'refunded' : 'refused']++;
        continue;
      }
      const exhausted = attempt >= cfg.paymentStatusMaxAttempts;
      const next = new Date(now.getTime() + nextPollDelayMin(attempt - 1, cfg.paymentStatusAfterMin, cfg.paymentStatusBackoffCapMin) * 60_000);
      await this.ds.query(
        `UPDATE payments SET raw = jsonb_set(raw, '{refund}', (raw->'refund') || $2::jsonb), updated_at = now() WHERE id = $1 AND status = 'remboursement_en_cours'`,
        [p.id, JSON.stringify({ poll: { count: attempt, next_at: next.toISOString() }, ...(exhausted ? { status: 'a_verifier' } : {}) })],
      );
      if (exhausted) out.flagged++;
    }
    return out;
  }

  /* ---------------- daily reconciliation ---------------- */

  /** UTC bounds of a business day in the country time zone. */
  private async bounds(day: string): Promise<{ from: string; to: string }> {
    const rows: Array<{ f: Date; t: Date }> = await this.ds.query(`SELECT ($1::date)::timestamp AT TIME ZONE $2 AS f, ($1::date + 1)::timestamp AT TIME ZONE $2 AS t`, [day, config().tz]);
    return { from: new Date(rows[0].f).toISOString(), to: new Date(rows[0].t).toISOString() };
  }

  /**
   * Provider ↔ database report for one business day: confirmed payments without subscription,
   * subscriptions renewed that day without a confirmed payment, and statuses (or amounts) that differ
   * from the aggregator's. The aggregator's list is used when the connector describes one, otherwise
   * each payment of the day is checked with the status query. The report is stored (one per day).
   */
  async reconcile(day: string): Promise<ReconciliationReport> {
    const { from, to } = await this.bounds(day);
    const payments: Payment[] = await this.ds.getRepository(Payment).query(`SELECT * FROM payments WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at`, [from, to]);
    const confirmed = payments.filter((p) => p.status === 'confirme');
    const amounts = new Map<string, number>();
    for (const p of confirmed) amounts.set(p.currency, (amounts.get(p.currency) ?? 0) + Number(p.amount_minor));
    const noSub: Array<{ id: string; payer_type: string; payer_id: string; plan: string | null }> = await this.ds.query(
      `SELECT p.id, p.payer_type, p.payer_id, p.plan FROM payments p
        WHERE p.status = 'confirme' AND p.purpose = 'abonnement' AND p.paid_at >= $1 AND p.paid_at < $2
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = p.subscription_id AND s.account_id = p.payer_id)`,
      [from, to],
    );
    const subNoPay: Array<{ id: string; account_type: string; account_id: string; plan: string }> = await this.ds.query(
      `SELECT s.id, s.account_type, s.account_id, s.plan FROM subscriptions s
        WHERE s.updated_at >= $1 AND s.updated_at < $2 AND COALESCE(s.price_minor, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.subscription_id = s.id AND p.status IN ('confirme','remboursement_en_cours','rembourse'))`,
      [from, to],
    );
    const report: ReconciliationReport = {
      day,
      generated_at: new Date().toISOString(),
      totals: { payments: payments.length, confirmes: confirmed.length, confirmed_amounts: [...amounts].map(([currency, amount_minor]) => ({ amount_minor, currency })) },
      confirmes_sans_abonnement: noSub.map((r) => ({ payment_id: r.id, payer_type: r.payer_type, payer_id: r.payer_id, plan: r.plan })),
      abonnements_sans_paiement: subNoPay.map((r) => ({ subscription_id: r.id, account_type: r.account_type, account_id: r.account_id, plan: r.plan })),
      divergences: [],
      non_verifies: [],
      erreurs: [],
      complet: true,
      sources: [],
    };
    for (const connector of this.provider.connectors?.() ?? []) {
      const ours = payments.filter((p) => (p.raw as { connector?: string } | null)?.connector === connector);
      try {
        const list = this.provider.list ? await this.provider.list(connector, day, from, to) : null;
        if (list) {
          report.sources.push({ connector, source: 'liste' });
          report.divergences.push(...(await this.compareList(connector, list, ours)));
          continue;
        }
        if (!this.provider.status) throw new PaymentProviderError('not_supported', 'pas de requete de statut', true);
        for (const p of ours.slice(0, 500)) {
          // One payment in error is recorded and the others are still checked (m3).
          let st: ProviderPaymentStatus | null;
          try {
            st = await this.provider.status(p);
          } catch (e) {
            const raison = errorCode(e);
            report.erreurs.push({ connector, payment_id: p.id, raison });
            if (raison !== 'non_interrogeable_sans_reference') report.complet = false;
            continue;
          }
          if (!st) throw new PaymentProviderError('not_supported', 'ni liste ni requete de statut', true);
          const d = this.compare(connector, p, st);
          if (d) report.divergences.push(d);
        }
        report.sources.push({ connector, source: 'statut' });
        if (ours.length > 500) report.non_verifies.push({ connector, raison: `${ours.length - 500} paiements au-dela de la limite de 500` });
      } catch (e) {
        const code = errorCode(e);
        const permanent = code === 'not_supported';
        if (!permanent) report.complet = false;
        report.non_verifies.push({ connector, raison: permanent ? 'ni liste ni requete de statut dans le connecteur' : code });
      }
    }
    await this.ds.query(
      `INSERT INTO payment_reconciliations (day, report) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET report = EXCLUDED.report, updated_at = now()`,
      [day, JSON.stringify(report)],
    );
    const issues = report.divergences.length + report.confirmes_sans_abonnement.length + report.abonnements_sans_paiement.length;
    if (issues) this.logger.warn(`rapprochement ${day} : ${issues} ecart(s)`);
    return report;
  }

  private compare(connector: string, p: Payment, st: ProviderPaymentStatus): Divergence | null {
    const base = { connector, payment_id: p.id, provider_ref: p.provider_ref, base: p.status, fournisseur: st.raw_status || st.status };
    if (!sameOutcome(p.status, st.status)) return { ...base, ecart: 'statut' };
    if (st.status === 'confirme' && ((st.amount_minor !== undefined && st.amount_minor !== Number(p.amount_minor)) || (st.currency && st.currency !== p.currency)))
      return { ...base, ecart: 'montant' };
    return null;
  }

  private async compareList(connector: string, list: ProviderTransaction[], ours: Payment[]): Promise<Divergence[]> {
    const out: Divergence[] = [];
    const seen = new Set<string>();
    for (const tx of list) {
      let p = ours.find((x) => (tx.payment_id && x.id === tx.payment_id) || (tx.provider_ref && x.provider_ref === tx.provider_ref));
      if (!p && (tx.payment_id || tx.provider_ref)) {
        // The transaction may belong to a payment created another day (late validation).
        const rows: Payment[] = await this.ds.getRepository(Payment).query(
          `SELECT * FROM payments WHERE raw->>'connector' = $1 AND (($2::text IS NOT NULL AND id::text = $2) OR ($3::text IS NOT NULL AND provider_ref = $3)) LIMIT 1`,
          [connector, tx.payment_id ?? null, tx.provider_ref ?? null],
        );
        p = rows[0];
      }
      if (!p) {
        if (tx.status === 'confirme') out.push({ connector, payment_id: tx.payment_id ?? null, provider_ref: tx.provider_ref ?? null, base: null, fournisseur: tx.raw_status || tx.status, ecart: 'inconnu_en_base' });
        continue;
      }
      seen.add(p.id);
      const d = this.compare(connector, p, tx);
      if (d) out.push(d);
    }
    for (const p of ours) {
      if (!seen.has(p.id) && ['confirme', 'rembourse', 'remboursement_en_cours'].includes(p.status))
        out.push({ connector, payment_id: p.id, provider_ref: p.provider_ref, base: p.status, fournisseur: null, ecart: 'absent_chez_fournisseur' });
    }
    return out;
  }

  async reports(day?: string, limit = 30) {
    const rows: Array<{ day: string; report: ReconciliationReport; updated_at: Date }> = day
      ? await this.ds.query(`SELECT day::text AS day, report, updated_at FROM payment_reconciliations WHERE day = $1`, [day])
      : await this.ds.query(`SELECT day::text AS day, report, updated_at FROM payment_reconciliations ORDER BY day DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 366)]);
    return { data: rows.map((r) => ({ ...r.report, day: r.day, updated_at: r.updated_at })) };
  }

  async hasReport(day: string): Promise<boolean> {
    // An incomplete report (temporary error) does not count as done: it is produced again.
    const rows: unknown[] = await this.ds.query(`SELECT 1 FROM payment_reconciliations WHERE day = $1 AND (report->>'complet')::boolean IS NOT FALSE`, [day]);
    return rows.length > 0;
  }
}
