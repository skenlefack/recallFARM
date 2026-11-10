import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { PaymentMethod, PaymentStatus, Plan, PlanCode } from '../../api/types';
import { Card, Dialog, ErrorState, FieldErrors, Pill, Seg, Skeleton, useToast } from '../../components/ui';
import { dateShort, money, num, phone as fmtPhone, PLAN_LABEL } from '../../lib/format';
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
      if (s === 'confirme' || s === 'echoue' || s === 'rembourse') return false;
      if (startedAt && Date.now() - startedAt >= POLL_MAX_MS) return false;
      return POLL_MS;
    },
    refetchIntervalInBackground: true,
    retry: 2,
  });
  const status = q.data?.status;
  const done = status === 'confirme' || status === 'echoue' || status === 'rembourse';
  return { status, done, timedOut: timedOut && !done, remaining: Math.max(0, Math.ceil((POLL_MAX_MS - elapsed) / 1000)), error: q.error };
}

function Checkout({ plan, period, onClose }: { plan: Plan | null; period: Period; onClose: () => void }) {
  const { me, orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [method, setMethod] = useState<PaymentMethod>('orange_money');
  const [tel, setTel] = useState(me?.phone ? fmtPhone(me.phone) : '');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const poll = usePaymentPolling(paymentId);
  const announced = useRef(false);

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
      api.checkout({
        account_type: orgId ? 'organisation' : 'user',
        account_id: orgId ?? me!.id,
        plan: plan!.code,
        period,
        method,
        phone: normalizePhone(tel),
      }),
    onSuccess: (r) => setPaymentId(r.payment_id),
  });
  const price = plan ? priceOf(plan, plan.code, period) : null;
  const phoneErr = m.error instanceof ApiError ? m.error.fields?.phone : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const reset = () => {
    setPaymentId(null);
    m.reset();
    announced.current = false;
  };

  const waiting = !!paymentId && !poll.done && !poll.timedOut;
  return (
    <Dialog
      open={!!plan}
      onClose={onClose}
      title={paymentId ? 'Paiement mobile money' : `Passer à ${PLAN_LABEL[plan?.code ?? ''] ?? ''}`}
      description={!paymentId && price?.amount != null ? `${money(price.amount)} ${period === 'yearly' ? 'par an (2 mois offerts)' : 'par mois'}` : undefined}
      footer={
        !paymentId ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" form="checkout-form" className="btn btn-primary" disabled={m.isPending}>
              {m.isPending ? 'Envoi de la demande…' : 'Payer'}
            </button>
          </>
        ) : poll.done || poll.timedOut ? (
          <>
            {poll.status !== 'confirme' && (
              <button type="button" className="btn btn-ghost" onClick={reset}>
                Réessayer
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
              Moyen de paiement
            </legend>
            <div className="methods">
              <label className="method">
                <input type="radio" name="method" value="orange_money" checked={method === 'orange_money'} onChange={() => setMethod('orange_money')} />
                <span className="method-logo" style={{ background: '#FF7900' }} aria-hidden="true">
                  OM
                </span>
                Orange Money
              </label>
              <label className="method">
                <input type="radio" name="method" value="mtn_momo" checked={method === 'mtn_momo'} onChange={() => setMethod('mtn_momo')} />
                <span className="method-logo" style={{ background: '#FFCB05', color: '#062B4F' }} aria-hidden="true">
                  MTN
                </span>
                MTN MoMo
              </label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="pay-phone">Numéro {method === 'orange_money' ? 'Orange Money' : 'MTN MoMo'}</label>
            <input id="pay-phone" className="input" type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} aria-invalid={!!phoneErr} aria-describedby="pay-phone-help" />
            <span id="pay-phone-help" className={phoneErr ? 'field-err' : 'muted small'}>
              {phoneErr ?? 'Vous recevrez une demande de confirmation sur ce téléphone.'}
            </span>
          </div>
          {m.error && !phoneErr && <FieldErrors error={m.error} />}
        </form>
      ) : (
        <div className="pay-wait" aria-live="polite">
          {waiting && (
            <>
              <div className="pay-phone" aria-hidden="true">
                <div className="pay-ussd">
                  Confirmez le paiement de {price?.amount != null ? money(price.amount) : ''}
                  <br />
                  1. Oui
                  <br />
                  2. Non
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 600 }}>Validez sur votre téléphone</h3>
                <p className="muted">
                  Une demande {method === 'orange_money' ? 'Orange Money' : 'MTN MoMo'} a été envoyée au {tel}. Saisissez votre code secret pour confirmer.
                </p>
              </div>
              <p className="countdown">
                {poll.status === 'en_attente' ? 'En attente de votre confirmation' : 'Demande envoyée'} · vérification toutes les 5 s · {Math.floor(poll.remaining / 60)}:{String(poll.remaining % 60).padStart(2, '0')}
              </p>
            </>
          )}
          {poll.status === 'confirme' && (
            <p className="notice notice-ok" style={{ width: '100%' }}>
              <b>Paiement confirmé.</b> Votre formule {PLAN_LABEL[plan?.code ?? '']} est active. Un reçu vous est envoyé par SMS.
            </p>
          )}
          {poll.status === 'echoue' && (
            <p className="notice notice-crit" style={{ width: '100%' }}>
              <b>Paiement refusé.</b> Le solde est peut-être insuffisant ou la demande a été annulée. Aucun montant n'a été prélevé.
            </p>
          )}
          {poll.timedOut && (
            <p className="notice notice-warn" style={{ width: '100%' }}>
              <b>Pas de réponse après 2 minutes.</b> Si vous avez validé, l'activation apparaîtra d'ici quelques minutes. Sinon, relancez le paiement.
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
  const plans = useQuery({ queryKey: ['plans', 'CM'], queryFn: () => api.plans('CM'), select: listOf });
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
              const pr = priceOf(p, p.code, period);
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
                    ) : (
                      <>
                        {pr.from && <small>dès </small>}
                        {num(pr.amount)} <small>FCFA{pr.amount > 0 ? ` / ${period === 'yearly' ? 'an' : 'mois'}` : ''}</small>
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
        <p className="footnote">Paiement par Orange Money ou MTN MoMo. Les prix Structure dépendent du nombre d'éleveurs suivis.</p>
      </section>
      <Checkout plan={buying} period={period} onClose={() => setBuying(null)} />
    </>
  );
}
