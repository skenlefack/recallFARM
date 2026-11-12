import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { Money, PaymentStatus, PlanCode } from '../api/types';
import { useToast } from '../components/ui';
import { t } from '../lib/i18n';
import { checkoutOutcome, isDefinitiveRejection, isTerminal, isUnderReview, newPaymentId } from '../lib/payment';
import { useAuth } from './auth';

/** Intervalle de suivi ; `maxMs` = delai apres lequel on previent (le suivi continue, plus lentement). Modifiable par les tests. */
export const pollTiming = { intervalMs: 5000, slowMs: 15_000, maxMs: 120_000 };

export interface PayBody {
  account_type: 'user' | 'organisation';
  account_id: string;
  plan: PlanCode;
  period: 'monthly' | 'yearly';
  method: string;
  phone: string;
}

/**
 * Une tentative de paiement. Plan, periode et prix sont figes au moment de l'envoi : tous les textes (ecran USSD,
 * attente, annonce) parlent de CE paiement, quoi que l'eleveur regarde ensuite.
 */
export interface Attempt {
  /** UUID v4 cree par le client : toute relance du meme paiement le reutilise. */
  id: string;
  body: PayBody;
  planName: string;
  amount: Money | null;
  /** Paiement connu du serveur (reponse du checkout, PAY-PENDING ou PAY-OPEN). */
  paymentId: string | null;
  /** Envoi sans reponse claire (reseau, 5xx, delai) : seul « Reessayer » (meme id, meme corps) est permis. */
  unsent: boolean;
  /** Issue inconnue (PAY-PENDING, PAY-OPEN) : on suit sans jamais relancer. */
  unknown: boolean;
  /** PAY-OPEN : le paiement suivi etait deja ouvert (autre ecran, autre appareil). */
  existing: boolean;
}

const storageKey = (userId: string) => `rf.payment.v1.${userId}`;

function readAttempt(key: string): Attempt | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<Attempt>;
    if (typeof a.id !== 'string' || !a.body || typeof a.planName !== 'string') return null;
    // envoi en vol au moment du rechargement : issue inconnue, seul « Reessayer » (meme id) est permis
    return { id: a.id, body: a.body, planName: a.planName, amount: a.amount ?? null, paymentId: a.paymentId ?? null, unsent: !!a.unsent || !a.paymentId, unknown: !!a.unknown, existing: !!a.existing };
  } catch {
    return null; // stockage indisponible ou corrompu : on repart sans suivi
  }
}

function writeAttempt(key: string, a: Attempt | null): void {
  try {
    if (a) localStorage.setItem(key, JSON.stringify(a));
    else localStorage.removeItem(key);
  } catch {
    /* stockage plein ou interdit : le suivi reste en memoire pour cette session */
  }
}

export interface Tracker {
  attempt: Attempt | null;
  /** Statut interroge (jamais devine). */
  status: PaymentStatus | undefined;
  /** Delai depasse sans issue (le suivi continue). */
  timedOut: boolean;
  remaining: number;
  /** 403/404 sur le paiement : on arrete le suivi. */
  notFound: boolean;
  pollError: unknown;
  submitting: boolean;
  submitError: unknown;
  /** Nouvelle demande, ou « Reessayer » (meme id, meme corps) quand l'envoi precedent est reste sans reponse. */
  submit: (body: PayBody, meta: { planName: string; amount: Money | null }) => void;
  /** Repart de zero (issue definitive vue, ou suivi abandonne). */
  dismiss: () => void;
  clearError: () => void;
  /** La fenetre de paiement est ouverte : une issue definitive reste affichee jusqu'a sa fermeture. */
  setViewing: (v: boolean) => void;
}

const Ctx = createContext<Tracker | null>(null);

export function usePaymentTracker(): Tracker {
  const v = useContext(Ctx);
  if (!v) throw new Error('PaymentTrackerProvider manquant');
  return v;
}

/**
 * Suivi du paiement au niveau de l'application : la tentative survit au rechargement (localStorage, par compte) et a
 * la navigation, et l'annonce « Paiement recu » arrive sur n'importe quelle page de la console.
 */
export function PaymentTrackerProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const userId = me?.id ?? null;
  const [attempt, setAttemptState] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const loadedFor = useRef<string | null>(null);
  const announced = useRef<string | null>(null);
  const terminalRef = useRef(false);
  const [viewing, setViewing] = useState(false);

  const update = useCallback(
    (a: Attempt | null) => {
      attemptRef.current = a;
      setAttemptState(a);
      if (userId) writeAttempt(storageKey(userId), a);
    },
    [userId],
  );

  // lecture au montage (et au changement de compte) ; deconnexion : plus de suivi en memoire
  useEffect(() => {
    if (!userId) {
      loadedFor.current = null;
      attemptRef.current = null;
      setAttemptState(null);
      return;
    }
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    const a = readAttempt(storageKey(userId));
    attemptRef.current = a;
    setAttemptState(a);
  }, [userId]);

  const m = useMutation<unknown, unknown, Attempt>({
    mutationFn: (a) => api.checkout({ id: a.id, ...a.body }),
    onSuccess: (r, a) => update({ ...a, paymentId: (r as { payment_id: string }).payment_id, unsent: false }),
    onError: (err, a) => {
      const o = checkoutOutcome(err);
      if (o.kind === 'pending') update({ ...a, paymentId: o.paymentId, unsent: false, unknown: true });
      else if (o.kind === 'open') update({ ...a, paymentId: o.paymentId, unsent: false, unknown: true, existing: true });
      else if (o.kind === 'refused' || o.kind === 'conflict' || isDefinitiveRejection(err)) update(null); // rien n'a ete cree : nouvelle cle au prochain essai
      else update({ ...a, unsent: true }); // issue inconnue : bloque tout nouveau checkout, seul « Reessayer » est offert
    },
  });

  const submit = useCallback<Tracker['submit']>(
    (body, meta) => {
      if (m.isPending) return; // pas de double envoi
      const cur = attemptRef.current;
      if (cur && cur.unsent) {
        m.mutate(cur); // meme id, meme corps : la formule choisie entre-temps est ignoree
        return;
      }
      if (cur && cur.paymentId && !terminalRef.current) return; // un paiement est deja suivi
      const a: Attempt = { id: newPaymentId(), body, planName: meta.planName, amount: meta.amount, paymentId: null, unsent: false, unknown: false, existing: false };
      m.reset();
      update(a); // persiste avant l'envoi : un rechargement en plein vol retrouve la meme cle
      m.mutate(a);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.isPending, m.mutate, m.reset, update],
  );

  /* ------------------------------------------------------------ suivi */
  const paymentId = attempt?.paymentId ?? null;
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const quietRef = useRef(false);
  useEffect(() => {
    if (!paymentId) return;
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    // le compte a rebours ne tourne que jusqu'au delai ou a une issue
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - start >= pollTiming.maxMs || quietRef.current) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [paymentId]);

  const isGone = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);
  const q = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => api.payment(paymentId!),
    enabled: !!paymentId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (isTerminal(s) || isGone(query.state.error)) return false;
      if (isUnderReview(s) || (startedAt && Date.now() - startedAt >= pollTiming.maxMs)) return pollTiming.slowMs;
      return pollTiming.intervalMs;
    },
    refetchIntervalInBackground: true,
    retry: (n, e) => !isGone(e) && n < 2,
  });
  const status = paymentId ? q.data?.status : undefined;
  const notFound = isGone(q.error);
  terminalRef.current = isTerminal(status);
  quietRef.current = isTerminal(status) || isUnderReview(status);
  const elapsed = startedAt ? now - startedAt : 0;
  const timedOut = !!paymentId && elapsed >= pollTiming.maxMs && !isTerminal(status);

  const dismiss = useCallback(() => {
    m.reset();
    update(null);
  }, [m, update]);

  // issue definitive : on ne garde plus rien en stockage ; annonce une seule fois
  useEffect(() => {
    if (!attempt || !paymentId || !isTerminal(status)) return;
    if (userId) writeAttempt(storageKey(userId), null);
    if (announced.current === paymentId) return;
    announced.current = paymentId;
    if (status === 'confirme') {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast(t('pay.received', { plan: attempt.planName }));
    } else if (status === 'echoue' && !viewing) {
      toast(t('pay.refused.late'), 'err');
    }
  }, [status, paymentId, attempt, userId, qc, toast, viewing]);

  // issue definitive et personne ne regarde : on repart de zero (la fenetre qui la montre la garde jusqu'a sa fermeture)
  useEffect(() => {
    if (attempt && isTerminal(status) && !viewing) dismiss();
  }, [attempt, status, viewing, dismiss]);

  const value = useMemo<Tracker>(
    () => ({
      attempt,
      status,
      timedOut,
      remaining: Math.max(0, Math.ceil((pollTiming.maxMs - elapsed) / 1000)),
      notFound,
      pollError: notFound ? null : q.error,
      submitting: m.isPending,
      submitError: m.error,
      submit,
      dismiss,
      clearError: () => {
        if (!m.isPending) m.reset();
      },
      setViewing,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt, status, timedOut, elapsed, notFound, q.error, m.isPending, m.error, submit, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

