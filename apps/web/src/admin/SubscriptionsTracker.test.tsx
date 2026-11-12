import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import { maskPhone, pollTiming, reviewInterval } from './paymentTracker';
import Subscriptions from './pages/Subscriptions';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const created = (id = 'pay-1') => json(201, { payment_id: id, status: 'initie', ussd_push: true });
const defaults = { ...pollTiming };
let userId = '';

async function tokensOf(phone: string) {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456' }) });
  return (await r.json()) as { access_token: string; refresh_token: string; user: { id: string } };
}
async function login() {
  const j = await tokensOf('+237690000002');
  session.setTokens(j.access_token, j.refresh_token);
  userId = j.user.id;
}
const storeKey = () => `rf.payment.v1.${userId}`;
const bodyKey = () => `rf.payment.body.v1.${userId}`;
const prefixed = () => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith('rf.payment.'));

const ID = '5d9f7c1e-3b2a-4c5d-8e6f-0a1b2c3d4e5f';
const BODY = { account_type: 'organisation', account_id: 'org-1', plan: 'structure', period: 'monthly', method: 'orange_money', phone: '+237690000002' };
function seed(over: Record<string, unknown> = {}) {
  const a = { id: ID, ownerId: userId, paymentId: 'pay-7', plan: 'pro', planName: 'Pro', period: 'monthly', method: 'orange_money', amount: null, sentAt: Date.now(), unsent: false, unknown: false, existing: false, phoneMasked: '••••••02', ...over };
  localStorage.setItem(storeKey(), JSON.stringify(a));
  return a;
}
const seedBody = (id = ID) => sessionStorage.setItem(bodyKey(), JSON.stringify({ id, body: BODY }));

function backend(opts: { checkout?: (n: number) => Response | Promise<Response>; status?: () => string | Response }) {
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
  vi.restoreAllMocks();
  Object.assign(pollTiming, defaults);
  setTransport(null);
  session.clear();
  sessionStorage.clear();
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

describe('S-1 : recul du suivi en a_verifier', () => {
  it('15 s, puis 60 s, puis 5 min selon le nombre de reponses', () => {
    expect(reviewInterval(0)).toBe(15_000);
    expect(reviewInterval(4)).toBe(15_000);
    expect(reviewInterval(5)).toBe(60_000);
    expect(reviewInterval(14)).toBe(60_000);
    expect(reviewInterval(15)).toBe(300_000);
  });
});

describe('A1 : rechargement et navigation', () => {
  it('localStorage ne garde aucune donnee personnelle ; le corps complet est en sessionStorage seulement', async () => {
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await openRenew();
    await userEvent.clear(screen.getByLabelText(/Numéro/));
    await userEvent.type(screen.getByLabelText(/Numéro/), '690000002');
    await userEvent.click(screen.getByRole('button', { name: 'Payer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    const raw = localStorage.getItem(storeKey())!;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    expect(saved).toMatchObject({ paymentId: 'pay-1', ownerId: userId, plan: 'structure', planName: 'Structure', period: 'monthly', unsent: false, existing: false });
    expect(Object.keys(saved).sort()).toEqual(['amount', 'existing', 'id', 'method', 'ownerId', 'paymentId', 'period', 'phoneMasked', 'plan', 'planName', 'sentAt', 'unknown', 'unsent']);
    expect(raw).not.toContain('690000002');
    expect(raw).not.toContain('account_id');
    expect(saved.phoneMasked).toBe('••••••02');
    expect(sessionStorage.getItem(bodyKey())).toContain('+237690000002');
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

  it('#4 envoi en vol au rechargement, ouvert depuis la banniere : formule et montant figes affiches, Reessayer = meme id et meme corps', async () => {
    seed({ paymentId: null, plan: 'structure', planName: 'Structure', amount: { amount_minor: 15000, currency: 'XAF' } });
    seedBody();
    const b = backend({ checkout: () => created('pay-9') });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    expect(screen.getByText(/Formule Structure · 15.000.FCFA/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toEqual([{ id: ID, ...BODY }]);
  });

  it('corps perdu (autre onglet) : pas de Reessayer, seulement Abandonner ; apres abandon le formulaire revient', async () => {
    seed({ paymentId: null, plan: 'structure', planName: 'Structure' });
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abandonner' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem(storeKey())).toBeNull();
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
    expect(b.bodies).toHaveLength(0);
  });

  it('stockage corrompu ou d\'un autre compte : ignore, on repart sans suivi', async () => {
    localStorage.setItem(storeKey(), '{pas du json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setTransport(backend({}).transport);
    const first = renderApp(<Subscriptions />);
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
    expect(warn).toHaveBeenCalled();
    first.unmount();
    seed({ ownerId: 'quelqu-un-d-autre' });
    renderApp(<Subscriptions />);
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });

  it('autre page de la console : la confirmation est annoncee sans la page Abonnements', async () => {
    seed({ paymentId: 'pay-7' });
    setTransport(backend({ status: () => 'confirme' }).transport);
    renderApp(<p>Une autre page</p>);
    expect(await screen.findByText('Paiement reçu. Formule Pro activée.')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(storeKey())).toBeNull());
  });

  it('autre page : un echec est annonce aussi', async () => {
    seed({ paymentId: 'pay-8' });
    setTransport(backend({ status: () => 'echoue' }).transport);
    renderApp(<p>Une autre page</p>);
    expect(await screen.findByText('Paiement refusé.')).toBeInTheDocument();
  });
});

describe('#5 : temps ecoule depuis l\'envoi (sentAt)', () => {
  it('rechargement tardif : plus d\'ecran USSD « 2:00 », mais « ne payez pas deux fois » / en verification', async () => {
    seed({ paymentId: 'pay-7', sentAt: Date.now() - 10 * 60_000 });
    setTransport(backend({ status: () => 'en_attente' }).transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(await screen.findByText(/Ne payez pas une deuxième fois/)).toBeInTheDocument();
    expect(screen.queryByText(/Validez sur votre téléphone/)).toBeNull();
    expect(screen.queryByText(/2:00/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
  });

  it('rechargement rapide : l\'ecran USSD reprend avec le temps restant', async () => {
    seed({ paymentId: 'pay-7', sentAt: Date.now() - 30_000 });
    setTransport(backend({ status: () => 'en_attente' }).transport);
    renderApp(<Subscriptions />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le paiement' }));
    expect(await screen.findByText(/Validez sur votre téléphone/)).toBeInTheDocument();
    expect(screen.getByText(/1:[2-5]\d/)).toBeInTheDocument();
  });
});

describe('#1 : un envoi en vol ne traverse ni une deconnexion ni un changement de compte', () => {
  function deferred() {
    let release: (r: Response) => void = () => undefined;
    const p = new Promise<Response>((r) => (release = r));
    return { p, release };
  }

  it('deconnexion pendant l\'envoi : reponse ignoree, rien de persiste, aucun GET /payments', async () => {
    const d = deferred();
    const b = backend({ checkout: () => d.p });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await waitFor(() => expect(b.bodies).toHaveLength(1));
    session.clear('logout');
    await waitFor(() => expect(prefixed()).toEqual([]));
    d.release(created('pay-late'));
    await new Promise((r) => setTimeout(r, 300));
    expect(prefixed()).toEqual([]);
    expect(b.polls()).toBe(0);
  });

  it('un autre compte se connecte pendant l\'envoi : sa session ne recoit ni la tentative ni le suivi', async () => {
    const d = deferred();
    const b = backend({ checkout: () => d.p });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await waitFor(() => expect(b.bodies).toHaveLength(1));
    session.clear('logout');
    const other = await tokensOf('+237690000001');
    session.setTokens(other.access_token, other.refresh_token, 'login');
    await waitFor(() => expect(session.accessToken).toBe(other.access_token));
    await new Promise((r) => setTimeout(r, 300));
    d.release(created('pay-late'));
    await new Promise((r) => setTimeout(r, 300));
    expect(localStorage.getItem(`rf.payment.v1.${other.user.id}`)).toBeNull();
    expect(prefixed()).toEqual([]);
    expect(b.polls()).toBe(0);
  });
});

describe('#2 : donnees personnelles', () => {
  for (const reason of ['logout', 'expired'] as const) {
    it(`${reason} : toutes les cles rf.payment.* sont purgees (localStorage et sessionStorage)`, async () => {
      seed();
      seedBody();
      localStorage.setItem('rf.payment.v1.autre-compte', '{}');
      setTransport(backend({}).transport);
      renderApp(<p>page</p>);
      await waitFor(() => expect(prefixed().length).toBeGreaterThan(0));
      session.clear(reason);
      await waitFor(() => expect(prefixed()).toEqual([]));
    });
  }

  it('maskPhone ne garde que les deux derniers chiffres', () => {
    expect(maskPhone('+237 690 000 011')).toBe('••••••11');
    expect(maskPhone('123')).toBe('••••');
  });
});

describe('#3 : focus et annonce', () => {
  it('envoi sans reponse : le focus va sur la zone d\'annonce', async () => {
    setTransport(backend({ checkout: () => { throw new TypeError('network'); } }).transport);
    renderApp(<Subscriptions />);
    await pay();
    const msg = await screen.findByText(/La demande n’a pas reçu de réponse/);
    const region = msg.closest('.pay-wait') as HTMLElement;
    await waitFor(() => expect(region).toHaveFocus());
  });

  it('PAY-OPEN : le focus va sur la zone d\'annonce', async () => {
    const open = json(409, { error: { code: 'CONFLICT', message: 'ouvert', details: { rule: 'PAY-OPEN', payment_id: 'pay-open', status: 'en_attente', plan: 'structure' } } });
    setTransport(backend({ checkout: () => open }).transport);
    renderApp(<Subscriptions />);
    await pay();
    const region = (await screen.findByText(/Un paiement est déjà en cours pour ce compte/)).closest('.pay-wait') as HTMLElement;
    await waitFor(() => expect(region).toHaveFocus());
  });
});

describe('#6 : plusieurs onglets', () => {
  const storageEvent = (newValue: string | null) => window.dispatchEvent(new StorageEvent('storage', { key: storeKey(), newValue }));

  it('une tentative effacee dans un autre onglet disparait ici et n\'est jamais reecrite', async () => {
    seed();
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await screen.findByRole('button', { name: 'Voir le paiement' });
    localStorage.removeItem(storeKey());
    storageEvent(null);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Voir le paiement' })).toBeNull());
    await new Promise((r) => setTimeout(r, 300));
    expect(localStorage.getItem(storeKey())).toBeNull();
  });

  it('une tentative creee dans un autre onglet apparait ici', async () => {
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await screen.findByRole('heading', { name: /Changer de formule/ });
    expect(screen.queryByRole('button', { name: 'Voir le paiement' })).toBeNull();
    storageEvent(JSON.stringify(seed({ planName: 'Pro' })));
    expect(await screen.findByText(/Un paiement Pro est en cours de suivi/)).toBeInTheDocument();
  });

  it('un evenement d\'une autre cle ou illisible est ignore', async () => {
    seed();
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await screen.findByRole('button', { name: 'Voir le paiement' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'autre', newValue: null }));
    storageEvent('{illisible');
    expect(screen.getByRole('button', { name: 'Voir le paiement' })).toBeInTheDocument();
  });
});

describe('stockage indisponible', () => {
  it('setItem qui leve : un avertissement, le paiement et son suivi fonctionnent en memoire', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    setTransport(backend({}).transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText(/Validez sur votre téléphone/)).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[paiement]'), expect.anything());
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

describe('A4 et S-6 : suivi sans fin', () => {
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

  it('S-6 : la banniere dit que le suivi est interrompu quand le paiement est introuvable', async () => {
    seed();
    setTransport(backend({ status: () => json(404, { error: { code: 'NOT_FOUND', message: 'x' } }) }).transport);
    renderApp(<Subscriptions />);
    expect(await screen.findByText(/Le suivi du paiement Pro est interrompu : paiement introuvable/)).toBeInTheDocument();
  });
});

describe('PAY-OPEN : le compte a deja un paiement ouvert (toutes formules)', () => {
  const open = (plan?: string, status = 'en_attente') => json(409, { error: { code: 'CONFLICT', message: 'ouvert', details: { rule: 'PAY-OPEN', payment_id: 'pay-open', status, ...(plan ? { plan } : {}) } } });

  it('affiche le paiement ouvert avec SA formule, le suit, ne propose pas Payer', async () => {
    const b = backend({ checkout: () => open('pro'), status: () => 'en_attente' });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText(/Un paiement est déjà en cours pour ce compte \(formule Pro\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payer' })).toBeNull();
    await waitFor(() => expect(b.polls()).toBeGreaterThan(0));
    expect(b.bodies).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(storeKey())!)).toMatchObject({ plan: 'pro', planName: 'Pro', existing: true, paymentId: 'pay-open' });
  });

  it('le paiement ouvert d\'une autre formule se confirme : l\'annonce nomme cette formule, pas celle choisie', async () => {
    setTransport(backend({ checkout: () => open('pro'), status: () => 'confirme' }).transport);
    renderApp(<Subscriptions />);
    await pay();
    expect(await screen.findByText('Paiement confirmé.')).toBeInTheDocument();
    expect(await screen.findByText('Paiement reçu. Formule Pro activée.')).toBeInTheDocument();
  });

  it('meme formule (ou formule absente de la reponse) : la formule choisie est annoncee', async () => {
    setTransport(backend({ checkout: () => open('structure'), status: () => 'confirme' }).transport);
    renderApp(<Subscriptions />);
    await pay();
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

describe('S-2 et S-5 : abandon et double soumission', () => {
  it('apres 3 « Reessayer » sans reponse (5xx) : « Abandonner » apparait, le formulaire revient', async () => {
    const b = backend({ checkout: () => json(500, { error: { code: 'SERVER_ERROR', message: 'panne' } }) });
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await pay();
    await screen.findByText(/La demande n’a pas reçu de réponse/);
    for (let i = 0; i < 3; i++) {
      expect(screen.queryByRole('button', { name: 'Abandonner' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(() => expect(b.bodies).toHaveLength(i + 2));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Réessayer' })).toBeEnabled());
    }
    expect(new Set(b.bodies.map((x) => x.id)).size).toBe(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Abandonner' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openRenew();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeEnabled();
  });

  it('deux soumissions synchrones du formulaire : un seul POST (garde sur ref)', async () => {
    const b = backend({});
    setTransport(b.transport);
    renderApp(<Subscriptions />);
    await openRenew();
    const form = document.getElementById('checkout-form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByText(/Validez sur votre téléphone/);
    expect(b.bodies).toHaveLength(1);
  });
});
