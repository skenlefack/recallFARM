import { ApiError } from '../api/client';

export type CheckoutOutcome =
  | { kind: 'refused' } // PAY-INIT : paiement echoue, on peut reessayer (avec une nouvelle cle)
  | { kind: 'pending'; paymentId: string } // PAY-PENDING : issue inconnue, NE PAS relancer, suivre
  | { kind: 'conflict' } // PAY-IDEMPOTENCY : la cle a servi a une autre demande
  | { kind: 'open'; paymentId: string; plan?: string } // PAY-OPEN : le compte a deja un paiement ouvert (toutes formules), on le suit
  | { kind: 'recent'; paymentId: string; plan?: string; paidAt: string } // PAY-RECENT : un paiement de ce payeur a ete confirme il y a quelques minutes ; passer outre = decision explicite
  | { kind: 'retry' } // PAY-RETRY : un autre paiement de ce payeur vient de se terminer ; la suite se decide apres rechargement de l'abonnement
  | { kind: 'other' };

/** Interprete une erreur de POST /subscriptions/checkout (422 BUSINESS_RULE, 409 CONFLICT). */
export function checkoutOutcome(err: unknown): CheckoutOutcome {
  if (!(err instanceof ApiError)) return { kind: 'other' };
  if (err.code === 'CONFLICT' && err.rule === 'PAY-IDEMPOTENCY') return { kind: 'conflict' };
  if (err.code === 'CONFLICT' && err.rule === 'PAY-RETRY') return { kind: 'retry' };
  if (err.code === 'CONFLICT' && err.rule === 'PAY-RECENT') {
    const id = err.details?.payment_id;
    const paidAt = err.details?.paid_at;
    const plan = err.details?.plan;
    return typeof id === 'string' && id && typeof paidAt === 'string' && !Number.isNaN(Date.parse(paidAt)) ? { kind: 'recent', paymentId: id, paidAt, ...(typeof plan === 'string' && plan ? { plan } : {}) } : { kind: 'other' };
  }
  if (err.code === 'CONFLICT' && err.rule === 'PAY-OPEN') {
    const id = err.details?.payment_id;
    const plan = err.details?.plan;
    return typeof id === 'string' && id ? { kind: 'open', paymentId: id, ...(typeof plan === 'string' && plan ? { plan } : {}) } : { kind: 'other' };
  }
  if (err.code !== 'BUSINESS_RULE') return { kind: 'other' };
  if (err.rule === 'PAY-INIT') return { kind: 'refused' };
  if (err.rule === 'PAY-PENDING') {
    const id = err.details?.payment_id;
    if (typeof id === 'string' && id) return { kind: 'pending', paymentId: id };
  }
  return { kind: 'other' };
}

/** Pastille : initiales du libelle declare par le pack (aucun operateur en dur). */
export function methodInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const s = words.length > 1 ? words.map((w) => w[0]).join('') : label.trim().slice(0, 2);
  return s.slice(0, 3).toUpperCase();
}

/** UUID v4 cree par le client (POST /subscriptions/checkout idempotent). */
export function newPaymentId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Anciens WebView Android : randomUUID absent, getRandomValues present.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

export const PAYMENT_STATUSES = ['initie', 'en_attente', 'a_verifier', 'confirme', 'echoue', 'remboursement_en_cours', 'rembourse'] as const;
export type PayStatus = (typeof PAYMENT_STATUSES)[number];

/** Issue definitive : on arrete le suivi et on repart de zero. */
export function isTerminal(status: string | undefined): boolean {
  return status === 'confirme' || status === 'echoue' || status === 'rembourse';
}

/**
 * Issue encore ouverte cote serveur sans que le payeur puisse reessayer : a_verifier et remboursement_en_cours.
 * On garde le paiement et sa cle, on continue le suivi (lent) : fermer puis rouvrir ne cree jamais un 2e paiement.
 */
export function isUnderReview(status: string | undefined): boolean {
  return status === 'a_verifier' || status === 'remboursement_en_cours';
}

/** Une reponse 4xx (hors 408) prouve que le serveur a refuse la demande sans rien creer ; 5xx, reseau, delai : issue inconnue. */
export function isDefinitiveRejection(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408;
}

export const PAYMENT_TONE: Record<PayStatus, 'ok' | 'warn' | 'crit' | 'info' | 'neutral' | 'blue'> = {
  initie: 'neutral',
  en_attente: 'info',
  a_verifier: 'warn',
  confirme: 'ok',
  echoue: 'crit',
  remboursement_en_cours: 'warn',
  rembourse: 'blue',
};
