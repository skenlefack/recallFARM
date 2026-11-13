import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { checkoutOutcome } from '../lib/payment';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PID1 = '11111111-1111-4111-8111-111111111111';
const PID2 = '22222222-2222-4222-8222-222222222222';
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });
const retry409 = () => json(409, { error: { code: 'CONFLICT', message: 'Message brut du serveur', details: { rule: 'PAY-RETRY' } } });
const recent409 = (paidAt: string, plan: string | null = 'pro', paymentId = PID1, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ error: { code: 'CONFLICT', message: 'Vous avez déjà payé la formule pro il y a 3 min. Confirmez pour payer encore.', details: { rule: 'PAY-RECENT', payment_id: paymentId, ...(plan ? { plan } : {}), paid_at: paidAt } } }),
    { status: 409, headers: { 'Content-Type': 'application/json', ...headers } },
  );
const planButtons = () => screen.getAllByRole('button', { name: /^(Passer à|Choisir|Renouveler)/ });

let userId = '';
let payerId = '';
async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string; user: { id: string } };
  session.setTokens(j.access_token, j.refresh_token);
  userId = j.user.id;
  const me = (await (await mockTransport('GET', '/v1/me', { headers: { Authorization: `Bearer ${j.access_token}` } })).json()) as { memberships: { organisation_id: string }[] };
  payerId = me.memberships[0]?.organisation_id ?? userId;
}
const storeKey = () => `rf.payment.v1.${userId}.${payerId}`;
const bodyKey = () => `rf.payment.body.v1.${userId}.${payerId}`;
const BODY = { account_type: 'organisation', account_id: 'org-1', plan: 'structure', period: 'monthly', method: 'orange_money', phone: '+237690000002' };
const ID = '5d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f';
function seed(over: Record<string, unknown> = {}) {
  const a = { id: ID, ownerId: userId, subSnap: null, subKnown: false, recent: null, paymentId: null, plan: 'structure', planName: 'Structure', period: 'monthly', method: 'orange_money', amount: null, sentAt: Date.now(), unsent: false, unknown: false, existing: false, phoneMasked: '••••••02', ...over };
  localStorage.setItem(storeKey(), JSON.stringify(a));
  sessionStorage.setItem(bodyKey(), JSON.stringify({ id: ID, body: BODY }));
  return a;
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
/** Bouton de l'ecran « paiement recent » : arme ~500 ms apres l'affichage (un double clic ne tombe jamais sur l'autre bouton). */
const armed = async (name: string) => {
  const btn = await screen.findByRole('button', { name });
  await waitFor(() => expect(btn).toBeEnabled(), { timeout: 2000 });
  return btn;
};
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
    await armed('Payer quand même');
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
    await userEvent.click(await armed('Payer quand même'));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(2);
    expect(b.bodies[0]).not.toHaveProperty('confirm_repeat');
    expect(b.bodies[1]).toEqual({ ...b.bodies[0], confirm_repeat: PID1 });
    expect(b.bodies[1].id).toBe(b.bodies[0].id);
  });

  it('second PAY-RECENT avec un AUTRE paiement : l\'ecran se reaffiche avec le nouveau paiement, jamais de renvoi automatique, la nouvelle confirmation porte le nouvel id', async () => {
    const b = backend({
      checkout: (n) => (n === 1 ? recent409(recentAt(), 'pro', PID1) : n === 2 ? recent409(new Date(Date.now() - 60_000).toISOString(), 'structure', PID2) : created('pay-3')),
    });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText('Vous venez de payer la formule Pro il y a 3 min.');
    await userEvent.click(await armed('Payer quand même'));
    // un autre paiement a ete confirme entre-temps : nouvel ecran, nouveau paiement
    expect(await screen.findByText('Vous venez de payer la formule Structure il y a 1 min.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(b.bodies).toHaveLength(2); // pas de 3e envoi automatique
    expect(b.bodies[1]).toMatchObject({ confirm_repeat: PID1 });
    await userEvent.click(await armed('Payer quand même'));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(3);
    expect(b.bodies[2]).toEqual({ ...b.bodies[0], confirm_repeat: PID2 });
    expect(new Set(b.bodies.map((x) => x.id)).size).toBe(1);
  });

  it('« Garder ma formule » : rien n\'est envoye, la fenetre se ferme, on repart de zero', async () => {
    const b = backend({ checkout: () => recent409(recentAt()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await userEvent.click(await armed('Garder ma formule'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(b.bodies).toHaveLength(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('rf.payment.v1.'))).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: /Renouveler/ }));
    const btn = await screen.findByRole('button', { name: 'Payer' });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('l\'heure s\'affiche dans le fuseau du pays quand l\'API le donne', async () => {
    const paid = new Date(Date.now() - 2 * 60_000);
    const inTokyo = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(paid);
    const b = backend({ checkout: () => recent409(paid.toISOString()), plans: (p) => ({ ...p, timezone: 'Asia/Tokyo' }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText(`Paiement confirmé à ${inTokyo}.`)).toBeInTheDocument();
  });

  it('fuseau inconnu : heure de l\'appareil, sans planter', async () => {
    const b = backend({ checkout: () => recent409(new Date(Date.now() - 2 * 60_000).toISOString()), plans: (p) => ({ ...p, timezone: 'Mars/Olympus' }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText(/Paiement confirmé à \d{2}:\d{2}\./)).toBeInTheDocument();
  });

  it('checkoutOutcome : forme exigee (payment_id et paid_at valides)', () => {
    const err = (details: Record<string, unknown>) => new ApiError(409, 'CONFLICT', 'x', undefined, details);
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', payment_id: PID1, plan: 'pro', paid_at: '2026-11-12T10:30:00Z' }))).toEqual({ kind: 'recent', paymentId: PID1, plan: 'pro', paidAt: '2026-11-12T10:30:00Z', skewMs: 0 });
    // forme invalide : jamais confirmable, etat distinct de PAY-RETRY (verifier l'abonnement, pas de Payer avant)
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', payment_id: 'p', paid_at: '2026-11-12T10:30:00Z' })).kind).toBe('malformed');
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', payment_id: PID1, paid_at: 'pas une date' })).kind).toBe('malformed');
    expect(checkoutOutcome(err({ rule: 'PAY-RECENT', paid_at: '2026-11-12T10:30:00Z' })).kind).toBe('malformed');
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
    // confirm_repeat est un UUID (422 sinon, comme @Matches cote serveur) et doit etre celui du paiement recent (409 sinon)
    expect((await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62', confirm_repeat: true })).status).toBe(422);
    expect((await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62', confirm_repeat: PID2 })).status).toBe(409);
    expect((await post({ ...body, id: '7d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e62', confirm_repeat: first.payment_id })).status).toBe(201);
  }, 15000);
});

describe('B-1 (PAY-RECENT) : « Payer quand meme » depend de l\'abonnement recharge', () => {
  it('PAY-RECENT puis 500 sur /subscriptions/current : « Payer quand meme » desactive, alerte et « Reessayer la verification »', async () => {
    const b = backend({ checkout: () => recent409(new Date(Date.now() - 3 * 60_000).toISOString()), sub: (n, real) => (n === 1 ? real() : json(500, { error: { code: 'SERVER_ERROR', message: 'panne' } })) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    expect(await screen.findByText(/Vérification impossible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer quand même' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Payer quand même' }), { pointerEventsCheck: 0 });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.bodies).toHaveLength(1);
  });
});

describe('A-1 (PAY-RECENT) : « Garder ma formule » dans un autre onglet', () => {
  it('evenement vide : l\'ecran se ferme, l\'abonnement est recharge, un toast previent, Payer reste bloque jusqu\'au retour', async () => {
    let release: () => void = () => undefined;
    const b = backend({ checkout: () => recent409(new Date(Date.now() - 3 * 60_000).toISOString()), sub: (n, real) => (n <= 2 ? real() : new Promise<Response>((r) => (release = () => void real().then(r)))) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await waitFor(() => expect(b.subCalls()).toBe(2)); // rechargement declenche par le PAY-RECENT lui-meme
    localStorage.removeItem(storeKey());
    window.dispatchEvent(new StorageEvent('storage', { key: storeKey(), newValue: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(b.subCalls()).toBe(3));
    for (const btn of planButtons()) expect(btn).toBeDisabled(); // abonnement en cours de rechargement
    release();
    expect(await screen.findByText('Vérifiez votre formule actuelle avant de payer de nouveau.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Renouveler/ })).toBeEnabled());
  });
});

describe('A-2 : confirm_repeat exige un UUID', () => {
  it('PAY-RECENT avec un payment_id qui n\'est pas un UUID : verification de l\'abonnement, jamais de « Payer quand meme » ni de Payer avant son retour', async () => {
    let release: () => void = () => undefined;
    const b = backend({
      checkout: () => recent409(new Date().toISOString(), 'pro', 'pas-un-uuid'),
      sub: (n, real) => (n === 1 ? real() : new Promise<Response>((r) => (release = () => void real().then(r)))),
    });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Réponse inattendue du serveur. Vérifiez votre formule avant de payer de nouveau.')).toBeInTheDocument();
    expect(screen.queryByText(/vient de se terminer/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer quand même' })).toBeNull();
    expect(await screen.findByRole('button', { name: /Vérification de votre formule/ })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled());
  });
});

describe('A-3 : ecran recent perime, N entier, decalage d\'horloge', () => {
  it('paiement recent plus vieux que la fenetre du serveur (30 min) : retire a la lecture, abonnement recharge', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: new Date(Date.now() - 31 * 60_000).toISOString(), skewMs: 0 } });
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Voir le paiement' })).toBeNull());
    expect(localStorage.getItem(storeKey())).toBeNull();
    expect(b.subCalls()).toBeGreaterThan(1);
  });

  it('N en partie entiere : 3 min 54 s -> « il y a 3 min »', async () => {
    setTransport(backend({ checkout: () => recent409(new Date(Date.now() - 234_000).toISOString()) }).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Vous venez de payer la formule Pro il y a 3 min.')).toBeInTheDocument();
  });

  it('moins d\'une minute : « a l\'instant »', async () => {
    setTransport(backend({ checkout: () => recent409(new Date(Date.now() - 20_000).toISOString()) }).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Vous venez de payer la formule Pro à l’instant.')).toBeInTheDocument();
  });

  it('decalage d\'horloge : l\'en-tete Date de la reponse 409 corrige l\'age (serveur en avance de 10 min -> « il y a 13 min »)', async () => {
    const paidAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const serverNow = new Date(Date.now() + 10.5 * 60_000).toUTCString(); // l'en-tete Date perd les millisecondes : marge d'une demi-minute
    setTransport(backend({ checkout: () => recent409(paidAt, 'pro', PID1, { Date: serverNow }) }).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Vous venez de payer la formule Pro il y a 13 min.')).toBeInTheDocument();
  });
});

describe('A-4 et A-5 : banniere et formule absente', () => {
  it('A-4 : banniere dediee avec la formule du paiement recent', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: new Date(Date.now() - 60_000).toISOString(), skewMs: 0 } });
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    expect(await screen.findByText('Un paiement de la formule Pro vient d’être confirmé : choisissez si vous payez encore.')).toBeInTheDocument();
  });

  it('A-5 : details.plan absent : ni formule reprise de la tentative, ni dans la banniere', async () => {
    setTransport(backend({ checkout: () => recent409(new Date(Date.now() - 3 * 60_000).toISOString(), null) }).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText('Vous venez de payer il y a 3 min.')).toBeInTheDocument();
    expect(screen.queryByText(/formule Structure/)).toBeNull();
    await userEvent.click(await armed('Garder ma formule'));
    expect(screen.queryByText(/Un paiement de la formule/)).toBeNull();
  });

  it('A-5 : banniere sans formule', async () => {
    seed({ recent: { paymentId: PID1, plan: '', paidAt: new Date(Date.now() - 60_000).toISOString(), skewMs: 0 } });
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    expect(await screen.findByText('Un paiement vient d’être confirmé : choisissez si vous payez encore.')).toBeInTheDocument();
  });
});

describe('S-1 et S-5 : Payer quand meme', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();

  it('S-1 : l\'ecran recent reste affiche pendant l\'envoi (occupe, « Envoi… »), sans clignotement', async () => {
    let release: (r: Response) => void = () => undefined;
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : (new Promise<Response>((r) => (release = r)) as unknown as Response)) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.click(await armed('Payer quand même'));
    const busy = await screen.findByRole('button', { name: 'Envoi de la demande…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Vous venez de payer la formule Pro/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Garder ma formule' })).toBeDisabled();
    release(created('pay-9'));
    await screen.findByText(/Validez sur votre téléphone/);
  });

  it('S-5 : double clic sur « Payer quand meme » : un seul POST de plus', async () => {
    let release: (r: Response) => void = () => undefined;
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : (new Promise<Response>((r) => (release = r)) as unknown as Response)) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.dblClick(await armed('Payer quand même'));
    await new Promise((r) => setTimeout(r, 100));
    release(created('pay-2'));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(2);
  });

  it('S-2 : coupure reseau apres « Payer quand meme » : Reessayer renvoie confirm_repeat, meme id, meme corps (meme onglet)', async () => {
    const b = backend({
      checkout: (n) => {
        if (n === 1) return recent409(recentAt());
        if (n === 2) throw new TypeError('network');
        return created('pay-3');
      },
    });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.click(await armed('Payer quand même'));
    expect(await screen.findByText(/La demande n’a pas reçu de réponse/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(3);
    expect(b.bodies[2]).toEqual(b.bodies[1]);
    expect(b.bodies[2]).toMatchObject({ confirm_repeat: PID1 });
    expect(new Set(b.bodies.map((x) => x.id)).size).toBe(1);
  });

  it('S-2 : apres un rechargement, le renvoi part SANS confirm_repeat (non persiste) ; PAY-RECENT du serveur reaffiche l\'ecran', async () => {
    seed({ unsent: true, sentAt: Date.now() - 10 * 60_000 });
    const b = backend({ checkout: () => recent409(new Date(Date.now() - 2 * 60_000).toISOString()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Vous venez de payer la formule Pro/)).toBeInTheDocument();
    expect(b.bodies).toHaveLength(1);
    expect(b.bodies[0]).toEqual({ id: ID, ...BODY });
    expect(b.bodies[0]).not.toHaveProperty('confirm_repeat');
  });
});

describe('S-5 : payeur utilisateur', () => {
  it('sans organisation : account_type=user et account_id = l\'identifiant exact de l\'utilisateur', async () => {
    session.clear();
    const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000001', code: '123456' }) });
    const j = (await r.json()) as { access_token: string; refresh_token: string; user: { id: string } };
    session.setTokens(j.access_token, j.refresh_token);
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await waitFor(() => expect(b.subUrls.length).toBeGreaterThan(0));
    for (const u of b.subUrls) {
      expect(u).toContain('account_type=user');
      expect(u).toContain(`account_id=${j.user.id}`);
    }
  });
});

const tooMany = (retryAfter?: string) => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Trop de requetes' } }), { status: 429, headers: { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) } });
const initRefused = () => json(422, { error: { code: 'BUSINESS_RULE', message: 'refus brut', details: { rule: 'PAY-INIT', payment_id: 'p-x' } } });
const RATE = 'Trop de demandes, patientez une minute.';
const BUSY = 'Un autre paiement de ce compte est en cours de traitement. Réessayez dans un instant.';
const storedId = () => JSON.parse(localStorage.getItem(storeKey())!).id as string;

describe('B-NEW-1 : « pas traite maintenant » n\'est jamais une issue tranchee', () => {
  it('429 puis PAY-RETRY sur « Reessayer » : meme id conserve, jamais de Payer, message dedie', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? tooMany('1') : retry409()) });
    setTransport(b.transport);
    seed({ unsent: true, sentAt: Date.now() - 10 * 60_000 });
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(new RegExp(RATE))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(storedId()).toBe(ID);
    // « Reessayer » attend la fin du delai (Retry-After : 1 s)
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDisabled();
    const again = await screen.findByRole('button', { name: 'Réessayer' });
    await waitFor(() => expect(again).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(again);
    await waitFor(() => expect(b.bodies).toHaveLength(2));
    // A3 : PAY-RETRY a son propre texte (et non « Trop de demandes »)
    expect(await screen.findByText(new RegExp(BUSY))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(RATE))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(storedId()).toBe(ID);
    expect(new Set(b.bodies.map((x) => x.id))).toEqual(new Set([ID]));
    expect(b.bodies[1]).toEqual(b.bodies[0]);
  });

  it('S-d : 429 sur le PREMIER envoi : texte dedie dans le formulaire (rien n\'est parti, Payer reste possible)', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? tooMany() : created()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    expect(await screen.findByText(RATE)).toBeInTheDocument();
    expect(screen.queryByText('La demande n’a pas pu être traitée. Réessayez dans un moment.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled());
  });
});

describe('A-NEW-1 : un echec de « Payer quand meme » ne ferme pas la fenetre en silence', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();

  it('PAY-INIT : la notice est affichee, la fenetre reste ouverte', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : initRefused()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.click(await armed('Payer quand même'));
    expect(await screen.findByText(/Paiement refusé/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/refus brut/)).toBeNull();
  });

  it('PAY-INIT depuis la banniere (sans formule a afficher) : la fenetre se ferme AVEC un message', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: recentAt(), skewMs: 0 } });
    setTransport(backend({ checkout: () => initRefused() }).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await userEvent.click(await armed('Payer quand même'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Paiement refusé/)).toBeInTheDocument();
  });

  it('429 sur « Payer quand meme » : issue inconnue, meme id, « Reessayer » renvoie confirm_repeat, jamais de Payer', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : n === 2 ? tooMany('1') : created('pay-5')) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    const id = storedId();
    await userEvent.click(await armed('Payer quand même'));
    expect(await screen.findByText(new RegExp(RATE))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(storedId()).toBe(id);
    const again = screen.getByRole('button', { name: 'Réessayer' });
    await waitFor(() => expect(again).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(again);
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies[2]).toMatchObject({ id, confirm_repeat: PID1 });
    expect(b.bodies[2]).toEqual(b.bodies[1]);
  });

  it('PAY-RETRY sur « Payer quand meme » : meme traitement (issue inconnue, meme id, pas de Payer)', async () => {
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : retry409()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    const id = storedId();
    await userEvent.click(await armed('Payer quand même'));
    expect(await screen.findByText(new RegExp(BUSY))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(storedId()).toBe(id);
  });
});

describe('A-NEW-2 : les boutons de l\'ecran recent s\'arment apres un court delai', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();

  it('desactives a l\'affichage, actifs ensuite ; un clic double (detail > 1) ne confirme rien', async () => {
    const b = backend({ checkout: () => recent409(recentAt()) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    expect(screen.getByRole('button', { name: 'Payer quand même' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Garder ma formule' })).toBeDisabled();
    const repeat = await armed('Payer quand même');
    fireEvent.click(repeat, { detail: 2 });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.bodies).toHaveLength(1);
  });
});

describe('S-b : « Payer quand meme » en cours dans un autre onglet', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();

  it('l\'etat repeating est persiste pendant l\'envoi', async () => {
    let release: (r: Response) => void = () => undefined;
    const b = backend({ checkout: (n) => (n === 1 ? recent409(recentAt()) : (new Promise<Response>((r) => (release = r)) as unknown as Response)) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await pay();
    await screen.findByText(/Vous venez de payer la formule Pro/);
    await userEvent.click(await armed('Payer quand même'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(storeKey())!).repeating).toBe(true));
    release(created('pay-1'));
    await screen.findByText(/Validez sur votre téléphone/);
  });

  it('un autre onglet voit l\'envoi en cours : « Payer quand meme » occupe et desactive', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: recentAt(), skewMs: 0 }, repeating: true, confirmRepeat: PID1, sentAt: Date.now() });
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getByRole('button', { name: 'Envoi de la demande…' })).toBeDisabled();
  });
});

describe('A1 et A2 : marqueur repeating perime', () => {
  const recentAt = () => new Date(Date.now() - 3 * 60_000).toISOString();
  const staleSeed = (ageMs: number) => seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: recentAt(), skewMs: 0 }, repeating: true, confirmRepeat: PID1, sentAt: Date.now() - ageMs });

  it('A2 : rechargement apres plus de 60 s : issue inconnue (jamais « Garder ma formule »), Reessayer renvoie le meme id avec confirm_repeat', async () => {
    staleSeed(5 * 60_000);
    const b = backend({ checkout: () => created('pay-8') });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(screen.queryByRole('button', { name: 'Garder ma formule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer quand même' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toEqual([{ id: ID, ...BODY, confirm_repeat: PID1 }]);
  });

  it('A2 : un autre onglet qui lit un marqueur perime voit la meme chose', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: recentAt(), skewMs: 0 } });
    const b = backend({ checkout: () => created('pay-8') });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await screen.findByText(/Vous venez de payer la formule Pro/);
    window.dispatchEvent(new StorageEvent('storage', { key: storeKey(), newValue: JSON.stringify(staleSeed(5 * 60_000)) }));
    expect(await screen.findByText(/La demande n’a pas reçu de réponse/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Garder ma formule' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies[0]).toMatchObject({ id: ID, confirm_repeat: PID1 });
  });

  it('A1 : marqueur encore frais (59,5 s) : occupe ; quelques instants apres, l\'etat bascule tout seul en issue inconnue, sans blocage', async () => {
    staleSeed(59_500);
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(screen.getByRole('button', { name: 'Envoi de la demande…' })).toBeDisabled();
    expect(await screen.findByText(/La demande n’a pas reçu de réponse/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Garder ma formule' })).toBeNull();
  });
});

describe('S2 : un 429 ne compte pas vers « Abandonner » et retarde « Reessayer »', () => {
  it('trois 429 de suite : toujours pas d\'Abandonner ; « Reessayer » desactive pendant le delai Retry-After', async () => {
    const b = backend({ checkout: () => tooMany('1') });
    setTransport(b.transport);
    seed({ unsent: true, sentAt: Date.now() - 10 * 60_000 });
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    for (let i = 0; i < 3; i++) {
      const btn = await screen.findByRole('button', { name: 'Réessayer' });
      await waitFor(() => expect(btn).toBeEnabled(), { timeout: 3000 });
      await userEvent.click(btn);
      await waitFor(() => expect(b.bodies).toHaveLength(i + 1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDisabled());
    }
    expect(screen.queryByRole('button', { name: 'Abandonner' })).toBeNull();
    expect(storedId()).toBe(ID);
  });
});

describe('S-e : expirations par minuteur', () => {
  const almostExpired = (ms: number) => new Date(Date.now() - 30 * 60_000 + ms).toISOString();

  it('fenetre ouverte : a l\'expiration l\'ecran se ferme, sans toast d\'echec, abonnement recharge, stockage vide', async () => {
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: almostExpired(1200), skewMs: 0 } });
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    const calls = b.subCalls();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(await screen.findByText(/Vous venez de payer la formule Pro/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 });
    expect(localStorage.getItem(storeKey())).toBeNull();
    expect(screen.queryByText(/Paiement refusé|n’a pas pu être traitée/)).toBeNull();
    await waitFor(() => expect(b.subCalls()).toBeGreaterThan(calls));
  });

  it('pendant « Payer quand meme » : pas d\'expiration, l\'envoi aboutit', async () => {
    let release: (r: Response) => void = () => undefined;
    seed({ recent: { paymentId: PID1, plan: 'pro', paidAt: almostExpired(1500), skewMs: 0 } });
    const b = backend({ checkout: () => new Promise<Response>((r) => (release = r)) as unknown as Response });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await subLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    await userEvent.click(await armed('Payer quand même'));
    await new Promise((r) => setTimeout(r, 1800)); // le minuteur d'expiration a sonne pendant l'envoi
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoi de la demande…' })).toBeDisabled();
    release(created('pay-7'));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies[0]).toMatchObject({ id: ID, confirm_repeat: PID1 });
  });
});
