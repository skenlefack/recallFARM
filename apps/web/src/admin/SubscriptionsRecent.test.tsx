import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { checkoutOutcome } from '../lib/payment';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });
const retry409 = () => json(409, { error: { code: 'CONFLICT', message: 'Message brut du serveur', details: { rule: 'PAY-RETRY' } } });
const recent409 = (paidAt: string, plan = 'pro', paymentId = 'pay-recent') => json(409, { error: { code: 'CONFLICT', message: 'Vous avez déjà payé la formule pro il y a 3 min. Confirmez pour payer encore.', details: { rule: 'PAY-RECENT', payment_id: paymentId, plan, paid_at: paidAt } } });
const planButtons = () => screen.getAllByRole('button', { name: /^(Passer à|Choisir|Renouveler)/ });

async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string };
  session.setTokens(j.access_token, j.refresh_token);
}

/** Transport de test : checkout programmable, abonnement programmable (n = numero de l'appel a /subscriptions/current). */
function backend(opts: { checkout?: (n: number) => Response; sub?: (n: number, real: () => Promise<Response>) => Promise<Response> | Response; plans?: (body: Record<string, unknown>) => Record<string, unknown> }) {
  const bodies: Record<string, unknown>[] = [];
  const subUrls: string[] = [];
  let subCalls = 0;
  const transport: Transport = async (method, url, init) => {
    if (url.includes('/subscriptions/checkout')) {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return (opts.checkout ?? (() => created()))(bodies.length);
    }
    if (url.includes('/subscriptions/current')) {
      subUrls.push(url);
      subCalls++;
      return opts.sub ? opts.sub(subCalls, () => mockTransport(method, url, init)) : mockTransport(method, url, init);
    }
    if (opts.plans && url.includes('/plans')) {
      const real = (await (await mockTransport(method, url, init)).json()) as Record<string, unknown>;
      return json(200, opts.plans(real));
    }
    const m = /\/payments\/([\w-]+)$/.exec(url);
    if (m) return json(200, { id: m[1], status: 'en_attente' });
    return mockTransport(method, url, init);
  };
  return { bodies, subUrls, subCalls: () => subCalls, transport };
}

/** Fenetre de paiement ouverte et « Payer » actif (l'abonnement est charge). */
async function pay() {
  await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
  await screen.findByRole('dialog');
  const btn = await screen.findByRole('button', { name: 'Payer' });
  await waitFor(() => expect(btn).toBeEnabled());
  await userEvent.click(btn);
}
const subLoaded = async () => {
  await screen.findByText('Formule actuelle');
  await screen.findByText('Active');
};

beforeEach(async () => {
  setTransport(mockTransport);
  await login();
});
afterEach(() => {
  setTransport(null);
  session.clear();
  sessionStorage.clear();
});

describe('B-1 : Payer ne revient jamais sans abonnement recharge', () => {
  it('PAY-RETRY puis abonnement en echec : « Verification impossible », Payer reste desactive ; « Reessayer la verification » le debloque', async () => {
    const b = backend({ checkout: () => retry409(), sub: (n, real) => (n === 2 ? json(500, { error: { code: 'SERVER_ERROR', message: 'panne' } }) : real()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Un autre paiement de ce compte vient de se terminer. Vérifiez votre formule avant de payer de nouveau.')).toBeInTheDocument();
    expect(await screen.findByText(/Vérification impossible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeDisabled(); // jamais actif tant que l'abonnement n'est pas revenu
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer la vérification' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled());
    expect(screen.queryByText(/Vérification impossible/)).toBeNull();
  });

  it('rechargement de la page pendant la verification : tous les boutons de formule restent desactives jusqu\'au retour de l\'abonnement', async () => {
    let release: () => void = () => undefined;
    const b = backend({ sub: (_n, real) => new Promise<Response>((r) => (release = () => void real().then(r))) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await screen.findByRole('heading', { name: /Changer de formule/ });
    await screen.findAllByRole('button', { name: /^(Passer à|Choisir)/ });
    for (const btn of planButtons()) expect(btn).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: /Renouveler/ })).toBeEnabled());
  });

  it('S-5 : abonnement change : on l\'annonce, et Payer reste bloque pendant la verification', async () => {
    let release: () => void = () => undefined;
    const b = backend({
      checkout: () => retry409(),
      sub: (n, real) => (n === 1 ? real() : new Promise<Response>((r) => (release = () => r(json(200, { plan: 'pro', period: 'monthly', status: 'active', expires_at: '2028-01-01T00:00:00Z' }))))),
    });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByRole('button', { name: /Vérification de votre formule/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    release();
    expect(await screen.findByText(/Votre formule a changé depuis l’envoi du paiement \(formule Pro active\)/)).toBeInTheDocument();
  });
});

describe('A-1 : le resultat de la verification appartient a son compte', () => {
  it('deconnexion pendant la verification : aucun toast apres coup', async () => {
    let release: () => void = () => undefined;
    const b = backend({ checkout: () => retry409(), sub: (n, real) => (n === 1 ? real() : new Promise<Response>((r) => (release = () => void real().then(r)))) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByRole('button', { name: /Vérification de votre formule/ });
    session.clear('logout');
    await new Promise((r) => setTimeout(r, 150));
    release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/Vérifiez votre formule actuelle/)).toBeNull();
    expect(screen.queryByText(/Votre formule a changé/)).toBeNull();
  });

  it('un autre compte se connecte pendant la verification : le resultat du premier est ignore', async () => {
    let release: () => void = () => undefined;
    const b = backend({ checkout: () => retry409(), sub: (n, real) => (n === 1 ? real() : new Promise<Response>((r) => (release = () => void real().then(r)))) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByRole('button', { name: /Vérification de votre formule/ });
    session.clear('logout');
    const other = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000001', code: '123456' }) });
    const tok = (await other.json()) as { access_token: string; refresh_token: string };
    session.setTokens(tok.access_token, tok.refresh_token, 'login');
    await new Promise((r) => setTimeout(r, 300));
    release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/Vérifiez votre formule actuelle/)).toBeNull();
  });
});

describe('S-6 : l\'abonnement du payeur actif est demande explicitement', () => {
  it('GET /subscriptions/current porte account_type et account_id', async () => {
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    expect(b.subUrls.length).toBeGreaterThan(0);
    for (const u of b.subUrls) {
      expect(u).toContain('account_type=organisation');
      expect(u).toMatch(/account_id=[\w-]+/);
    }
  });
});

describe('PAY-RECENT : un paiement de ce compte vient d\'etre confirme', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();

  it('409 PAY-RECENT : ecran dedie, abonnement recharge, AUCUN POST automatique, texte du serveur jamais affiche', async () => {
    const b = backend({ checkout: () => recent409(recentAt()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    const callsBefore = b.subCalls();
    await pay();
    expect(await screen.findByText('Vous venez de payer la formule Pro il y a 3 min.')).toBeInTheDocument();
    expect(screen.getByText(/Paiement confirmé à \d{2}:\d{2}\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Garder ma formule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer quand même' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(screen.queryByText(/Confirmez pour payer encore/)).toBeNull();
    await new Promise((r) => setTimeout(r, 400));
    expect(b.bodies).toHaveLength(1);
    await waitFor(() => expect(b.subCalls()).toBeGreaterThan(callsBefore));
  });

  it('« Payer quand meme » : un seul POST de plus, meme id, meme corps, confirm_repeat = payment_id du paiement recent', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : created('pay-2')) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.click(screen.getByRole('button', { name: 'Payer quand même' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(2);
    expect(b.bodies[0]).not.toHaveProperty('confirm_repeat');
    expect(b.bodies[1]).toEqual({ ...b.bodies[0], confirm_repeat: 'pay-recent' });
    expect(b.bodies[1].id).toBe(b.bodies[0].id);
  });

  it('second PAY-RECENT avec un AUTRE paiement : l\'ecran se reaffiche avec le nouveau paiement, jamais de renvoi automatique, la nouvelle confirmation porte le nouvel id', async () => {
    const b = backend({
      checkout: (n) => (n === 1 ? recent409(recentAt(), 'pro', 'pay-recent') : n === 2 ? recent409(new Date(Date.now() - 60_000).toISOString(), 'structure', 'pay-recent-2') : created('pay-3')),
    });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText('Vous venez de payer la formule Pro il y a 3 min.');
    await userEvent.click(screen.getByRole('button', { name: 'Payer quand même' }));
    // un autre paiement a ete confirme entre-temps : nouvel ecran, nouveau paiement
    expect(await screen.findByText('Vous venez de payer la formule Structure il y a 1 min.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(b.bodies).toHaveLength(2); // pas de 3e envoi automatique
    expect(b.bodies[1]).toMatchObject({ confirm_repeat: 'pay-recent' });
    await userEvent.click(screen.getByRole('button', { name: 'Payer quand même' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(3);
    expect(b.bodies[2]).toEqual({ ...b.bodies[0], confirm_repeat: 'pay-recent-2' });
    expect(new Set(b.bodies.map((x) => x.id)).size).toBe(1);
  });

  it('« Garder ma formule » : rien n\'est envoye, la fenetre se ferme, on repart de zero', async () => {
    const b = backend({ checkout: () => recent409(recentAt()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await userEvent.click(await screen.findByRole('button', { name: 'Garder ma formule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(b.bodies).toHaveLength(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('rf.payment.v1.'))).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
    const btn = await screen.findByRole('button', { name: 'Payer' });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('l\'heure s\'affiche dans le fuseau du pays quand l\'API le donne', async () => {
    const b = backend({ checkout: () => recent409('2026-11-12T10:30:00Z'), plans: (p) => ({ ...p, timezone: 'Asia/Tokyo' }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText(/Paiement confirmé à 19:30\./)).toBeInTheDocument();
  });

  it('fuseau inconnu : heure de l\'appareil, sans planter', async () => {
    const b = backend({ checkout: () => recent409('2026-11-12T10:30:00Z'), plans: (p) => ({ ...p, timezone: 'Mars/Olympus' }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText(/Paiement confirmé à \d{2}:\d{2}\./)).toBeInTheDocument();
  });

  it('checkoutOutcome : forme exigee (payment_id et paid_at valides)', () => {
    const err = (details: Record<string, unknown>) => new ApiError(409, 'CONFLICT', 'x', undefined, details);
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', payment_id: 'p', plan: 'pro', paid_at: '2026-11-12T10:30:00Z' }))).toEqual({ kind: 'recent', paymentId: 'p', plan: 'pro', paidAt: '2026-11-12T10:30:00Z' });
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', payment_id: 'p', paid_at: 'pas une date' })).kind).toBe('other');
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', paid_at: '2026-11-12T10:30:00Z' })).kind).toBe('other');
  });

  it('le mock repond comme le serveur : 409 PAY-RECENT, puis accepte confirm_repeat = id du paiement recent', async () => {
    const body = { id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e61', account_type: 'user', account_id: 'u', plan: 'pro', period: 'monthly', method: 'orange_money', phone: '+237690000011' };
    const tok = ((await (await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000003', code: '123456' }) })).json()) as { access_token: string }).access_token;
    const post = (b: object) => mockTransport('POST', '/v1/subscriptions/checkout', { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(b) });
    const first = (await (await post(body)).json()) as { payment_id: string };
    // le paiement est confirme (suivi simule : ~6 s) : on force l'instant en lisant apres le delai du simulateur
    await new Promise((r) => setTimeout(r, 6200));
    const polled = await mockTransport('GET', `/v1/payments/${first.payment_id}`, { headers: { Authorization: `Bearer ${tok}` } });
    expect(((await polled.json()) as { status: string }).status).toBe('confirme');
    const again = await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { details: { rule: string } } }).error.details.rule).toBe('PAY-RECENT');
    // confirm_repeat doit etre l'id du paiement recent : un booleen ou un autre id ne suffit pas
    expect((await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62', confirm_repeat: true })).status).toBe(409);
    expect((await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62', confirm_repeat: first.payment_id })).status).toBe(200);
  }, 15000);
});
