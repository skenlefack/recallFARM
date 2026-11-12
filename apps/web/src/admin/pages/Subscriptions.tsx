import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { PaymentMethodOption, Plan, PlanCode } from '../../api/types';
import { Card, Dialog, ErrorState, FieldErrors, Pill, Seg, Skeleton } from '../../components/ui';
import { dateShort, money, num, phone as fmtPhone, PLAN_LABEL } from '../../lib/format';
import { t } from '../../lib/i18n';
import { checkoutOutcome, isTerminal, isUnderReview, methodInitials } from '../../lib/payment';
import { priceOf } from '../../lib/plans';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';
import { pollTiming, usePaymentTracker } from '../paymentTracker';
import { normalizePhone } from './Login';

type Period = 'monthly' | 'yearly';
export { pollTiming };

const FEATURE_LABEL: Record<string, string> = {
  rappels_sms: 'Rappels SMS',
  rappels_whatsapp: 'Rappels WhatsApp',
  certificat_qr: 'Certificats QR',
  genealogie: 'Généalogie',
  tresorerie: 'Trésorerie',
  simulateur: 'Simulateur',
  facturation: 'Facturation',
  multi_utilisateurs: 'Multi-utilisateurs',
  mode_agent: 'Mode agent',
  import_masse: 'Import en masse',
  campagnes: 'Campagnes',
  studio_org: 'Studio d’organisation',
  tableau_bord_org: 'Tableau de bord consolidé',
  carnet: 'Carnet sanitaire',
  rappels_locaux: 'Rappels sur le téléphone',
  journal: 'Journal',
  stocks: 'Stocks',
  ventes: 'Ventes',
  marche: 'Marché',
  surveillance: 'Surveillance nationale',
  exports_dhis2: 'Exports DHIS2, ARIS',
  hebergement_souverain: 'Hébergement souverain',
  api: 'API et marque blanche',
};

function Checkout({ open, plan, period, methods, currency, onClose }: { open: boolean; plan: Plan | null; period: Period; methods: PaymentMethodOption[]; currency?: string; onClose: () => void }) {
  const { me, orgId } = useAuth();
  const tr = usePaymentTracker();
  const { attempt, status } = tr;
  const [chosen, setChosen] = useState<string | null>(null);
  const method = chosen && methods.some((x) => x.code === chosen) ? chosen : (methods[0]?.code ?? '');
  const methodLabel = methods.find((x) => x.code === method)?.label ?? '';
  const statusRef = useRef<HTMLDivElement>(null);
  const [tel, setTel] = useState(me?.phone ? fmtPhone(me.phone) : '');

  // la fenetre ouverte garde une issue definitive a l'ecran jusqu'a sa fermeture
  const { setViewing, clearError } = tr;
  useEffect(() => {
    setViewing(open);
    return () => setViewing(false);
  }, [open, setViewing]);
  useEffect(() => {
    if (!open) clearError();
  }, [open, clearError]);

  const price = plan ? priceOf(plan, plan.code, period, currency) : null;
  /** Pas de paiement connu : formulaire (y compris pendant l'envoi). */
  const formMode = !attempt || (!attempt.paymentId && !attempt.unsent);
  const submitError = formMode ? tr.submitError : null;
  const outcome = submitError ? checkoutOutcome(submitError).kind : null;
  const refused = outcome === 'refused';
  const conflict = outcome === 'conflict';
  const phoneErr = submitError instanceof ApiError ? submitError.fields?.phone : undefined;
  const otherError = !!submitError && !refused && !conflict;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tr.submitting || !method || !plan) return;
    tr.submit(
      {
        account_type: orgId ? 'organisation' : 'user',
        account_id: orgId ?? me!.id,
        plan: plan.code,
        period,
        method,
        phone: normalizePhone(tel),
      },
      { planName: plan.name ?? PLAN_LABEL[plan.code] ?? plan.code, amount: price?.amount != null && price.currency ? { amount_minor: price.amount, currency: price.currency } : null },
    );
  };
  const retrySend = () => {
    if (attempt?.body) tr.submit(attempt.body, { planName: attempt.planName, amount: attempt.amount });
  };

  // textes du paiement suivi : ceux de la tentative figee, jamais la formule regardee ensuite
  const frozen = attempt;
  const frozenAmount = frozen?.amount ? money(frozen.amount.amount_minor, frozen.amount.currency) : '';
  const frozenMethod = methods.find((x) => x.code === frozen?.method)?.label ?? frozen?.method ?? '';
  /** Reessayer exige le corps complet (memoire ou sessionStorage) ; apres 3 essais sans reponse, ou corps perdu : Abandonner (sur grace a PAY-OPEN). */
  const canRetrySend = !!frozen?.body;
  const canAbandon = !!frozen && (frozen.tries >= 3 || !frozen.body);
  const tracking = !!frozen && !!frozen.paymentId;
  const terminal = isTerminal(status);
  const review = isUnderReview(status);
  const waiting = tracking && !terminal && !review && !tr.timedOut && !tr.notFound;
  const mmss = `${Math.floor(tr.remaining / 60)}:${String(tr.remaining % 60).padStart(2, '0')}`;
  const everyS = String(Math.round(pollTiming.intervalMs / 1000));

  const outcomeKey = `${frozen?.paymentId ?? ''}|${status ?? ''}|${tr.timedOut}|${refused}|${tr.notFound}|${!!frozen?.unsent}|${!!frozen?.existing}`;
  useEffect(() => {
    if (refused || frozen?.unsent || frozen?.existing || (tracking && (terminal || review || tr.timedOut || tr.notFound))) statusRef.current?.focus();
  }, [outcomeKey, refused, frozen?.unsent, frozen?.existing, tracking, terminal, review, tr.timedOut, tr.notFound]);

  const closeAfterGone = () => {
    tr.dismiss();
    onClose();
  };
  const dialogTitle = !formMode ? t('pay.dialog.title') : t('pay.dialog.upgrade', { plan: plan ? (plan.name ?? PLAN_LABEL[plan.code] ?? '') : '' });
  const description = formMode && price?.amount != null ? `${money(price.amount, price.currency)} ${t(period === 'yearly' ? 'pay.price.year' : 'pay.price.month')}` : undefined;

  let footer: ReactNode;
  if (formMode) {
    footer = (
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('pay.cancel')}
        </button>
        <button type="submit" form="checkout-form" className="btn btn-primary" disabled={tr.submitting || !method} aria-busy={tr.submitting}>
          {tr.submitting ? t('pay.sending') : t('pay.pay')}
        </button>
      </>
    );
  } else if (frozen?.unsent) {
    footer = (
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('pay.cancel')}
        </button>
        {canAbandon && (
          <button type="button" className="btn btn-ghost" onClick={closeAfterGone}>
            {t('pay.abandon')}
          </button>
        )}
        {canRetrySend && (
          <button type="button" className="btn btn-primary" onClick={retrySend} disabled={tr.submitting} aria-busy={tr.submitting}>
            {tr.submitting ? t('pay.sending') : t('pay.retry')}
          </button>
        )}
      </>
    );
  } else if (tr.notFound) {
    footer = (
      <button type="button" className="btn btn-primary" onClick={closeAfterGone}>
        {t('pay.close')}
      </button>
    );
  } else if (terminal) {
    footer = (
      <>
        {status === 'echoue' && (
          <button type="button" className="btn btn-ghost" onClick={() => tr.dismiss()}>
            {t('pay.retry')}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {status === 'confirme' ? t('pay.done') : t('pay.close')}
        </button>
      </>
    );
  } else if (waiting) {
    footer = (
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        {t('pay.background')}
      </button>
    );
  } else {
    footer = (
      <button type="button" className="btn btn-primary" onClick={onClose}>
        {t('pay.close')}
      </button>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle} description={description} footer={footer}>
      {formMode || !frozen ? (
        <form id="checkout-form" className="stack" onSubmit={submit} noValidate>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
            <legend className="label" style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, marginBottom: 6 }}>
              {t('pay.method.legend')}
            </legend>
            {methods.length === 0 ? (
              <p className="muted">{t('pay.method.none')}</p>
            ) : (
              <div className="methods">
                {methods.map((x) => (
                  <label key={x.code} className="method">
                    <input type="radio" name="method" value={x.code} checked={method === x.code} onChange={() => setChosen(x.code)} />
                    <span className="method-logo" aria-hidden="true">
                      {methodInitials(x.label)}
                    </span>
                    {x.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="field">
            <label htmlFor="pay-phone">{t('pay.number', { method: methodLabel })}</label>
            <input id="pay-phone" className="input" type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} aria-invalid={!!phoneErr} aria-describedby="pay-phone-help" />
            <span id="pay-phone-help" className={phoneErr ? 'field-err' : 'muted small'}>
              {phoneErr ?? t('pay.phone.help')}
            </span>
          </div>
          {conflict && (
            <div ref={statusRef} tabIndex={-1} className="notice notice-crit" role="alert">
              {t('pay.conflict')}
            </div>
          )}
          {refused && (
            <div ref={statusRef} tabIndex={-1} className="notice notice-crit" role="alert">
              <b>{t('pay.init.title')}.</b> {t('pay.init.body')}
            </div>
          )}
          {otherError && !phoneErr && <FieldErrors error={submitError} />}
        </form>
      ) : frozen.unsent ? (
        <div className="pay-wait" aria-live="polite" ref={statusRef} tabIndex={-1}>
          <p className="notice notice-warn" style={{ width: '100%' }}>
            <b>{t('pay.unsent.title')}.</b> {t(canRetrySend ? 'pay.unsent.body' : 'pay.unsent.nobody')}
          </p>
          <p className="muted">
            {t('pay.unsent.plan', { plan: frozen.planName, amount: frozenAmount })}
          </p>
          {tr.submitError != null && <FieldErrors error={tr.submitError} />}
        </div>
      ) : (
        <div className="pay-wait" aria-live="polite" ref={statusRef} tabIndex={-1}>
          {frozen.existing && !terminal && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              {t('pay.open.body', { plan: frozen.planName })}
            </p>
          )}
          {frozen.unknown && !frozen.existing && !terminal && !review && !tr.timedOut && !tr.notFound && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.pending.title')}.</b> {t('pay.pending.body')}
            </p>
          )}
          {waiting && !frozen.unknown && (
            <>
              <div className="pay-phone" aria-hidden="true">
                <div className="pay-ussd">
                  {t('pay.ussd.confirm', { amount: frozenAmount })}
                  <br />
                  {t('pay.ussd.yes')}
                  <br />
                  {t('pay.ussd.no')}
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 600 }}>{t('pay.validate.title')}</h3>
                <p className="muted">{t('pay.validate.body', { method: frozenMethod, phone: frozen.body?.phone ?? frozen.phoneMasked })}</p>
              </div>
              <p className="countdown">{t('pay.countdown.line', { state: t(status === 'en_attente' ? 'pay.countdown.waiting' : 'pay.countdown.sent'), s: everyS, time: mmss })}</p>
            </>
          )}
          {waiting && frozen.unknown && <p className="countdown">{t('pay.countdown.only', { s: everyS, time: mmss })}</p>}
          {status === 'confirme' && (
            <p className="notice notice-ok" style={{ width: '100%' }}>
              <b>{t('pay.confirmed')}</b> {t('pay.confirmed.body', { plan: frozen.planName })}
            </p>
          )}
          {status === 'a_verifier' && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.verify.title')}.</b> {t('pay.verify.body')}
            </p>
          )}
          {status === 'remboursement_en_cours' && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              {t('pay.refunding')}
            </p>
          )}
          {status === 'rembourse' && (
            <p className="notice notice-ok" style={{ width: '100%' }}>
              {t('pay.refunded')}
            </p>
          )}
          {status === 'echoue' && (
            <p className="notice notice-crit" style={{ width: '100%' }}>
              <b>{t('pay.refused.late')}</b> {t('pay.echoue.body')}
            </p>
          )}
          {tr.timedOut && !review && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.timeout.title')}</b> {t('pay.timeout.body')}
            </p>
          )}
          {tr.notFound && (
            <p className="notice notice-crit" role="alert" style={{ width: '100%' }}>
              {t('pay.notfound')}
            </p>
          )}
          {tr.pollError != null && <ErrorState compact error={tr.pollError} />}
        </div>
      )}
    </Dialog>
  );
}

export default function Subscriptions() {
  usePageMeta('Abonnements', 'Formule, paiement mobile money et quotas');
  const [period, setPeriod] = useState<Period>('monthly');
  const [buying, setBuying] = useState<Plan | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const tracker = usePaymentTracker();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: api.currentSubscription });
  const plansQ = useQuery({ queryKey: ['plans', 'CM'], queryFn: () => api.plans('CM') });
  const plans = { ...plansQ, data: plansQ.data ? listOf(plansQ.data) : undefined };
  const methods = (!Array.isArray(plansQ.data) && plansQ.data?.payment_methods) || [];
  const plansCurrency = !Array.isArray(plansQ.data) ? plansQ.data?.currency : undefined;
  const dash = useAuth();
  const current = sub.data?.plan;
  const currentPlan = plans.data?.find((p) => p.code === current);

  return (
    <>
      {tracker.attempt && !isTerminal(tracker.status) && (
        <div className="notice notice-warn" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>{t(tracker.notFound ? 'pay.banner.notfound' : 'pay.banner', { plan: tracker.attempt.planName })}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTrackOpen(true)}>
            {t('pay.banner.view')}
          </button>
        </div>
      )}
      <div className="grid-main">
        <Card id="cur" title="Formule actuelle">
          {sub.isLoading ? (
            <Skeleton h={80} />
          ) : sub.isError ? (
            <ErrorState error={sub.error} onRetry={() => sub.refetch()} />
          ) : sub.data ? (
            <div className="stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="plan-price">{PLAN_LABEL[sub.data.plan] ?? sub.data.plan}</div>
                  <span className="muted">
                    {sub.data.period === 'yearly' || sub.data.period === 'annuel' ? 'Paiement annuel · ' : sub.data.period === 'monthly' || sub.data.period === 'mensuel' ? 'Paiement mensuel · ' : ''}
                    {(sub.data.entitlements?.source?.account_type ?? sub.data.account_type) === 'organisation' ? dash.membership?.organisation_name : 'compte personnel'}
                  </span>
                </div>
                <Pill tone={sub.data.status === 'active' || sub.data.status === 'actif' ? 'ok' : 'warn'}>{sub.data.status === 'active' || sub.data.status === 'actif' ? 'Active' : sub.data.status}</Pill>
              </div>
              <dl className="dl">
                <div>
                  <dt>Depuis le</dt>
                  <dd>{dateShort(sub.data.started_at)}</dd>
                </div>
                <div>
                  <dt>Échéance</dt>
                  <dd>{dateShort(sub.data.expires_at)}</dd>
                </div>
                <div>
                  <dt>Délai de grâce jusqu'au</dt>
                  <dd>{dateShort(sub.data.grace_until)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="muted">Aucun abonnement : formule Découverte gratuite.</p>
          )}
        </Card>
        <Card id="quotas" title="Quotas inclus">
          {currentPlan ? (
            <div className="list-rows">
              <div>
                <span>Exploitations</span>
                <span className="mono">{num(currentPlan.quotas.farms)}</span>
              </div>
              <div>
                <span>SMS par mois</span>
                <span className="mono">{num(currentPlan.quotas.sms_per_month)}</span>
              </div>
              <div>
                <span>Caméras</span>
                <span className="mono">{num(currentPlan.quotas.cameras)}</span>
              </div>
            </div>
          ) : plans.isLoading || sub.isLoading ? (
            <Skeleton h={90} />
          ) : (
            <p className="muted">Quotas indisponibles.</p>
          )}
        </Card>
      </div>

      <section className="stack" aria-labelledby="plans-title">
        <div className="toolbar">
          <h2 id="plans-title" className="page-title">
            Changer de formule
          </h2>
          <Seg<Period>
            label="Périodicité"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'monthly', label: 'Mensuel' },
              { value: 'yearly', label: 'Annuel · 2 mois offerts' },
            ]}
          />
        </div>
        {plans.isLoading ? (
          <div className="plan-cards">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={260} r={18} />
            ))}
          </div>
        ) : plans.isError ? (
          <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
        ) : (
          <div className="plan-cards">
            {plans.data?.map((p) => {
              const pr = priceOf(p, p.code, period, plansCurrency);
              const isCurrent = p.code === current;
              const rank = (c?: PlanCode) => plans.data?.find((x) => x.code === c)?.rank ?? 0;
              return (
                <article key={p.code} className={`plan-card${isCurrent ? ' current' : ''}`}>
                  <h3>
                    {p.name ?? PLAN_LABEL[p.code]}
                    {isCurrent && <Pill tone="blue">Actuelle</Pill>}
                  </h3>
                  <div className="plan-price">
                    {pr.amount === null ? (
                      t('price.quote')
                    ) : pr.amount === undefined ? (
                      <small>{t('price.unavailable')}</small>
                    ) : (
                      <>
                        {pr.from && <small>{t('price.from')} </small>}
                        {money(pr.amount, pr.currency)}
                        {pr.amount > 0 && <small> {t(period === 'yearly' ? 'price.per_year' : 'price.per_month')}</small>}
                      </>
                    )}
                  </div>
                  <ul>
                    {p.features.includes('*') && <li>Toutes les fonctions</li>}
                    {p.features.filter((f) => f !== '*').slice(0, 5).map((f) => (
                      <li key={f}>{FEATURE_LABEL[f] ?? f}</li>
                    ))}
                    <li>
                      {num(p.quotas.farms)} exploitation{p.quotas.farms > 1 ? 's' : ''} · {num(p.quotas.sms_per_month)} SMS/mois
                    </li>
                  </ul>
                  {isCurrent ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setBuying(p)} disabled={!pr.amount}>
                      Renouveler
                    </button>
                  ) : pr.amount === null ? (
                    <a href="mailto:contact@recallfarm.app?subject=Formule%20Institution" className="btn btn-ghost">
                      Nous contacter
                    </a>
                  ) : pr.amount === 0 ? (
                    <button type="button" className="btn btn-ghost" disabled>
                      {rank(p.code) < rank(current) ? 'Rétrogradation sur demande' : 'Gratuite'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => setBuying(p)}>
                      {rank(p.code) > rank(current) ? `Passer à ${p.name ?? PLAN_LABEL[p.code]}` : `Choisir ${p.name ?? PLAN_LABEL[p.code]}`}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="footnote">
          {methods.length > 0 ? t('pay.footnote', { methods: methods.map((x) => x.label).join(', ') }) : t('pay.footnote.none')}
        </p>
      </section>
      <Checkout open={!!buying || trackOpen} plan={buying} period={period} methods={methods} currency={plansCurrency} onClose={() => (setBuying(null), setTrackOpen(false))} />
    </>
  );
}
