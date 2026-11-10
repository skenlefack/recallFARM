import { ApiError } from '../api/client';

export type CheckoutOutcome =
  | { kind: 'refused' } // PAY-INIT : paiement echoue, on peut reessayer
  | { kind: 'pending'; paymentId: string } // PAY-PENDING : issue inconnue, NE PAS relancer, suivre
  | { kind: 'other' };

/** Interprete une erreur de POST /subscriptions/checkout (422 BUSINESS_RULE). */
export function checkoutOutcome(err: unknown): CheckoutOutcome {
  if (!(err instanceof ApiError) || err.code !== 'BUSINESS_RULE') return { kind: 'other' };
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
