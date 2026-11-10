import type { Plan } from '../api/types';

export type Period = 'monthly' | 'yearly';

/** Static prices of the design, used when /plans is unreachable. */
export const FALLBACK_PRICES: Record<string, { monthly: number | null; yearly: number | null; from?: boolean }> = {
  decouverte: { monthly: 0, yearly: 0 },
  pro: { monthly: 2500, yearly: 25000 },
  structure: { monthly: 15000, yearly: 150000, from: true },
  institution: { monthly: null, yearly: null },
};

export function priceOf(plan: Plan | undefined, code: string, period: Period): { amount: number | null; from: boolean } {
  if (plan) {
    if (plan.price === null) return { amount: null, from: false };
    if (plan.price) {
      const m = period === 'yearly' ? plan.price.yearly : plan.price.monthly;
      // Structure is priced by tranche of farmers followed (D-10): always « dès »
      return { amount: m ? m.amount_minor : null, from: !!plan.price.from || code === 'structure' };
    }
    const v = period === 'yearly' ? plan.yearly_minor : plan.monthly_minor;
    if (v !== undefined) return { amount: v ?? null, from: code === 'structure' };
  }
  const f = FALLBACK_PRICES[code];
  return { amount: period === 'yearly' ? f.yearly : f.monthly, from: !!f.from };
}

