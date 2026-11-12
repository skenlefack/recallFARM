import type { Plan } from '../api/types';

export type Period = 'monthly' | 'yearly';

export interface PriceView {
  /** Unite mineure ; null = « sur devis » ; undefined = tarif inconnu (API injoignable). */
  amount: number | null | undefined;
  /** Devise ISO 4217 recue de l'API (jamais supposee). */
  currency: string | undefined;
  from: boolean;
}

/**
 * Prix d'une formule pour une periode. Aucun tarif ni devise par defaut : tout vient de GET /plans
 * (pack pays). `responseCurrency` = devise de niveau reponse, utilisee si la formule n'en porte pas.
 */
export function priceOf(plan: Plan | undefined, code: string, period: Period, responseCurrency?: string): PriceView {
  if (!plan) return { amount: undefined, currency: undefined, from: false };
  if (plan.price === null) return { amount: null, currency: undefined, from: false };
  if (plan.price) {
    const m = period === 'yearly' ? plan.price.yearly : plan.price.monthly;
    // Structure is priced by tranche of farmers followed (D-10): always « dès »
    return { amount: m ? m.amount_minor : null, currency: m?.currency ?? plan.currency ?? responseCurrency, from: !!plan.price.from || code === 'structure' };
  }
  const v = period === 'yearly' ? plan.yearly_minor : plan.monthly_minor;
  if (v !== undefined) return { amount: v ?? null, currency: plan.currency ?? responseCurrency, from: code === 'structure' };
  return { amount: undefined, currency: undefined, from: false };
}
