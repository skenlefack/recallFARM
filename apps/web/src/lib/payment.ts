import { ApiError } from '../api/client';

export type CheckoutOutcome =
  | { kind: 'refused' } // PAY-INIT : paiement echoue, on peut reessayer (avec une nouvelle cle)
  | { kind: 'pending'; paymentId: string } // PAY-PENDING : issue inconnue, NE PAS relancer, suivre
  | { kind: 'conflict' } // PAY-IDEMPOTENCY : la cle a servi a une autre demande
  | { kind: 'other' };

/** Interprete une erreur de POST /subscriptions/checkout (422 BUSINESS_RULE, 409 CONFLICT). */
export function checkoutOutcome(err: unknown): CheckoutOutcome {
  if (!(err instanceof ApiError)) return { kind: 'other' };
  if (err.code === 'CONFLICT' && err.rule === 'PAY-IDEMPOTENCY') return { kind: 'conflict' };
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

/** Empreinte des parametres d'un paiement : une cle d'idempotence ne sert qu'a une seule demande (409 PAY-IDEMPOTENCY sinon). */
export function checkoutKey(p: { account_id: string; plan: string; period: string; method: string; phone: string }): string {
  return [p.account_id, p.plan, p.period, p.method, p.phone].join('|');
}

export const PAYMENT_STATUSES = ['initie', 'en_attente', 'a_verifier', 'confirme', 'echoue', 'remboursement_en_cours', 'rembourse'] as const;
export type PayStatus = (typeof PAYMENT_STATUSES)[number];

/** Apres ces statuts le suivi par interrogation s'arrete (le serveur a tranche, ou poursuit seul). */
export function isSettled(status: string | undefined): boolean {
  return status !== undefined && status !== 'initie' && status !== 'en_attente';
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
