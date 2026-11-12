import { describe, expect, it } from 'vitest';
import type { Plan } from '../api/types';
import { currencyLabel, money } from './format';
import { checkoutKey, isSettled, methodInitials, newPaymentId, PAYMENT_STATUSES, PAYMENT_TONE } from './payment';
import { priceOf } from './plans';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('money : unite mineure ISO 4217 + devise de l\'API', () => {
  it('exposant 0 (zone CFA) : 2500 unites = « 2 500 » + libelle Intl', () => {
    expect(money(2500, 'XAF')).toMatch(/^2.500.FCFA$/);
    expect(money(15000, 'XOF')).toMatch(/^15.000.F.?CFA$/); // libelle fourni par Intl (CLDR), pas par le code
  });
  it('exposant 2 : 1999 unites mineures = 19,99', () => {
    expect(money(1999, 'EUR')).toMatch(/^19,99.€$/);
    expect(money(100, 'USD')).toMatch(/^1,00.\$US$/);
  });
  it('code en minuscules accepte, code inconnu : nombre + code recu', () => {
    expect(money(2500, 'xaf')).toMatch(/FCFA$/);
    expect(money(2500, 'ZZZZ')).toMatch(/^2.500.ZZZZ$/);
  });
  it('sans devise : le nombre seul, jamais une unite inventee', () => {
    expect(money(2500, undefined)).toMatch(/^2.500$/);
    expect(money(2500, null)).not.toMatch(/FCFA|XAF/);
  });
  it('valeur absente : tiret', () => {
    expect(money(null, 'XAF')).toBe('—');
    expect(money(undefined, 'XAF')).toBe('—');
    expect(money(Number.NaN, 'XAF')).toBe('—');
  });
  it('currencyLabel : symbole Intl ou code', () => {
    expect(currencyLabel('XAF')).toBe('FCFA');
    expect(currencyLabel('EUR')).toBe('€');
    expect(currencyLabel('ZZZZ')).toBe('ZZZZ');
    expect(currencyLabel(undefined)).toBe('');
  });
});

describe('priceOf : aucun tarif ni devise par defaut', () => {
  const plan = (p: Partial<Plan>): Plan => ({ code: 'pro', features: [], quotas: {}, ...p });
  it('sans formule : tarif inconnu', () => {
    expect(priceOf(undefined, 'pro', 'monthly')).toEqual({ amount: undefined, currency: undefined, from: false });
  });
  it('prix null : sur devis', () => {
    expect(priceOf(plan({ price: null }), 'institution', 'monthly').amount).toBeNull();
  });
  it('prix du pack : devise de la formule', () => {
    const p = plan({ price: { monthly: { amount_minor: 2500, currency: 'XAF' }, yearly: { amount_minor: 25000, currency: 'XAF' } } });
    expect(priceOf(p, 'pro', 'yearly')).toEqual({ amount: 25000, currency: 'XAF', from: false });
  });
  it('structure : toujours « des » ; periode absente : sur devis', () => {
    const p = plan({ code: 'structure', price: { monthly: null, yearly: { amount_minor: 1, currency: 'XAF' } } });
    expect(priceOf(p, 'structure', 'monthly')).toMatchObject({ amount: null, from: true });
  });
  it('anciens champs *_minor : devise de la formule, sinon celle de la reponse', () => {
    expect(priceOf(plan({ monthly_minor: 500, currency: 'EUR' }), 'pro', 'monthly')).toEqual({ amount: 500, currency: 'EUR', from: false });
    expect(priceOf(plan({ yearly_minor: 900 }), 'pro', 'yearly', 'XOF')).toEqual({ amount: 900, currency: 'XOF', from: false });
    expect(priceOf(plan({ monthly_minor: null }), 'structure', 'monthly')).toMatchObject({ amount: null, from: true });
  });
  it('formule sans aucun prix : inconnu', () => {
    expect(priceOf(plan({}), 'pro', 'monthly').amount).toBeUndefined();
  });
});

describe('lib/payment', () => {
  it('newPaymentId : UUID v4, different a chaque appel', () => {
    const a = newPaymentId();
    expect(a).toMatch(UUID_V4);
    expect(newPaymentId()).not.toBe(a);
  });
  it('newPaymentId sans crypto.randomUUID (anciens WebView) : UUID v4 valide', () => {
    const c = globalThis.crypto;
    const stub = { getRandomValues: c.getRandomValues.bind(c) } as unknown as Crypto;
    Object.defineProperty(globalThis, 'crypto', { value: stub, configurable: true });
    try {
      for (let i = 0; i < 20; i++) expect(newPaymentId()).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: c, configurable: true });
    }
  });
  it('checkoutKey change des qu\'un parametre change', () => {
    const base = { account_id: 'a', plan: 'pro', period: 'monthly', method: 'm', phone: '+1' };
    expect(checkoutKey(base)).toBe(checkoutKey({ ...base }));
    for (const k of Object.keys(base)) expect(checkoutKey({ ...base, [k]: 'autre' })).not.toBe(checkoutKey(base));
  });
  it('isSettled : seuls initie et en_attente restent a suivre', () => {
    expect(PAYMENT_STATUSES.filter((s) => !isSettled(s))).toEqual(['initie', 'en_attente']);
    expect(isSettled(undefined)).toBe(false);
  });
  it('chaque statut a une teinte', () => {
    for (const s of PAYMENT_STATUSES) expect(PAYMENT_TONE[s]).toBeTruthy();
  });
  it('methodInitials', () => {
    expect(methodInitials('Orange Money')).toBe('OM');
    expect(methodInitials('Wave')).toBe('WA');
  });
});
