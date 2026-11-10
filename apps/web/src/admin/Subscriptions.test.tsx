import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import { checkoutOutcome } from '../lib/payment';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Transport qui delegue au mock mais substitue /plans (moyens du pack). */
function withMethods(methods: { code: string; label: string }[]): Transport {
  return async (method, url, init) => {
    const real = await mockTransport(method, url, init);
    if (url.includes('/plans')) {
      const body = (await real.json()) as object;
      return json(200, { ...body, payment_methods: methods });
    }
    return real;
  };
}

async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string };
  session.setTokens(j.access_token, j.refresh_token);
}

async function openCheckout() {
  renderApp(<Subscriptions />);
  await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
  await screen.findByRole('dialog');
}

beforeEach(async () => {
  setTransport(mockTransport);
  await login();
});
afterEach(() => {
  setTransport(null);
  session.clear();
});

describe('checkoutOutcome', () => {
  it('classe PAY-INIT, PAY-PENDING et le reste', () => {
    expect(checkoutOutcome(new ApiError(422, 'BUSINESS_RULE', 'x', undefined, { rule: 'PAY-INIT' })).kind).toBe('refused');
    expect(checkoutOutcome(new ApiError(422, 'BUSINESS_RULE', 'x', undefined, { rule: 'PAY-PENDING', payment_id: 'p1' }))).toEqual({ kind: 'pending', paymentId: 'p1' });
    expect(checkoutOutcome(new ApiError(422, 'BUSINESS_RULE', 'x', undefined, { rule: 'PAY-PENDING' })).kind).toBe('other');
    expect(checkoutOutcome(new ApiError(422, 'BUSINESS_RULE', 'x', undefined, { rule: 'RG-ABO-01' })).kind).toBe('other');
    expect(checkoutOutcome(new Error('x')).kind).toBe('other');
  });
});

describe('Abonnements : moyens de paiement du pack', () => {
  it('affiche les moyens renvoyes par /plans (pack CM)', async () => {
    await openCheckout();
    expect(screen.getByRole('radio', { name: /Orange Money/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /MTN MoMo/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Numéro Orange Money')).toBeInTheDocument();
    expect(screen.getByText(/Paiement par Orange Money, MTN MoMo\./)).toBeInTheDocument();
  });

  it('suit un autre pack : libelles et codes viennent de /plans', async () => {
    setTransport(withMethods([{ code: 'wave', label: 'Wave' }]));
    await openCheckout();
    expect(await screen.findByRole('radio', { name: /Wave/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Orange Money/ })).toBeNull();
    expect(screen.getByLabelText('Numéro Wave')).toBeInTheDocument();
  });
});

describe('Abonnements : erreurs de paiement', () => {
  it('PAY-INIT : message de refus, focus, on peut reessayer', async () => {
    await openCheckout();
    await userEvent.clear(screen.getByLabelText(/Numéro/));
    await userEvent.type(screen.getByLabelText(/Numéro/), '690000097');
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Paiement refusé');
    expect(alert).toHaveTextContent('Aucun montant');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });

  it('PAY-PENDING : suit le paiement, un seul POST, pas de bouton Reessayer', async () => {
    let calls = 0;
    let polls = 0;
    setTransport(async (method, url, init) => {
      if (url.includes('/subscriptions/checkout')) {
        calls++;
        return json(422, { error: { code: 'BUSINESS_RULE', message: 'inconnu', details: { rule: 'PAY-PENDING', payment_id: 'pay-1', status: 'en_attente' } } });
      }
      if (url.includes('/payments/pay-1')) {
        polls++;
        return json(200, { id: 'pay-1', status: 'en_attente' });
      }
      return mockTransport(method, url, init);
    });
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText(/Paiement en cours de vérification/)).toBeInTheDocument();
    await waitFor(() => expect(polls).toBeGreaterThan(0));
    expect(calls).toBe(1);
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
  });

  it('PAY-PENDING puis confirme : annonce la confirmation', async () => {
    setTransport(async (method, url, init) => {
      if (url.includes('/subscriptions/checkout')) return json(422, { error: { code: 'BUSINESS_RULE', message: 'inconnu', details: { rule: 'PAY-PENDING', payment_id: 'pay-2' } } });
      if (url.includes('/payments/pay-2')) return json(200, { id: 'pay-2', status: 'confirme' });
      return mockTransport(method, url, init);
    });
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText('Paiement confirmé.')).toBeInTheDocument();
    expect(screen.queryByText(/Paiement en cours de vérification/)).toBeNull();
  });

  it("PAY-PENDING puis echoue : le bouton Reessayer revient", async () => {
    setTransport(async (method, url, init) => {
      if (url.includes('/subscriptions/checkout')) return json(422, { error: { code: 'BUSINESS_RULE', message: 'inconnu', details: { rule: 'PAY-PENDING', payment_id: 'pay-4' } } });
      if (url.includes('/payments/pay-4')) return json(200, { id: 'pay-4', status: 'echoue' });
      return mockTransport(method, url, init);
    });
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText('Paiement refusé.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it("desactive le bouton pendant l'envoi (un seul POST)", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setTransport(async (method, url, init) => {
      if (url.includes('/subscriptions/checkout')) {
        calls++;
        await gate;
        return json(201, { payment_id: 'pay-3', status: 'initie', ussd_push: true });
      }
      if (url.includes('/payments/pay-3')) return json(200, { id: 'pay-3', status: 'en_attente' });
      return mockTransport(method, url, init);
    });
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    const busy = await screen.findByRole('button', { name: /Envoi de la demande/ });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    release();
    await screen.findByText(/Validez sur votre téléphone/);
    expect(calls).toBe(1);
  });
});
