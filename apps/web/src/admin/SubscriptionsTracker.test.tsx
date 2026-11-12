import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import { pollTiming } from './paymentTracker';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });
const defaults = { ...pollTiming };
let userId = '';

async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string; user: { id: string } };
  session.setTokens(j.access_token, j.refresh_token);
  userId = j.user.id;
}
const storeKey = () => `rf.payment.v1.${userId}`;

function backend(opts: { checkout?: (n: number) => Response; status?: () => string | Response }) {
  const bodies: Record<string, unknown>[] = [];
  let polls = 0;
  const transport: Transport = async (method, url, init) => {
    if (url.includes('/subscriptions/checkout')) {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return (opts.checkout ?? (() => created()))(bodies.length);
    }
    const m = /\/payments\/([\w-]+)$/.exec(url);
    if (m) {
      polls++;
      const s = (opts.status ?? (() => 'en_attente'))();
      return typeof s === 'string' ? json(200, { id: m[1], status: s }) : s;
    }
    return mockTransport(method, url, init);
  };
  return { bodies, transport, polls: () => polls };
}

const openRenew = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
  await screen.findByRole('dialog');
};
/** Le bouton du pied de fenetre (la croix porte aussi le nom « Fermer »). */
const footerClose = () => screen.getAllByRole('button', { name: 'Fermer' }).pop()!;
const pay = async () => {
  await openRenew();
  await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
};

beforeEach(async () => {
  setTransport(mockTransport);
  await login();
});
afterEach(() => {
  Object.assign(pollTiming, defaults);
  setTransport(null);
  session.clear();
});

describe('B1 : a_verifier et remboursement_en_cours gardent le paiement, sa cle et l\'ecran', () => {
  for (const st of ['a_verifier', 'remboursement_en_cours']) {
    it(`${st} : Fermer puis rouvrir ne propose pas Payer et n'envoie pas de 2e POST`, async () => {
      pollTiming.slowMs = 150;
      const b = backend({ status: () => st });
      setTransport(b.transport);
      renderApp(<Subscriptions />);
      await pay();
      await screen.findByText(st === 'a_verifier' ? /Paiement en cours de vérification/ : /remboursement de ce paiement est en cours/);
      await userEvent.click(footerClose());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await openRenew();
      expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
      expect(screen.getByText(st === 'a_verifier' ? /Paiement en cours de vérification/ : /remboursement de ce paiement est en cours/)).toBeInTheDocument();
      expect(b.bodies).toHaveLength(1);
      // le suivi continue (lent) fenetre fermee
      const before = b.polls();
      await waitFor(() => expect(b.polls()).toBeGreaterThan(before), { timeout: 2000 });
    });
  }

  it('a_verifier puis confirme plus tard : annonce et retour a zero', async () => {
    pollTiming.slowMs = 120;
    let st = 'a_verifier';
    const b = backend({ status: () => st });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await screen.findByText(/Paiement en cours de vérification/);
    await userEvent.click(footerClose());
    st = 'confirme';
    expect(await screen.findByText('Paiement reçu. Formule Structure activée.', undefined, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(storeKey())).toBeNull());
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });
});

describe('A1 : rechargement et navigation', () => {
  it('la tentative est gardee par compte tant que l\'issue est ouverte, et effacee a la confirmation', async () => {
    const b = backend({ status: () => 'en_attente' });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await screen.findByText(/Validez sur votre téléphone/);
    const saved = JSON.parse(localStorage.getItem(storeKey()) ?? 'null') as { id: string; paymentId: string; planName: string; body: { plan: string; period: string }; amount: { amount_minor: number; currency: string } };
    expect(saved).toMatchObject({ paymentId: 'pay-1', planName: 'Structure', body: { plan: 'structure', period: 'monthly' } });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.amount.currency).toBeTruthy();
  });

  it('rechargement simule (demontage puis remontage) : suivi repris, un seul POST, pas de Payer', async () => {
    pollTiming.intervalMs = 100;
    let st = 'en_attente';
    const b = backend({ status: () => st });
    setTransport(b.transport);
    const first = renderApp(<Subscriptions />);
    await pay();
    await screen.findByText(/Validez sur votre téléphone/);
    first.unmount();
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(await screen.findByText(/Validez sur votre téléphone/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(b.bodies).toHaveLength(1);
    st = 'confirme';
    expect(await screen.findByText('Paiement confirmé.', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(localStorage.getItem(storeKey())).toBeNull();
  });

  it('rechargement pendant l\'envoi (issue inconnue) : seul Reessayer, avec le meme id', async () => {
    const id = '5d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f';
    const body = { account_type: 'organisation', account_id: 'o-1', plan: 'structure', period: 'monthly', method: 'orange_money', phone: '+237690000002' };
    localStorage.setItem(storeKey(), JSON.stringify({ id, body, planName: 'Structure', amount: { amount_minor: 15000, currency: 'XAF' }, paymentId: null, unsent: false, unknown: false, existing: false }));
    const b = backend({ checkout: () => created('pay-9') });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toEqual([{ id, ...body }]);
  });

  it('stockage corrompu ou illisible : on repart sans suivi, sans erreur', async () => {
    localStorage.setItem(storeKey(), '{pas du json');
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });

  it('autre page de la console : la confirmation est annoncee sans la page Abonnements', async () => {
    const body = { account_type: 'organisation', account_id: 'o-1', plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000002' };
    localStorage.setItem(storeKey(), JSON.stringify({ id: '5d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f', body, planName: 'Pro', amount: null, paymentId: 'pay-7', unsent: false, unknown: false, existing: false }));
    setTransport(backend({ status: () => 'confirme' }).transport);
    renderApp(<p>Une autre page</p>);
    expect(await screen.findByText('Paiement reçu. Formule Pro activée.')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(storeKey())).toBeNull());
  });

  it('autre page : un echec est annonce aussi', async () => {
    const body = { account_type: 'user', account_id: 'u', plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000002' };
    localStorage.setItem(storeKey(), JSON.stringify({ id: '5d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f', body, planName: 'Pro', amount: null, paymentId: 'pay-8', unsent: false, unknown: false, existing: false }));
    setTransport(backend({ status: () => 'echoue' }).transport);
    renderApp(<p>Une autre page</p>);
    expect(await screen.findByText('Paiement refusé.')).toBeInTheDocument();
  });
});

describe('A3 : la formule de l\'annonce est celle du paiement envoye', () => {
  it('ecran USSD et toast parlent de la formule payee, meme si l\'eleveur regarde une autre formule ou periode', async () => {
    pollTiming.intervalMs = 120;
    let st = 'en_attente';
    const b = backend({ status: () => st });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText(/Confirmez le paiement de 15.000.FCFA/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuer en arrière-plan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /Annuel/ }));
    st = 'confirme';
    expect(await screen.findByText('Paiement reçu. Formule Structure activée.', undefined, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe('A4 : suivi sans fin', () => {
  for (const code of [404, 403]) {
    it(`${code} sur le paiement : le suivi s'arrete et le dit`, async () => {
      pollTiming.intervalMs = 80;
      const b = backend({ status: () => json(code, { error: { code: code === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: 'x' } }) });
      setTransport(b.transport);
      renderApp(<Subscriptions />);
      await pay();
      expect(await screen.findByText('Paiement introuvable, contactez le support.')).toBeInTheDocument();
      const n = b.polls();
      await new Promise((r) => setTimeout(r, 400));
      expect(b.polls()).toBe(n);
      await userEvent.click(footerClose());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(localStorage.getItem(storeKey())).toBeNull();
    });
  }
});

describe('PAY-OPEN : un paiement de cette formule est deja ouvert', () => {
  const open = (status = 'en_attente') => json(409, { error: { code: 'CONFLICT', message: 'ouvert', details: { rule: 'PAY-OPEN', payment_id: 'pay-open', status } } });

  it('affiche le paiement ouvert, le suit, ne propose pas Payer', async () => {
    const b = backend({ checkout: () => open(), status: () => 'en_attente' });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText(/Un paiement de cette formule est déjà en cours/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await waitFor(() => expect(b.polls()).toBeGreaterThan(0));
    expect(b.bodies).toHaveLength(1);
  });

  it('le paiement ouvert se confirme : annonce avec la formule choisie', async () => {
    const b = backend({ checkout: () => open(), status: () => 'confirme' });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText('Paiement confirmé.')).toBeInTheDocument();
    expect(await screen.findByText('Paiement reçu. Formule Structure activée.')).toBeInTheDocument();
  });

  it('PAY-OPEN sans payment_id exploitable : erreur ordinaire, pas de suivi', async () => {
    const b = backend({ checkout: () => json(409, { error: { code: 'CONFLICT', message: 'ouvert', details: { rule: 'PAY-OPEN' } } }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled());
    expect(b.polls()).toBe(0);
  });
});
