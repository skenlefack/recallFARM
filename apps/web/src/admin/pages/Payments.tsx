import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { AdminPayment, Me, Money, PaymentStatus, ReconciliationReport } from '../../api/types';
import { Card, Dialog, EmptyState, ErrorState, FieldErrors, Pill, Seg, SkeletonRows, useToast } from '../../components/ui';
import { dateShort, dateTime, money } from '../../lib/format';
import { t } from '../../lib/i18n';
import { PAYMENT_STATUSES, PAYMENT_TONE, type PayStatus } from '../../lib/payment';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

type View = 'payments' | 'reconciliation';

/** Droits d'apres le contrat (admin-payments.controller.ts) : lecture ops/support, interrogation ops, remboursement et rapprochement manuel platform_admin. */
export function paymentRights(me: Me | undefined) {
  const roles: string[] = me?.platform_roles ?? [];
  const admin = roles.includes('platform_admin');
  return {
    read: admin || roles.includes('ops') || roles.includes('support'),
    check: admin || roles.includes('ops'),
    refund: admin,
  };
}

export const statusLabel = (s: string) => (PAYMENT_STATUSES.includes(s as PayStatus) ? t(`pay.status.${s}`) : s);

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={PAYMENT_TONE[status as PayStatus] ?? 'neutral'}>{statusLabel(status)}</Pill>;
}

/** Delai pendant lequel un remboursement « en_cours » est tenu pour encore en vol (miroir de REFUND_IN_FLIGHT_MS cote serveur : 10 min). */
export const REFUND_IN_FLIGHT_MS = 10 * 60_000;

/**
 * Action de remboursement possible, d'apres la regle du serveur (payment-ops.service.ts) :
 * « confirme » se rembourse ; « remboursement_en_cours » se relance (meme reference, jamais deux fois) sauf si le
 * remboursement est « en_attente » ou « en_cours » depuis moins de 10 min (le serveur repond alors 409).
 */
export function refundAction(p: AdminPayment, now = Date.now()): 'refund' | 'retry' | null {
  if (p.status === 'confirme') return 'refund';
  if (p.status !== 'remboursement_en_cours') return null;
  const st = p.refund?.status;
  if (st === 'en_attente') return null;
  const age = now - Date.parse(p.refund?.requested_at ?? '');
  if (st === 'en_cours' && age < REFUND_IN_FLIGHT_MS) return null;
  return 'retry';
}

const shortId = (id: string) => id.slice(0, 8);
const amountOf = (a?: Money) => (a ? money(a.amount_minor, a.currency) : '—');

/* ------------------------------------------------------------- historique */

interface PayEvent {
  at: string | null;
  text: string;
}

/** Historique reconstitue des traces que l'API garde sur le paiement (creation, echec technique, interrogations, confirmation, remboursement). */
export function eventsOf(p: AdminPayment): PayEvent[] {
  const ev: PayEvent[] = [];
  if (p.created_at) ev.push({ at: p.created_at, text: t('padm.event.created') });
  if (p.error_code) ev.push({ at: p.created_at ?? null, text: t('padm.event.init_error', { code: p.error_code }) });
  if (p.poll?.count) ev.push({ at: p.poll.last_at ?? null, text: t('padm.event.poll', { n: String(p.poll.count), last: p.poll.last ?? '—' }) });
  if (p.paid_at) ev.push({ at: p.paid_at, text: t('padm.event.paid') });
  if (p.refund) {
    if (p.refund.requested_at) ev.push({ at: p.refund.requested_at, text: t('padm.event.refund_requested', { reason: p.refund.reason ?? '—' }) });
    if (p.refund.done_at) ev.push({ at: p.refund.done_at, text: t('padm.event.refund_done') });
    else if (p.refund.status) ev.push({ at: null, text: t('padm.event.refund_status', { status: p.refund.status }) });
  }
  if (p.poll?.next_at && ['en_attente', 'a_verifier', 'initie'].includes(p.status)) ev.push({ at: p.poll.next_at, text: t('padm.event.poll_next') });
  // les evenements sans date restent en fin de liste, les autres par date
  return ev.sort((a, b) => (a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : a.at ? -1 : b.at ? 1 : 0));
}

/* ------------------------------------------------------------ remboursement */

function RefundDialog({ payment, retry, onClose, onDone }: { payment: AdminPayment | null; retry: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (payment) {
      setReason(retry ? (payment.refund?.reason ?? '') : '');
      setTouched(false);
    }
  }, [payment, retry]);
  const m = useMutation({
    mutationFn: () => api.adminRefundPayment(payment!.id, reason.trim()),
    onSuccess: () => {
      toast(t('padm.refund.done'));
      onDone();
    },
    onError: (e) => {
      // Issue inconnue ou deja en cours : le statut a change cote serveur, on le recharge ; jamais de second appel automatique.
      if (e instanceof ApiError && (e.rule === 'PAY-REFUND-PENDING' || e.rule === 'PAY-REFUND-IN-PROGRESS')) {
        toast(e.rule === 'PAY-REFUND-PENDING' ? t('padm.refund.pending') : t('padm.refund.in_progress'), 'err');
        onDone();
      }
    },
  });
  const tooShort = reason.trim().length < 5;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (tooShort || m.isPending) return;
    m.mutate();
  };
  const close = () => {
    m.reset();
    onClose();
  };
  const reasonErr = m.error instanceof ApiError ? m.error.fields?.reason : undefined;
  const err = touched && tooShort ? t('padm.refund.too_short') : reasonErr;
  return (
    <Dialog
      open={!!payment}
      onClose={close}
      size="sm"
      title={t(retry ? 'padm.refund.retry.title' : 'padm.refund.title')}
      description={payment ? t(retry ? 'padm.refund.retry.body' : 'padm.refund.body', { amount: amountOf(payment.amount) }) : undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>
            {t('padm.refund.cancel')}
          </button>
          <button type="submit" form="refund-form" className="btn btn-danger" disabled={m.isPending} aria-busy={m.isPending}>
            {m.isPending ? t('padm.refund.busy') : t(retry ? 'padm.refund.retry' : 'padm.refund.confirm')}
          </button>
        </>
      }
    >
      <form id="refund-form" className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="refund-reason">{t('padm.refund.reason')}</label>
          <textarea
            id="refund-reason"
            className="input"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={!!err}
            aria-describedby="refund-reason-help"
            data-autofocus
          />
          <span id="refund-reason-help" className={err ? 'field-err' : 'muted small'}>
            {err ?? t('padm.refund.help')}
          </span>
        </div>
        {m.error && !reasonErr && <FieldErrors error={m.error} />}
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ detail */

function DetailDialog({ payment, onClose, onChecked }: { payment: AdminPayment | null; onClose: () => void; onChecked: (id: string, status: AdminPayment['status']) => void }) {
  const { me } = useAuth();
  const rights = paymentRights(me);
  const qc = useQueryClient();
  const toast = useToast();
  const [refunding, setRefunding] = useState<AdminPayment | null>(null);
  const check = useMutation({
    mutationFn: () => api.adminCheckPayment(payment!.id),
    onSuccess: (r) => {
      onChecked(r.id, r.status); // la ligne reste ouverte meme si elle sort du filtre
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
      if (!r.checked) toast(t('padm.check.nothing'));
      else if (r.status === 'a_verifier' || r.status === 'en_attente') toast(t('padm.check.unknown', { outcome: r.outcome ?? '—' }));
      else toast(t('padm.check.done', { status: statusLabel(r.status) }));
    },
  });
  const p = payment;
  const canCheck = !!p && rights.check && ['initie', 'en_attente', 'a_verifier'].includes(p.status);
  const action = p ? refundAction(p) : null;
  const canRefund = rights.refund && action !== null;
  const close = () => {
    check.reset();
    onClose();
  };
  const events = p ? eventsOf(p) : [];
  return (
    <>
      <Dialog
        open={!!p && !refunding}
        onClose={close}
        size="md"
        title={p ? t('padm.detail.title', { id: shortId(p.id) }) : ''}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close}>
              {t('padm.detail.close')}
            </button>
            {canCheck && (
              <button type="button" className="btn btn-ghost" onClick={() => check.mutate()} disabled={check.isPending} aria-busy={check.isPending}>
                {check.isPending ? t('padm.check.busy') : t('padm.check')}
              </button>
            )}
            {canRefund && (
              <button type="button" className="btn btn-danger" onClick={() => setRefunding(p)}>
                {t(action === 'retry' ? 'padm.refund.retry' : 'padm.refund')}
              </button>
            )}
          </>
        }
      >
        {p && (
          <div className="stack">
            <dl className="dl">
              <div>
                <dt>{t('padm.detail.id')}</dt>
                <dd className="mono">{p.id}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.status')}</dt>
                <dd>
                  <StatusPill status={p.status} />
                </dd>
              </div>
              <div>
                <dt>{t('padm.detail.amount')}</dt>
                <dd>{amountOf(p.amount)}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.plan')}</dt>
                <dd>{[p.plan, p.period].filter(Boolean).join(' · ') || t('padm.detail.none')}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.method')}</dt>
                <dd>{p.method ?? t('padm.detail.none')}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.connector')}</dt>
                <dd>{p.connector ?? t('padm.detail.none')}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.ref')}</dt>
                <dd className="mono">{p.provider_ref ?? t('padm.detail.none')}</dd>
              </div>
              <div>
                <dt>{t('padm.detail.payer')}</dt>
                <dd>
                  {t(`padm.payer.${p.payer_type}`)} <span className="mono">{shortId(p.payer_id)}</span>
                </dd>
              </div>
            </dl>
            <section aria-labelledby="pay-history-title">
              <h3 id="pay-history-title" className="card-title" style={{ fontSize: 15, marginBottom: 8 }}>
                {t('padm.history')}
              </h3>
              {events.length === 0 ? (
                <p className="muted">{t('padm.history.empty')}</p>
              ) : (
                <ol className="list-rows" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {events.map((e, i) => (
                    <li key={i}>
                      <span>{e.text}</span>
                      <span className="mono muted">{e.at ? dateTime(e.at) : ''}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {!rights.refund && action !== null && <p className="muted small">{t('padm.refund.only_admin')}</p>}
            {check.error != null && <FieldErrors error={check.error} />}
          </div>
        )}
      </Dialog>
      <RefundDialog
        payment={refunding}
        retry={!!refunding && refundAction(refunding) === 'retry'}
        onClose={() => setRefunding(null)}
        onDone={() => {
          setRefunding(null);
          qc.invalidateQueries({ queryKey: ['admin-payments'] });
          onClose();
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------- liste */

function PaymentsList() {
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  /** Copie de la ligne ouverte : elle reste affichee si un rechargement la fait sortir du filtre. */
  const [opened, setOpened] = useState<AdminPayment | null>(null);
  const q = useQuery({ queryKey: ['admin-payments', status], queryFn: () => api.adminPayments({ status: status || undefined, limit: 100 }), select: listOf });
  const rows = q.data ?? [];
  const selected = (openId ? (rows.find((r) => r.id === openId) ?? (opened?.id === openId ? opened : null)) : null);
  const closeDetail = () => {
    setOpenId(null);
    setOpened(null);
    // la ligne a pu disparaitre (filtre) : le focus ne doit pas se perdre
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) document.getElementById('pay-status')?.focus();
    }, 0);
  };
  return (
    <>
      <div className="toolbar">
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label htmlFor="pay-status">{t('padm.filter.label')}</label>
          <select id="pay-status" className="input input-sm" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus | '')}>
            <option value="">{t('padm.filter.all')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <span className="muted" aria-live="polite">
          {q.data ? t(rows.length > 1 ? 'padm.count.many' : 'padm.count.one', { n: String(rows.length) }) : ''}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {t('padm.refresh')}
        </button>
      </div>
      <Card id="payments-list" title={t('padm.view.payments')} padded>
        {q.isLoading ? (
          <SkeletonRows rows={5} cols={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('padm.empty.title')}>{status === 'a_verifier' ? t('padm.empty.verify') : t('padm.empty.body')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <caption className="sr-only">{t('padm.list.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('padm.col.date')}</th>
                  <th scope="col">{t('padm.col.payer')}</th>
                  <th scope="col">{t('padm.col.plan')}</th>
                  <th scope="col">{t('padm.col.amount')}</th>
                  <th scope="col">{t('padm.col.method')}</th>
                  <th scope="col">{t('padm.col.status')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('padm.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{dateTime(p.created_at)}</td>
                    <td>
                      {t(`padm.payer.${p.payer_type}`)}
                      <span className="cell-sub mono">{shortId(p.payer_id)}</span>
                    </td>
                    <td>{[p.plan, p.period].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num">{amountOf(p.amount)}</td>
                    <td>{p.method ?? '—'}</td>
                    <td>
                      <StatusPill status={p.status} />
                    </td>
                    <td className="right">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setOpenId(p.id), setOpened(p))} aria-label={t('padm.detail.open', { id: shortId(p.id) })}>
                        {t('padm.detail.button')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <DetailDialog payment={selected} onClose={closeDetail} onChecked={(id, status) => setOpened((o) => (o && o.id === id ? { ...o, status } : o))} />
    </>
  );
}

/* ------------------------------------------------------------- rapprochement */

export function issuesOf(r: ReconciliationReport): number {
  return r.confirmes_sans_abonnement.length + r.abonnements_sans_paiement.length + r.divergences.length + r.non_verifies.length + r.erreurs.length;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="stack" style={{ gap: 6 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>
        {title} ({count})
      </h3>
      {count === 0 ? <p className="muted small">{t('padm.reco.sec.none')}</p> : children}
    </section>
  );
}

function ReportDialog({ report, onClose }: { report: ReconciliationReport | null; onClose: () => void }) {
  const r = report;
  return (
    <Dialog open={!!r} onClose={onClose} size="lg" title={r ? t('padm.reco.detail', { day: dateShort(r.day) }) : ''} footer={<button type="button" className="btn btn-primary" onClick={onClose}>{t('padm.detail.close')}</button>}>
      {r && (
        <div className="stack">
          <Section title={t('padm.reco.sec.no_sub')} count={r.confirmes_sans_abonnement.length}>
            <ul className="list-rows">
              {r.confirmes_sans_abonnement.map((x) => (
                <li key={x.payment_id}>
                  <span className="mono">{shortId(x.payment_id)}</span>
                  <span>{x.plan ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('padm.reco.sec.no_pay')} count={r.abonnements_sans_paiement.length}>
            <ul className="list-rows">
              {r.abonnements_sans_paiement.map((x) => (
                <li key={x.subscription_id}>
                  <span className="mono">{shortId(x.subscription_id)}</span>
                  <span>{x.plan}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('padm.reco.sec.diff')} count={r.divergences.length}>
            <ul className="list-rows">
              {r.divergences.map((x, i) => (
                <li key={`${x.payment_id ?? x.provider_ref}-${i}`}>
                  <span>
                    <span className="mono">{x.payment_id ? shortId(x.payment_id) : (x.provider_ref ?? '—')}</span> · {x.connector}
                  </span>
                  <span>
                    {t(`padm.reco.diff.${x.ecart}`)}
                    {x.ecart === 'statut' && ` : ${x.base ? statusLabel(x.base) : '—'} / ${x.fournisseur ?? '—'}`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('padm.reco.sec.unchecked')} count={r.non_verifies.length}>
            <ul className="list-rows">
              {r.non_verifies.map((x) => (
                <li key={x.connector}>
                  <span>{x.connector}</span>
                  <span>{x.raison}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('padm.reco.sec.errors')} count={r.erreurs.length}>
            <ul className="list-rows">
              {r.erreurs.map((x) => (
                <li key={x.payment_id}>
                  <span className="mono">{shortId(x.payment_id)}</span>
                  <span>{x.raison}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </Dialog>
  );
}

function Reconciliations() {
  const { me } = useAuth();
  const rights = paymentRights(me);
  const qc = useQueryClient();
  const toast = useToast();
  const [day, setDay] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-reconciliations'], queryFn: () => api.adminReconciliations({ limit: 30 }), select: listOf });
  const rows = q.data ?? [];
  const run = useMutation({
    mutationFn: () => api.adminReconcile(day),
    onSuccess: (r) => {
      toast(t('padm.reco.run.done', { day: dateShort(r.day) }));
      qc.invalidateQueries({ queryKey: ['admin-reconciliations'] });
    },
  });
  const dayErr = run.error instanceof ApiError ? run.error.fields?.day : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!day || run.isPending) return;
    run.mutate();
  };
  return (
    <>
      <Card id="reco-list" title={t('padm.reco.title')} padded>
        {q.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('padm.reco.empty.title')}>{t('padm.reco.empty.body')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <caption className="sr-only">{t('padm.reco.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('padm.reco.col.day')}</th>
                  <th scope="col">{t('padm.reco.col.payments')}</th>
                  <th scope="col">{t('padm.reco.col.confirmed')}</th>
                  <th scope="col">{t('padm.reco.col.amounts')}</th>
                  <th scope="col">{t('padm.reco.col.issues')}</th>
                  <th scope="col">{t('padm.reco.col.state')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('padm.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const n = issuesOf(r);
                  return (
                    <tr key={r.day}>
                      <td className="num">{dateShort(r.day)}</td>
                      <td className="num">{r.totals.payments}</td>
                      <td className="num">{r.totals.confirmes}</td>
                      <td className="num">{r.totals.confirmed_amounts.length ? r.totals.confirmed_amounts.map((a) => money(a.amount_minor, a.currency)).join(' + ') : '—'}</td>
                      <td>{n === 0 ? <Pill tone="ok">{t('padm.reco.issues.none')}</Pill> : <Pill tone="warn">{String(n)}</Pill>}</td>
                      <td>{r.complet ? <Pill tone="ok">{t('padm.reco.complete')}</Pill> : <Pill tone="warn">{t('padm.reco.incomplete')}</Pill>}</td>
                      <td className="right">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenDay(r.day)} aria-label={t('padm.reco.detail.button', { day: dateShort(r.day) })}>
                          {t('padm.detail.button')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card id="reco-run" title={t('padm.reco.run.title')} padded>
        {rights.refund ? (
          <form className="stack" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="reco-day">{t('padm.reco.run.day')}</label>
              <input id="reco-day" className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-invalid={!!dayErr} aria-describedby="reco-day-help" style={{ width: 'auto' }} />
              <span id="reco-day-help" className={dayErr ? 'field-err' : 'muted small'}>
                {dayErr ?? t('padm.reco.run.help')}
              </span>
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={!day || run.isPending} aria-busy={run.isPending}>
                {run.isPending ? t('padm.reco.run.busy') : t('padm.reco.run.button')}
              </button>
            </div>
            {run.error != null && !dayErr && <p role="alert" className="field-err">{errorMessage(run.error)}</p>}
          </form>
        ) : (
          <p className="muted">{t('padm.reco.run.only_admin')}</p>
        )}
      </Card>
      <ReportDialog report={rows.find((r) => r.day === openDay) ?? null} onClose={() => setOpenDay(null)} />
    </>
  );
}

/* --------------------------------------------------------------------- page */

export default function Payments() {
  usePageMeta(t('padm.title'), t('padm.subtitle'));
  const { me, isLoading } = useAuth();
  const [view, setView] = useState<View>('payments');
  if (isLoading || !me) return <SkeletonRows rows={4} cols={4} />;
  if (!paymentRights(me).read) return <EmptyState title={t('padm.denied.title')}>{t('padm.denied.body')}</EmptyState>;
  return (
    <>
      <div className="toolbar">
        <Seg<View>
          label={t('padm.view.label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'payments', label: t('padm.view.payments') },
            { value: 'reconciliation', label: t('padm.view.reconciliation') },
          ]}
        />
      </div>
      {view === 'payments' ? <PaymentsList /> : <Reconciliations />}
    </>
  );
}
