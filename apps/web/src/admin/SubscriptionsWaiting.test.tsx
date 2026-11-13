import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Subscriptions, { pollTiming } from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });
const defaults = { ...pollTiming };

async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string };
  session.setTokens(j.access_token, j.refresh_token);
}

async function openCheckout() {
  await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
  await screen.findByRole('dialog');
}

function recorder(answer: (n: number) => Response, status: () => string) {
  const bodies: Record<string, unknown>[] = [];
  let polls = 0;
  const transport: Transport = async (method, url, init) => {
    if (url.includes('/subscriptions/checkout')) {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return answer(bodies.length);
    }
    if (/\/payments\/[\w-]+$/.test(url)) {
      polls++;
      return json(200, { id: 'pay-1', status: status() });
    }
    return mockTransport(method, url, init);
  };
  return { bodies, transport, polls: () => polls };
}

beforeEach(async () => {
  setTransport(mockTransport);
  await login();
});
afterEach(() => {
  Object.assign(pollTiming, defaults);
  setTransport(null);
  session.clear();
});

describe('EF-ABO-01 : attente sans issue, jamais de second paiement', () => {
  it('delai depasse en en_attente : ni Reessayer ni Payer, message « ne payez pas deux fois », un seul POST', async () => {
    pollTiming.maxMs = 1500;
    const r = recorder(() => created(), () => 'en_attente');
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText(/Pas de réponse après 2 minutes/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Ne payez pas une deuxième fois/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(screen.queryByText(/relancez le paiement/i)).toBeNull();
    expect(r.bodies).toHaveLength(1);
  });

  it('le suivi continue apres le delai : une validation tardive est vue', async () => {
    pollTiming.maxMs = 1000;
    pollTiming.intervalMs = 150;
    pollTiming.slowMs = 150;
    let status = 'en_attente';
    const r = recorder(() => created(), () => status);
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Pas de réponse après 2 minutes/, undefined, { timeout: 5000 });
    status = 'confirme';
    expect(await screen.findByText('Paiement confirmé.', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(r.bodies).toHaveLength(1);
  });

  it('« Continuer en arriere-plan » ne coupe pas le suivi : la confirmation est annoncee fenetre fermee', async () => {
    pollTiming.intervalMs = 150;
    let status = 'en_attente';
    const r = recorder(() => created(), () => status);
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continuer en arrière-plan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const before = r.polls();
    await waitFor(() => expect(r.polls()).toBeGreaterThan(before));
    status = 'confirme';
    expect(await screen.findByText(/Paiement reçu\. Formule/, undefined, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe('EF-ABO-01 : fermeture de la fenetre apres une issue tranchee', () => {
  it('confirme puis Terminer : la reouverture repart de zero (formulaire, pas de faux « confirme »)', async () => {
    const r = recorder(() => created(), () => 'confirme');
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Terminer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openCheckout();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
    expect(screen.queryByText('Paiement confirmé.')).toBeNull();
  });

  it('refus (PAY-INIT) puis fermeture : plus d\'alerte, et le nouvel essai prend un nouvel id', async () => {
    const r = recorder((n) => (n === 1 ? json(422, { error: { code: 'BUSINESS_RULE', message: 'refus', details: { rule: 'PAY-INIT', payment_id: 'p' } } }) : created()), () => 'en_attente');
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Paiement refusé/);
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openCheckout();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies[1].id).not.toBe(r.bodies[0].id);
  });

  it('issue inconnue (PAY-PENDING) puis fermeture : le paiement reste suivi, avec sa cle', async () => {
    const r = recorder(() => json(422, { error: { code: 'BUSINESS_RULE', message: 'inconnu', details: { rule: 'PAY-PENDING', payment_id: 'pay-1', status: 'en_attente' } } }), () => 'en_attente');
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continuer en arrière-plan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openCheckout();
    expect(screen.getByText(/Paiement en cours de vérification/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(r.bodies).toHaveLength(1);
  });
});
