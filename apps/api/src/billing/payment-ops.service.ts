import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { Payment } from '../database/entities';
import { BillingService } from './billing.service';
import { PAYMENT_PROVIDER, PaymentProvider, PaymentProviderError, ProviderPaymentStatus, ProviderTransaction } from './payment.providers';

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
    const due: Payment[] = await this.ds.getRepository(Payment).query(
      `SELECT * FROM payments
        WHERE status = ANY($1) AND created_at <= $2::timestamptz - make_interval(mins => $3)
          AND COALESCE((raw->'poll'->>'next_at')::timestamptz, '-infinity') <= $2::timestamptz
        ORDER BY created_at LIMIT 100`,
      [OPEN, now.toISOString(), cfg.paymentStatusAfterMin],
    );
    for (const p of due) {
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
      error = e instanceof PaymentProviderError ? e.code : (e as Error).name === 'TimeoutError' ? 'timeout' : 'network';
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
    const st = this.provider.status ? await this.provider.status(p) : null;
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
    return {
      data: rows.map((p) => {
        const raw = (p.raw ?? {}) as { connector?: string; poll?: unknown; refund?: unknown; error_code?: string };
        return { ...this.billing.serialize(p), payer_type: p.payer_type, payer_id: p.payer_id, connector: raw.connector ?? null, error_code: raw.error_code ?? null, poll: raw.poll ?? null, refund: raw.refund ?? null };
      }),
    };
  }

  /* ---------------- refunds ---------------- */

  private async audit(paymentId: string, action: string, user: AuthUser, diff: Record<string, unknown>) {
    await this.ds.query(`INSERT INTO audit_log (entity, entity_id, action, actor_id, actor_role, diff) VALUES ('payments', $1, $2, $3, $4, $5)`, [
      paymentId,
      action,
      user.id,
      user.platform_roles.join(','),
      JSON.stringify(diff),
    ]);
  }

  /**
   * Refunds a confirmed payment through its connector (administration, journaled in audit_log).
   * The refund key is created once and reused: a retry after a network error cannot refund twice.
   * The subscription is not changed here (decision of the product owner, docs/plan/questions.md).
   */
  async refund(user: AuthUser, id: string, reason: string) {
    if (!this.provider.refund) throw Errors.business('PAY-REFUND-UNSUPPORTED', 'Le remboursement n’est pas disponible avec ce fournisseur.');
    const prepared = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(Payment);
      const p = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw Errors.notFound('Paiement');
      if (p.status === 'rembourse') return { p, done: true };
      if (p.status !== 'confirme' && p.status !== 'remboursement_en_cours') {
        throw Errors.business('PAY-REFUND-STATUS', 'Seul un paiement confirmé peut être remboursé.', { status: p.status });
      }
      const raw = (p.raw ?? {}) as { refund?: { id?: string } };
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
    const finish = async (status: string, refundPatch: Record<string, unknown>) => {
      await this.ds.query(
        `UPDATE payments SET status = $2, raw = jsonb_set(raw, '{refund}', (raw->'refund') || $3::jsonb), updated_at = now() WHERE id = $1 AND status = 'remboursement_en_cours'`,
        [p.id, status, JSON.stringify(refundPatch)],
      );
      await this.audit(p.id, `refund_${refundPatch.status as string}`, user, refundPatch);
      const fresh = (await this.ds.getRepository(Payment).findOne({ where: { id: p.id } }))!;
      return { ...this.billing.serialize(fresh), refund: (fresh.raw as { refund?: unknown }).refund ?? null };
    };
    try {
      const r = await this.provider.refund(p, refundId, reason);
      if (r.status === 'rembourse') {
        this.logger.log(`payment ${p.id}: rembourse (${r.refund_ref ?? 'sans reference'})`);
        return finish('rembourse', { status: 'rembourse', done_at: new Date().toISOString(), ...(r.refund_ref ? { ref: r.refund_ref } : {}) });
      }
      if (r.status === 'echoue') {
        await finish('confirme', { status: 'refuse', error: 'refused' });
        throw Errors.business('PAY-REFUND-REFUSED', 'Le fournisseur a refusé le remboursement.', { payment_id: p.id });
      }
      return finish('remboursement_en_cours', { status: 'en_attente', ...(r.refund_ref ? { ref: r.refund_ref } : {}) });
    } catch (e) {
      if (!(e instanceof PaymentProviderError) && !(e instanceof Error && ['TypeError', 'TimeoutError'].includes(e.name))) throw e;
      const code = e instanceof PaymentProviderError ? e.code : e.name === 'TimeoutError' ? 'timeout' : 'network';
      if (e instanceof PaymentProviderError && e.definitive) {
        await finish('confirme', { status: 'refuse', error: code });
        throw Errors.business('PAY-REFUND-REFUSED', 'Le fournisseur a refusé le remboursement.', { payment_id: p.id, error_code: code });
      }
      // Unknown outcome: the payment stays "remboursement_en_cours"; a retry reuses the same refund key.
      await finish('remboursement_en_cours', { status: 'inconnu', error: code });
      throw Errors.business('PAY-REFUND-PENDING', 'Remboursement en cours de vérification. Relancez plus tard : il ne sera pas fait deux fois.', {
        payment_id: p.id,
        error_code: code,
      });
    }
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
        let checked = 0;
        for (const p of ours.slice(0, 500)) {
          const st = await this.provider.status(p);
          if (!st) throw new PaymentProviderError('not_supported', 'ni liste ni requete de statut', true);
          checked++;
          const d = this.compare(connector, p, st);
          if (d) report.divergences.push(d);
        }
        report.sources.push({ connector, source: 'statut' });
        if (ours.length > checked) report.non_verifies.push({ connector, raison: `${ours.length - checked} paiements au-dela de la limite de 500` });
      } catch (e) {
        report.non_verifies.push({ connector, raison: e instanceof PaymentProviderError ? e.code === 'not_supported' ? 'ni liste ni requete de statut dans le connecteur' : e.code : 'erreur reseau' });
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
    const rows: unknown[] = await this.ds.query(`SELECT 1 FROM payment_reconciliations WHERE day = $1`, [day]);
    return rows.length > 0;
  }
}
