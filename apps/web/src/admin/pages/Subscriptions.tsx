import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { PaymentMethodOption, PaymentStatus, Plan, PlanCode } from '../../api/types';
import { Card, Dialog, ErrorState, FieldErrors, Pill, Seg, Skeleton, useToast } from '../../components/ui';
import { dateShort, money, num, phone as fmtPhone, PLAN_LABEL } from '../../lib/format';
import { t } from '../../lib/i18n';
import { checkoutKey, checkoutOutcome, isSettled, methodInitials, newPaymentId } from '../../lib/payment';
import { priceOf } from '../../lib/plans';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';
import { normalizePhone } from './Login';

type Period = 'monthly' | 'yearly';
export const POLL_MS = 5000;
export const POLL_MAX_MS = 120_000;

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

/** Polls GET /payments/:id every 5 s, gives up after 2 min. */
export function usePaymentPolling(paymentId: string | null) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!paymentId) return;
    setStartedAt(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paymentId]);
  const elapsed = startedAt ? now - startedAt : 0;
  const timedOut = elapsed >= POLL_MAX_MS;
  const q = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => api.payment(paymentId!),
    enabled: !!paymentId,
    refetchInterval: (query) => {
      const s = query.state.data?.status as PaymentStatus | undefined;
      if (isSettled(s)) return false;
      if (startedAt && Date.now() - startedAt >= POLL_MAX_MS) return false;
      return POLL_MS;
    },
    refetchIntervalInBackground: true,
    retry: 2,
  });
  const status = q.data?.status;
  const done = isSettled(status);
  return { status, done, timedOut: timedOut && !done, remaining: Math.max(0, Math.ceil((POLL_MAX_MS - elapsed) / 1000)), error: q.error };
}

function Checkout({ plan, period, methods, currency, onClose }: { plan: Plan | null; period: Period; methods: PaymentMethodOption[]; currency?: string; onClose: () => void }) {
  const { me, orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const method = chosen && methods.some((x) => x.code === chosen) ? chosen : (methods[0]?.code ?? '');
  const methodLabel = methods.find((x) => x.code === method)?.label ?? '';
  /** PAY-PENDING : issue inconnue, on suit le paiement sans jamais relancer. */
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const [tel, setTel] = useState(me?.phone ? fmtPhone(me.phone) : '');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const poll = usePaymentPolling(paymentId);
  const announced = useRef(false);
  /** Cle d'idempotence : creee a l'appui, gardee pour toute relance du meme paiement (reseau coupe, double appui). */
  const attempt = useRef<{ id: string; key: string } | null>(null);

  useEffect(() => {
    if (!plan) {
      setPaymentId(null);
      announced.current = false;
    }
  }, [plan]);
  useEffect(() => {
    if (poll.status === 'confirme' && !announced.current) {
      announced.current = true;
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast(`Paiement reçu. Formule ${PLAN_LABEL[plan?.code ?? ''] ?? ''} activée.`);
    }
  }, [poll.status, qc, toast, plan]);

  const m = useMutation({
    mutationFn: () =>
    {
        const body = {
          account_type: orgId ? ('organisation' as const) : ('user' as const),
          account_id: orgId ?? me!.id,
          plan: plan!.code,
          period,
          method,
          phone: normalizePhone(tel),
        };
        // Une cle ne sert qu'a une demande : si l'eleveur change le numero ou le moyen, nouvelle cle.
        const key = checkoutKey(body);
        if (attempt.current?.key !== key) attempt.current = { id: newPaymentId(), key };
        return api.checkout({ id: attempt.current.id, ...body });
      },
    onSuccess: (r) => setPaymentId(r.payment_id),
    onError: (err) => {
      const o = checkoutOutcome(err);
      if (o.kind === 'pending') {
        // Issue inconnue : meme cle conservee, on ne relance pas, on suit le paiement.
        setUnknownOutcome(true);
        setPaymentId(o.paymentId);
      } else if (o.kind === 'refused' || o.kind === 'conflict') {
        // Refus explicite : le serveur rejouerait le meme refus avec la meme cle ; un nouvel essai prend une nouvelle cle.
        attempt.current = null;
      }
    },
  });
  const refused = m.isError && checkoutOutcome(m.error).kind === 'refused';
  const conflict = m.isError && checkoutOutcome(m.error).kind === 'conflict';
  const otherError = m.isError && !refused && !conflict && checkoutOutcome(m.error).kind === 'other';
  const price = plan ? priceOf(plan, plan.code, period, currency) : null;
  const phoneErr = m.error instanceof ApiError ? m.error.fields?.phone : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending || !method) return; // pas de double envoi
    setUnknownOutcome(false);
    m.mutate();
  };
  const reset = () => {
    setUnknownOutcome(false);
    setPaymentId(null);
    m.reset();
    announced.current = false;
    attempt.current = null; // nouveau paiement : nouvelle cle
  };

  const waiting = !!paymentId && !poll.done && !poll.timedOut;
  const outcomeKey = `${paymentId ?? ''}|${poll.status ?? ''}|${poll.timedOut}|${refused}`;
  useEffect(() => {
    if (refused || (paymentId && (poll.done || poll.timedOut))) statusRef.current?.focus();
  }, [outcomeKey, refused, paymentId, poll.done, poll.timedOut]);
  const canRetry = poll.status === 'echoue' || (poll.timedOut && !unknownOutcome);
  /** a_verifier, PAY-PENDING non tranche : on ne relance jamais, on previent. */
  const verifying = poll.status === 'a_verifier' || (unknownOutcome && poll.timedOut && !poll.done);
  return (
    <Dialog
      open={!!plan}
      onClose={onClose}
      title={paymentId ? 'Paiement mobile money' : `Passer à ${PLAN_LABEL[plan?.code ?? ''] ?? ''}`}
      description={!paymentId && price?.amount != null ? `${money(price.amount, price.currency)} ${period === 'yearly' ? 'par an (2 mois offerts)' : 'par mois'}` : undefined}
      footer={
        !paymentId ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" form="checkout-form" className="btn btn-primary" disabled={m.isPending || !method} aria-busy={m.isPending}>
              {m.isPending ? t('pay.sending') : t('pay.pay')}
            </button>
          </>
        ) : poll.done || poll.timedOut ? (
          <>
            {canRetry && (
              <button type="button" className="btn btn-ghost" onClick={reset}>
                {t('pay.retry')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {poll.status === 'confirme' ? 'Terminer' : 'Fermer'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Continuer en arrière-plan
          </button>
        )
      }
    >
      {!paymentId ? (
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
              {phoneErr ?? 'Vous recevrez une demande de confirmation sur ce téléphone.'}
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
          {otherError && !phoneErr && <FieldErrors error={m.error} />}
        </form>
      ) : (
        <div className="pay-wait" aria-live="polite" ref={statusRef} tabIndex={-1}>
          {unknownOutcome && !isSettled(poll.status) && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.pending.title')}.</b> {t('pay.pending.body')}
            </p>
          )}
          {waiting && !unknownOutcome && (
            <>
              <div className="pay-phone" aria-hidden="true">
                <div className="pay-ussd">
                  Confirmez le paiement de {price?.amount != null ? money(price.amount, price.currency) : ''}
                  <br />
                  1. Oui
                  <br />
                  2. Non
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 600 }}>Validez sur votre téléphone</h3>
                <p className="muted">
                  Une demande {methodLabel} a été envoyée au {tel}. Saisissez votre code secret pour confirmer.
                </p>
              </div>
              <p className="countdown">
                {poll.status === 'en_attente' ? 'En attente de votre confirmation' : 'Demande envoyée'} · vérification toutes les 5 s · {Math.floor(poll.remaining / 60)}:{String(poll.remaining % 60).padStart(2, '0')}
              </p>
            </>
          )}
          {waiting && unknownOutcome && (
            <p className="countdown">
              Vérification toutes les 5 s · {Math.floor(poll.remaining / 60)}:{String(poll.remaining % 60).padStart(2, '0')}
            </p>
          )}
          {poll.status === 'confirme' && (
            <p className="notice notice-ok" style={{ width: '100%' }}>
              <b>{t('pay.confirmed')}</b> Votre formule {PLAN_LABEL[plan?.code ?? '']} est active. Un reçu vous est envoyé par SMS.
            </p>
          )}
          {poll.status === 'a_verifier' && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.verify.title')}.</b> {t('pay.verify.body')}
            </p>
          )}
          {poll.status === 'remboursement_en_cours' && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              {t('pay.refunding')}
            </p>
          )}
          {poll.status === 'rembourse' && (
            <p className="notice notice-ok" style={{ width: '100%' }}>
              {t('pay.refunded')}
            </p>
          )}
          {poll.status === 'echoue' && (
            <p className="notice notice-crit" style={{ width: '100%' }}>
              <b>Paiement refusé.</b> Le solde est peut-être insuffisant ou la demande a été annulée. Aucun montant n'a été prélevé.
            </p>
          )}
          {poll.timedOut && !verifying && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.timeout.title')}</b> {t('pay.timeout.body')}
            </p>
          )}
          {poll.timedOut && verifying && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>{t('pay.verify.title')}.</b> {t('pay.verify.body')}
            </p>
          )}
          {poll.error != null && <ErrorState compact error={poll.error} />}
        </div>
      )}
    </Dialog>
  );
}

export default function Subscriptions() {
  usePageMeta('Abonnements', 'Formule, paiement mobile money et quotas');
  const [period, setPeriod] = useState<Period>('monthly');
  const [buying, setBuying] = useState<Plan | null>(null);
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
                      'Sur devis'
                    ) : pr.amount === undefined ? (
                      '—'
                    ) : (
                      <>
                        {pr.from && <small>dès </small>}
                        {money(pr.amount, pr.currency)}
                        {pr.amount > 0 && <small> / {period === 'yearly' ? 'an' : 'mois'}</small>}
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
      <Checkout plan={buying} period={period} methods={methods} currency={plansCurrency} onClose={() => setBuying(null)} />
    </>
  );
}
