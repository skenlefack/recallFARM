import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import { session } from '../api/session';
import type { CheckoutResponse, Money, PaymentStatus, PlanCode } from '../api/types';
import { useToast } from '../components/ui';
import { PLAN_LABEL } from '../lib/format';
import { t } from '../lib/i18n';
import { checkoutOutcome, isDefinitiveRejection, isTerminal, isUnderReview, newPaymentId } from '../lib/payment';
import { useAuth } from './auth';

/**
 * Delais de suivi. `maxMs` : apres ce delai on previent, le suivi continue plus lentement.
 * En a_verifier le suivi recule : slowMs (15 s) pour les `midAfter` premieres reponses, puis midMs (60 s), puis longMs (5 min).
 * Modifiable par les tests.
 */
export const pollTiming = { intervalMs: 5000, slowMs: 15_000, midMs: 60_000, longMs: 300_000, midAfter: 5, longAfter: 15, maxMs: 120_000 };

/** Intervalle d'interrogation d'un paiement a_verifier / remboursement_en_cours, selon le nombre de reponses deja recues. */
export function reviewInterval(polls: number): number {
  if (polls < pollTiming.midAfter) return pollTiming.slowMs;
  if (polls < pollTiming.longAfter) return pollTiming.midMs;
  return pollTiming.longMs;
}

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
  /** Compte qui a lance le paiement : une reponse qui arrive apres un changement de compte est ignoree. */
  ownerId: string;
  plan: string;
  planName: string;
  period: 'monthly' | 'yearly';
  method: string;
  /** Telephone masque (seul affiche apres rechargement). */
  phoneMasked: string;
  amount: Money | null;
  /** Corps complet (numero compris) : memoire et sessionStorage seulement, jamais localStorage. Null apres un rechargement dans un autre onglet. */
  body: PayBody | null;
  /** Paiement connu du serveur (reponse du checkout, PAY-PENDING ou PAY-OPEN). */
  paymentId: string | null;
  /** Instant de l'envoi (ms) : le temps ecoule se calcule depuis lui, meme apres un rechargement. */
  sentAt: number;
  /** « Reessayer » deja tentes sans reponse (memoire seulement). */
  tries: number;
  /** Envoi sans reponse claire (reseau, 5xx, delai) : seul « Reessayer » (meme id, meme corps) est permis. */
  unsent: boolean;
  /** Issue inconnue (PAY-PENDING, PAY-OPEN) : on suit sans jamais relancer. */
  unknown: boolean;
  /** PAY-OPEN : le paiement suivi etait deja ouvert (autre ecran, autre appareil). */
  existing: boolean;
}

/** Ce que contient localStorage : aucune donnee personnelle (telephone masque, pas de numero de compte). */
type Stored = Pick<Attempt, 'id' | 'ownerId' | 'paymentId' | 'plan' | 'planName' | 'period' | 'method' | 'amount' | 'sentAt' | 'unsent' | 'unknown' | 'existing' | 'phoneMasked'>;

const PREFIX = 'rf.payment.';
const storageKey = (userId: string) => `${PREFIX}v1.${userId}`;
const bodyKey = (userId: string) => `${PREFIX}body.v1.${userId}`;

/** « +237690000011 » -> « ••••••11 ». */
export function maskPhone(p: string): string {
  const d = p.replace(/\s/g, '');
  return d.length <= 4 ? '••••' : `••••••${d.slice(-2)}`;
}

function warn(what: string, e: unknown): void {
  console.warn(`[paiement] ${what} : stockage indisponible, le suivi reste en memoire`, e);
}

function parseStored(raw: string, userId: string): Stored | null {
  try {
    const a = JSON.parse(raw) as Partial<Stored>;
    if (typeof a.id !== 'string' || a.ownerId !== userId || typeof a.planName !== 'string' || typeof a.sentAt !== 'number') return null;
    return {
      id: a.id,
      ownerId: a.ownerId,
      paymentId: a.paymentId ?? null,
      plan: a.plan ?? '',
      planName: a.planName,
      period: a.period === 'yearly' ? 'yearly' : 'monthly',
      method: a.method ?? '',
      amount: a.amount ?? null,
      sentAt: a.sentAt,
      unsent: !!a.unsent || !a.paymentId, // envoi en vol au rechargement : issue inconnue
      unknown: !!a.unknown,
      existing: !!a.existing,
      phoneMasked: a.phoneMasked ?? '••••',
    };
  } catch (e) {
    warn('lecture', e);
    return null;
  }
}

function readBody(userId: string, id: string): PayBody | null {
  try {
    const raw = sessionStorage.getItem(bodyKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: string; body?: PayBody };
    return v.id === id && v.body ? v.body : null;
  } catch (e) {
    warn('lecture du corps', e);
    return null;
  }
}

function fromStored(s: Stored, body: PayBody | null): Attempt {
  return { ...s, body, tries: 0 };
}

function readAttempt(userId: string): Attempt | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const s = parseStored(raw, userId);
    return s ? fromStored(s, readBody(userId, s.id)) : null;
  } catch (e) {
    warn('lecture', e);
    return null;
  }
}

function writeAttempt(userId: string, a: Attempt | null): void {
  try {
    if (!a) {
      localStorage.removeItem(storageKey(userId));
      sessionStorage.removeItem(bodyKey(userId));
      return;
    }
    const stored: Stored = {
      id: a.id,
      ownerId: a.ownerId,
      paymentId: a.paymentId,
      plan: a.plan,
      planName: a.planName,
      period: a.period,
      method: a.method,
      amount: a.amount,
      sentAt: a.sentAt,
      unsent: a.unsent,
      unknown: a.unknown,
      existing: a.existing,
      phoneMasked: a.phoneMasked,
    };
    localStorage.setItem(storageKey(userId), JSON.stringify(stored));
    if (a.body) sessionStorage.setItem(bodyKey(userId), JSON.stringify({ id: a.id, body: a.body }));
  } catch (e) {
    warn('ecriture', e);
  }
}

/** Deconnexion ou expiration : plus aucune trace de paiement dans le navigateur (le serveur retrouve le paiement via PAY-OPEN). */
export function purgePaymentStorage(): void {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(PREFIX)) keys.push(k);
      }
      keys.forEach((k) => store.removeItem(k));
    } catch (e) {
      warn('purge', e);
    }
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

const isGone = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);

/**
 * Suivi du paiement au niveau de l'application : la tentative survit au rechargement et a la navigation (localStorage
 * sans donnee personnelle, par compte ; corps complet en sessionStorage), est partagee entre onglets, et l'annonce
 * « Paiement recu » arrive sur n'importe quelle page de la console.
 */
export function PaymentTrackerProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const userId = me?.id ?? null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const [attempt, setAttemptState] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const announced = useRef<string | null>(null);
  const terminalRef = useRef(false);
  const sendingRef = useRef(false);
  const [viewing, setViewing] = useState(false);

  const update = useCallback((a: Attempt | null) => {
    if (a && a.ownerId !== userIdRef.current) return; // une tentative d'un autre compte n'entre jamais
    attemptRef.current = a;
    setAttemptState(a);
    if (userIdRef.current) writeAttempt(userIdRef.current, a);
  }, []);

  const m = useMutation<CheckoutResponse, unknown, Attempt>({
    mutationFn: (a) => api.checkout({ id: a.id, ...a.body! }),
    onSuccess: (r, a) => {
      if (a.ownerId !== userIdRef.current) return; // reponse arrivee apres une deconnexion ou un changement de compte
      sendingRef.current = false;
      update({ ...a, paymentId: r.payment_id, unsent: false, sentAt: Date.now() });
    },
    onError: (err, a) => {
      if (a.ownerId !== userIdRef.current) return;
      sendingRef.current = false;
      const o = checkoutOutcome(err);
      if (o.kind === 'pending') update({ ...a, paymentId: o.paymentId, unsent: false, unknown: true });
      else if (o.kind === 'open') {
        // le compte n'a qu'un abonnement : le paiement ouvert peut etre d'une autre formule, c'est elle qu'on annonce
        const differs = !!o.plan && o.plan !== a.plan;
        update({
          ...a,
          paymentId: o.paymentId,
          unsent: false,
          unknown: true,
          existing: true,
          plan: o.plan ?? a.plan,
          planName: differs ? (PLAN_LABEL[o.plan!] ?? o.plan!) : a.planName,
          amount: differs ? null : a.amount,
          sentAt: Date.now(),
        });
      } else if (o.kind === 'refused' || o.kind === 'conflict' || isDefinitiveRejection(err)) update(null); // rien n'a ete cree : nouvelle cle au prochain essai
      else update({ ...a, unsent: true }); // issue inconnue : bloque tout nouveau checkout, seul « Reessayer » est offert
    },
  });
  const { mutate, reset } = m;

  // lecture au montage et au changement de compte ; deconnexion : plus de suivi, plus d'envoi en vol
  useEffect(() => {
    sendingRef.current = false;
    reset();
    const a = userId ? readAttempt(userId) : null;
    attemptRef.current = a;
    setAttemptState(a);
  }, [userId, reset]);

  // deconnexion ou expiration : purge
  useEffect(
    () =>
      session.subscribe((reason) => {
        if (reason === 'logout' || reason === 'expired') {
          purgePaymentStorage();
          attemptRef.current = null;
          setAttemptState(null);
        }
      }),
    [],
  );

  // autre onglet : on suit son etat, on ne ressuscite jamais une tentative qu'il a effacee
  useEffect(() => {
    if (!userId) return;
    const key = storageKey(userId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || sendingRef.current) return;
      if (e.newValue === null) {
        attemptRef.current = null;
        setAttemptState(null);
        return;
      }
      const s = parseStored(e.newValue, userId);
      if (!s) return;
      const cur = attemptRef.current;
      const next = fromStored(s, cur?.id === s.id ? cur.body : readBody(userId, s.id));
      attemptRef.current = next;
      setAttemptState(next); // sans reecriture : l'autre onglet en est l'auteur
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const submit = useCallback<Tracker['submit']>(
    (body, meta) => {
      const owner = userIdRef.current;
      if (sendingRef.current || !owner) return; // pas de double envoi (garde sur ref : sure entre deux rendus)
      const cur = attemptRef.current;
      if (cur && cur.unsent) {
        if (!cur.body) return; // corps perdu (autre onglet) : seul « Abandonner » reste
        const next = { ...cur, tries: cur.tries + 1 };
        sendingRef.current = true;
        update(next);
        mutate(next); // meme id, meme corps : la formule choisie entre-temps est ignoree
        return;
      }
      if (cur && cur.paymentId && !terminalRef.current) return; // un paiement est deja suivi
      const a: Attempt = {
        id: newPaymentId(),
        ownerId: owner,
        plan: body.plan,
        planName: meta.planName,
        period: body.period,
        method: body.method,
        phoneMasked: maskPhone(body.phone),
        amount: meta.amount,
        body,
        paymentId: null,
        sentAt: Date.now(),
        tries: 0,
        unsent: false,
        unknown: false,
        existing: false,
      };
      sendingRef.current = true;
      reset();
      update(a); // persiste avant l'envoi : un rechargement en plein vol retrouve la meme cle
      mutate(a);
    },
    [mutate, reset, update],
  );

  /* ------------------------------------------------------------ suivi */
  const paymentId = attempt?.paymentId ?? null;
  const sentAt = attempt?.sentAt ?? 0;
  const sentAtRef = useRef(sentAt);
  sentAtRef.current = sentAt;
  const [now, setNow] = useState(() => Date.now());
  const quietRef = useRef(false);
  useEffect(() => {
    if (!paymentId) return;
    setNow(Date.now());
    // le compte a rebours ne tourne que jusqu'au delai ou a une issue
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - sentAtRef.current >= pollTiming.maxMs || quietRef.current) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [paymentId, sentAt]);

  const pastMax = !!paymentId && Date.now() - sentAt >= pollTiming.maxMs;
  const q = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => api.payment(paymentId!),
    enabled: !!paymentId && !!userId, // jamais de GET sans compte connecte
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (isTerminal(s) || isGone(query.state.error)) return false;
      if (isUnderReview(s)) return reviewInterval(query.state.dataUpdateCount);
      if (Date.now() - sentAtRef.current >= pollTiming.maxMs) return pollTiming.slowMs;
      return pollTiming.intervalMs;
    },
    // pas d'interrogation en arriere-plan apres le delai : un onglet oublie ne harcele pas le serveur
    refetchIntervalInBackground: !pastMax,
    refetchOnWindowFocus: false,
    retry: (n, e) => !isGone(e) && n < 2,
  });
  const status = paymentId && userId ? q.data?.status : undefined;
  const notFound = !!userId && isGone(q.error);
  terminalRef.current = isTerminal(status);
  quietRef.current = isTerminal(status) || isUnderReview(status);
  const elapsed = sentAt ? now - sentAt : 0;
  const timedOut = !!paymentId && sentAt > 0 && Math.max(elapsed, Date.now() - sentAt) >= pollTiming.maxMs && !isTerminal(status);

  const dismiss = useCallback(() => {
    sendingRef.current = false;
    reset();
    update(null);
  }, [reset, update]);

  // issue definitive : on ne garde plus rien en stockage ; annonce une seule fois
  useEffect(() => {
    if (!attempt || !paymentId || !isTerminal(status)) return;
    if (userIdRef.current) writeAttempt(userIdRef.current, null);
    if (announced.current === paymentId) return;
    announced.current = paymentId;
    if (status === 'confirme') {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast(t('pay.received', { plan: attempt.planName }));
    } else if (status === 'echoue' && !viewing) {
      toast(t('pay.refused.late'), 'err');
    }
  }, [status, paymentId, attempt, qc, toast, viewing]);

  // issue definitive et personne ne regarde : on repart de zero (la fenetre qui la montre la garde jusqu'a sa fermeture)
  useEffect(() => {
    if (attempt && isTerminal(status) && !viewing) dismiss();
  }, [attempt, status, viewing, dismiss]);

  const clearError = useCallback(() => {
    if (!sendingRef.current) reset();
  }, [reset]);

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
      clearError,
      setViewing,
    }),
    [attempt, status, timedOut, elapsed, notFound, q.error, m.isPending, m.error, submit, dismiss, clearError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
