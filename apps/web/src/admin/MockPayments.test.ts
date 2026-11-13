import { afterEach, describe, expect, it } from 'vitest';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { setLocale } from '../lib/i18n';
import { money } from '../lib/format';

/** Le mock doit repondre comme le contrat de l'API (regles de remboursement, proprietaire, rejeu). */
async function tokenOf(phone: string) {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456' }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
const call = (method: string, url: string, token: string, body?: unknown) =>
  mockTransport(method, url, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(() => {
  session.clear();
  setLocale('fr');
});

describe('mock : regle de remboursement du serveur (payment-ops.service.ts)', () => {
  it('relance acceptee si le remboursement est a_verifier (meme reference), 409 si en_attente', async () => {
    const admin = await tokenOf('+237690000009');
    const retry = await call('POST', '/v1/admin/payments/00000000-0000-4000-8000-0000000000a7/refund', admin, { reason: 'Erreur de formule' });
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as { status: string; refund: { id: string; status: string } };
    expect(body.status).toBe('rembourse');
    expect(body.refund).toMatchObject({ id: '00000000-0000-4000-8000-0000000000b7', status: 'rembourse' });
    const pending = await call('POST', '/v1/admin/payments/00000000-0000-4000-8000-0000000000a5/refund', admin, { reason: 'Double paiement' });
    expect(pending.status).toBe(409);
    expect(((await pending.json()) as { error: { details: { rule: string } } }).error.details.rule).toBe('PAY-REFUND-IN-PROGRESS');
  });
});

describe('mock : suivi et rejeu du checkout', () => {
  const checkout = (token: string, id: string, phone: string, plan = 'pro') =>
    call('POST', '/v1/subscriptions/checkout', token, { id, account_type: 'user', account_id: 'u-1', plan, period: 'monthly', method: 'orange_money', phone });

  it("GET /payments/:id : le proprietaire lit, un autre compte sans role recoit 403", async () => {
    const owner = await tokenOf('+237690000002');
    const other = await tokenOf('+237690000001');
    const r = (await (await checkout(owner, '9d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f', '+237690000011')).json()) as { payment_id: string };
    expect((await call('GET', `/v1/payments/${r.payment_id}`, owner)).status).toBe(200);
    expect((await call('GET', `/v1/payments/${r.payment_id}`, other)).status).toBe(403);
    expect((await call('GET', `/v1/payments/${r.payment_id}`, await tokenOf('+237690000009'))).status).toBe(200);
  });

  it('PAY-OPEN : un 2e paiement du meme compte, meme pour une AUTRE formule, renvoie 409 avec le paiement ouvert et sa formule', async () => {
    const user = await tokenOf('+237690000001');
    const first = (await (await checkout(user, '9d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e70', '+237690000011', 'structure')).json()) as { payment_id: string };
    const second = await checkout(user, '9d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e71', '+237690000011', 'pro');
    expect(second.status).toBe(409);
    const err = ((await second.json()) as { error: { code: string; details: { rule: string; payment_id: string; plan: string; status: string } } }).error;
    expect(err.code).toBe('CONFLICT');
    expect(err.details).toMatchObject({ rule: 'PAY-OPEN', payment_id: first.payment_id, plan: 'structure', status: 'initie' });
    // un autre compte n'est pas concerne
    expect((await checkout(await tokenOf('+237690000003'), '9d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e72', '+237690000011', 'pro')).status).toBe(201);
  });

  it('PAY-PENDING rejoue tant qu\'il n\'y a pas de reference fournisseur ni de confirmation', async () => {
    const owner = await tokenOf('+237690000004');
    const id = '9d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e60';
    expect((await checkout(owner, id, '+237690000096', 'decouverte')).status).toBe(422);
    const again = await checkout(owner, id, '+237690000096', 'decouverte');
    expect(again.status).toBe(422);
    const rule = ((await again.json()) as { error: { details: { rule: string; replayed: boolean } } }).error.details;
    expect(rule).toMatchObject({ rule: 'PAY-PENDING', replayed: true });
  });
});

describe('money suit la locale active', () => {
  it('fr : « 25,00 € » ; en : « €25.00 »', () => {
    expect(money(2500, 'EUR')).toMatch(/^25,00.€$/);
    setLocale('en');
    expect(money(2500, 'EUR')).toBe('€25.00');
  });
});
