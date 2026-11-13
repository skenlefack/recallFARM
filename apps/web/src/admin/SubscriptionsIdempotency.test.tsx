import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/** Transport qui enregistre les corps de POST /subscriptions/checkout et laisse un scenario repondre. */
function recorder(answer: (n: number, body: Record<string, unknown>) => Response | Promise<Response>, status: (id: string) => string = () => 'en_attente') {
  const bodies: Record<string, unknown>[] = [];
  const transport: Transport = async (method, url, init) => {
    if (url.includes('/subscriptions/checkout')) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return answer(bodies.length, body);
    }
    const m = /\/payments\/([\w-]+)$/.exec(url);
    if (m) return json(200, { id: m[1], status: status(m[1]) });
    return mockTransport(method, url, init);
  };
  return { bodies, transport };
}

const refusal = () => json(422, { error: { code: 'BUSINESS_RULE', message: 'refus', details: { rule: 'PAY-INIT', payment_id: 'p-x' } } });
const unknown = (id = 'pay-u') => json(422, { error: { code: 'BUSINESS_RULE', message: 'inconnu', details: { rule: 'PAY-PENDING', payment_id: id, status: 'en_attente' } } });
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });

beforeEach(async () => {
  setTransport(mockTransport);
  await login();
});
afterEach(() => {
  setTransport(null);
  session.clear();
});

describe("EF-ABO-01 : cle d'idempotence du checkout (POST idempotent)", () => {
  it('envoie un id UUID v4 cree par le client', async () => {
    const r = recorder(() => created());
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].id).toMatch(UUID_V4);
  });

  it('PAY-PENDING : un seul envoi, pas de bouton Payer', async () => {
    const r = recorder(() => unknown());
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Paiement en cours de vérification/);
    expect(r.bodies).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
  });

  it('erreur reseau : seul « Reessayer » est offert, avec le meme id et le meme corps (aucun double prelevement)', async () => {
    const r = recorder((n) => {
      if (n === 1) throw new TypeError('network');
      return json(201, { payment_id: 'pay-1', status: 'initie', ussd_push: true, replayed: true });
    });
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText(/La demande n’a pas reçu de réponse/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[1]).toEqual(r.bodies[0]);
  });

  it('PAY-INIT : refus explicite, la relance prend un NOUVEL id (le serveur rejouerait le meme refus)', async () => {
    const r = recorder((n) => (n === 1 ? refusal() : created('pay-2')));
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Paiement refusé/);
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[1].id).toMatch(UUID_V4);
    expect(r.bodies[1].id).not.toBe(r.bodies[0].id);
  });

  it('A2 : apres une erreur reseau, aucun nouveau checkout (autre formule, autre periode) : pas de Payer, Reessayer = meme id', async () => {
    const r = recorder((n) => {
      if (n === 1) throw new TypeError('network');
      return created();
    });
    setTransport(r.transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Payer' }));
    await screen.findByText(/La demande n’a pas reçu de réponse/);
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /Annuel/ }));
    await userEvent.click(screen.getAllByRole('button', { name: /^(Passer à|Choisir) / })[0]);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[1]).toEqual(r.bodies[0]);
  });

  it('erreur de validation (422) : rien n\'a ete cree, le formulaire reste utilisable avec une nouvelle cle', async () => {
    const r = recorder((n) => (n === 1 ? json(422, { error: { code: 'VALIDATION_ERROR', message: 'invalide', fields: { phone: 'format invalide' } } }) : created()));
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText('Ce numéro n’est pas valide. Vérifiez-le puis réessayez.');
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies[1].id).not.toBe(r.bodies[0].id);
  });

  it('409 PAY-IDEMPOTENCY : message clair, nouvel id au prochain essai', async () => {
    const r = recorder((n) => (n === 1 ? json(409, { error: { code: 'CONFLICT', message: 'deja utilise', details: { rule: 'PAY-IDEMPOTENCY' } } }) : created()));
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà été envoyée');
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(r.bodies[1].id).not.toBe(r.bodies[0].id);
  });

  it('le mock repond comme le contrat : meme id rejoue, id invalide refuse (422)', async () => {
    const body = { id: '8d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f', account_type: 'user', account_id: 'u-1', plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000011' };
    const post = (b: object) => mockTransport('POST', '/v1/subscriptions/checkout', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify(b) });
    const first = (await (await post(body)).json()) as { payment_id: string };
    const again = (await (await post(body)).json()) as { payment_id: string; replayed?: boolean };
    expect(again.payment_id).toBe(first.payment_id);
    expect(again.replayed).toBe(true);
    expect((await post({ ...body, phone: '+237690000012' })).status).toBe(409);
    expect((await post({ ...body, id: 'pas-un-uuid' })).status).toBe(422);
  });
});

describe('EF-ABO-01 : nouveaux statuts de paiement', () => {
  it("a_verifier : « en cours de verification », on previent, plus d'interrogation ni de relance", async () => {
    let polls = 0;
    const r = recorder(
      () => created('pay-v'),
      () => {
        polls++;
        return 'a_verifier';
      },
    );
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText(/Paiement en cours de vérification/)).toBeInTheDocument();
    expect(screen.getByText(/Nous vous prévenons/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(polls).toBe(1);
  });

  it('remboursement_en_cours : message sobre, pas de relance', async () => {
    const r = recorder(() => created('pay-r'), () => 'remboursement_en_cours');
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText('Un remboursement de ce paiement est en cours.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });

  it('rembourse : annonce le remboursement', async () => {
    const r = recorder(() => created('pay-r'), () => 'rembourse');
    setTransport(r.transport);
    await openCheckout();
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    expect(await screen.findByText('Ce paiement a été remboursé.')).toBeInTheDocument();
  });
});

describe("RG montants : devise venant de l'API, jamais en dur", () => {
  it('affiche la devise de /plans avec ses decimales (Intl), sans FCFA', async () => {
    setTransport(async (method, url, init) => {
      const real = await mockTransport(method, url, init);
      if (!url.includes('/plans')) return real;
      const body = (await real.json()) as { data: { price?: { monthly: { amount_minor: number; currency: string }; yearly: { amount_minor: number; currency: string } } | null }[] };
      const swap = (m: { amount_minor: number }) => ({ amount_minor: m.amount_minor, currency: 'EUR' });
      body.data.forEach((p) => {
        if (p.price) p.price = { ...p.price, monthly: swap(p.price.monthly), yearly: swap(p.price.yearly) };
      });
      return json(200, { ...body, currency: 'EUR' });
    });
    renderApp(<Subscriptions />);
    // 2500 unites mineures EUR = 25,00 EUR (exposant 2 fourni par Intl, pas par le code)
    expect(await screen.findByText(/25,00.€/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/FCFA/);
  });

  it('tarif inconnu : texte visible, jamais un prix invente', async () => {
    setTransport(async (method, url, init) => {
      if (url.includes('/plans')) return json(200, { data: [{ code: 'pro', name: 'Pro', features: [], quotas: { farms: 3, cameras: 2, sms_per_month: 60 } }], payment_methods: [] });
      return mockTransport(method, url, init);
    });
    renderApp(<Subscriptions />);
    await screen.findByRole('heading', { name: /Pro/ });
    expect(screen.getByText('Tarif indisponible pour le moment')).toBeVisible();
  });
});
