import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport, type Transport } from '../api/client';
import { session } from '../api/session';
import type { AdminPayment, PlatformRole, ReconciliationReport } from '../api/types';
import { mockTransport } from '../mocks/server';
import { expectNoSeriousViolations } from '../test/a11y';
import { renderApp } from '../test/utils';
import { eventsOf, issuesOf, paymentRights, refundAction } from './pages/Payments';
import Payments from './pages/Payments';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const err = (status: number, code: string, message: string, details?: Record<string, unknown>, fields?: Record<string, string>) => json(status, { error: { code, message, details, fields } });

const iso = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, 0) - min * 60_000).toISOString();
const pay = (id: string, status: AdminPayment['status'], extra: Partial<AdminPayment> = {}): AdminPayment => ({
  id,
  status,
  purpose: 'abonnement',
  plan: 'pro',
  period: 'mensuel',
  amount: { amount_minor: 2500, currency: 'XAF' },
  method: 'orange_money',
  provider_ref: 'PRV-1',
  paid_at: null,
  created_at: iso(120),
  payer_type: 'user',
  payer_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  connector: 'agregateur',
  error_code: null,
  poll: null,
  refund: null,
  ...extra,
});

const P_VERIF = pay('11111111-0000-4000-8000-000000000001', 'a_verifier', { error_code: 'timeout', poll: { count: 6, last_at: iso(20), next_at: iso(-30), last: 'inconnu' } });
const P_OK = pay('22222222-0000-4000-8000-000000000002', 'confirme', { paid_at: iso(100), amount: { amount_minor: 150000, currency: 'XAF' }, plan: 'structure', payer_type: 'organisation' });
const P_REFUNDING = pay('33333333-0000-4000-8000-000000000003', 'remboursement_en_cours', { refund: { status: 'en_attente', reason: 'Double paiement', requested_at: iso(10) } });
const P_REFUNDED = pay('44444444-0000-4000-8000-000000000004', 'rembourse', { paid_at: iso(300), refund: { status: 'rembourse', reason: 'Erreur de formule', requested_at: iso(200), done_at: iso(190) } });
const P_FAIL = pay('55555555-0000-4000-8000-000000000005', 'echoue');

const REPORT: ReconciliationReport = {
  day: '2026-11-11',
  generated_at: iso(60),
  totals: { payments: 4, confirmes: 2, confirmed_amounts: [{ amount_minor: 152500, currency: 'XAF' }] },
  confirmes_sans_abonnement: [{ payment_id: P_OK.id, payer_type: 'organisation', payer_id: 'o1', plan: 'structure' }],
  abonnements_sans_paiement: [{ subscription_id: 'sub-0000-4000', account_type: 'user', account_id: 'u1', plan: 'pro' }],
  divergences: [{ connector: 'agregateur', payment_id: P_VERIF.id, provider_ref: 'PRV-1', base: 'a_verifier', fournisseur: 'confirme', ecart: 'statut' }],
  non_verifies: [{ connector: 'autre', raison: 'sans_requete_de_statut' }],
  erreurs: [{ connector: 'agregateur', payment_id: P_FAIL.id, raison: 'timeout' }],
  complet: false,
  sources: [{ connector: 'agregateur', source: 'liste' }],
};
const CLEAN: ReconciliationReport = { ...REPORT, day: '2026-11-10', confirmes_sans_abonnement: [], abonnements_sans_paiement: [], divergences: [], non_verifies: [], erreurs: [], complet: true };

interface Backend {
  payments: AdminPayment[];
  reports: ReconciliationReport[];
  calls: string[];
  failList?: boolean;
  refund?: (id: string, body: { reason: string }) => Response;
  check?: (id: string) => Response;
  delay?: Promise<void>;
}

/** Faux serveur de l'administration des paiements ; /me renvoie les roles voulus. */
function backend(roles: PlatformRole[], b: Backend): Transport {
  return async (method, url, init) => {
    const path = url.replace(/^\/v1/, '').split('?')[0];
    b.calls.push(`${method} ${url.replace(/^\/v1/, '')}`);
    if (path === '/me') {
      const real = (await (await mockTransport(method, url, init)).json()) as object;
      return json(200, { ...real, platform_roles: roles });
    }
    if (!path.startsWith('/admin/payments')) return mockTransport(method, url, init);
    if (b.delay) await b.delay;
    if (method === 'GET' && path === '/admin/payments') {
      if (b.failList) return err(500, 'SERVER_ERROR', 'Le serveur rencontre un problème.');
      const st = new URL(url, 'http://x').searchParams.get('status');
      return json(200, { data: b.payments.filter((p) => !st || p.status === st), next_cursor: null });
    }
    if (method === 'GET' && path === '/admin/payments/reconciliations') return json(200, { data: b.reports, next_cursor: null });
    if (method === 'POST' && path === '/admin/payments/reconciliations') {
      const day = (JSON.parse(String(init.body)) as { day: string }).day;
      const rep = { ...CLEAN, day };
      b.reports = [rep, ...b.reports];
      return json(200, rep);
    }
    const m = /^\/admin\/payments\/([\w-]+)\/(check|refund)$/.exec(path);
    const target = b.payments.find((p) => p.id === m?.[1]);
    if (m && target && m[2] === 'check') {
      if (b.check) return b.check(target.id);
      target.status = 'confirme';
      return json(200, { id: target.id, status: 'confirme', checked: true, outcome: 'confirme' });
    }
    if (m && target && m[2] === 'refund') {
      const body = JSON.parse(String(init.body)) as { reason: string };
      if (b.refund) return b.refund(target.id, body);
      target.status = 'rembourse';
      return json(200, { id: target.id, status: 'rembourse' });
    }
    return err(404, 'NOT_FOUND', 'Élément introuvable.');
  };
}

const fresh = (): Backend => ({ payments: [P_VERIF, P_OK, P_REFUNDING, P_REFUNDED, P_FAIL].map((p) => ({ ...p })), reports: [{ ...REPORT }, { ...CLEAN }], calls: [] });

async function login() {
  const r = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000009', code: '123456' }) });
  const j = (await r.json()) as { access_token: string; refresh_token: string };
  session.setTokens(j.access_token, j.refresh_token);
}

beforeEach(login);
afterEach(() => {
  setTransport(null);
  session.clear();
});

async function openDetail(id: string) {
  const row = await screen.findByRole('button', { name: `Détails du paiement ${id.slice(0, 8)}` });
  await userEvent.click(row);
  return screen.findByRole('dialog');
}

describe('droits (admin-payments.controller.ts)', () => {
  it('lecture ops/support, interrogation ops, remboursement platform_admin', () => {
    const me = (roles: PlatformRole[]) => paymentRights({ platform_roles: roles } as never);
    expect(me([])).toEqual({ read: false, check: false, refund: false });
    expect(me(['support'])).toEqual({ read: true, check: false, refund: false });
    expect(me(['ops'])).toEqual({ read: true, check: true, refund: false });
    expect(me(['platform_admin'])).toEqual({ read: true, check: true, refund: true });
    expect(paymentRights(undefined).read).toBe(false);
  });
});

describe('Paiements : liste', () => {
  it('chargement, puis lignes avec statut, montant et devise venant de l\'API', async () => {
    let release: () => void = () => undefined;
    const b = fresh();
    b.delay = new Promise<void>((r) => (release = r));
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    await screen.findByRole('group', { name: 'Affichage' });
    expect(screen.queryByRole('table')).toBeNull();
    release();
    const table = await screen.findByRole('table', { name: 'Liste des paiements' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByText('À vérifier')).toBeInTheDocument();
    expect(within(table).getByText('Remboursement en cours')).toBeInTheDocument();
    expect(within(table).getByText('Remboursé')).toBeInTheDocument();
    expect(within(table).getByText(/150.000.FCFA/)).toBeInTheDocument();
    expect(screen.getByText('5 paiements')).toBeInTheDocument();
    await expectNoSeriousViolations();
  });

  it('une autre devise est affichee telle que recue (aucune devise en dur)', async () => {
    const b = fresh();
    b.payments = [pay('66666666-0000-4000-8000-000000000006', 'confirme', { amount: { amount_minor: 1999, currency: 'EUR' } })];
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    expect(await screen.findByText(/19,99.€/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/FCFA/);
  });

  it('filtre par statut : appelle GET /admin/payments?status=a_verifier', async () => {
    const b = fresh();
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Statut'), 'a_verifier');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(b.calls.some((c) => c.includes('/admin/payments?') && c.includes('status=a_verifier'))).toBe(true);
    expect(screen.getByText('1 paiement')).toBeInTheDocument();
  });

  it('etat vide : message propre au filtre « a verifier »', async () => {
    const b = fresh();
    b.payments = [P_OK];
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Statut'), 'a_verifier');
    expect(await screen.findByText('Aucun paiement à vérifier. Tout est à jour.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Statut'), 'echoue');
    expect(await screen.findByText('Aucun paiement ne correspond à ce filtre.')).toBeInTheDocument();
    await expectNoSeriousViolations();
  });

  it('etat erreur : message et bouton Reessayer', async () => {
    const b = fresh();
    b.failList = true;
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    const retry = await screen.findByRole('button', { name: /Réessayer/ });
    b.failList = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('un compte sans role plateforme voit « Acces reserve » (403 de l\'API)', async () => {
    setTransport(backend([], fresh()));
    renderApp(<Payments />);
    expect(await screen.findByText('Accès réservé')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Paiements : detail, historique, interrogation', () => {
  it('detail : champs, historique reconstitue dans l\'ordre', async () => {
    setTransport(backend(['ops'], fresh()));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    expect(within(dlg).getByText(P_VERIF.id)).toBeInTheDocument();
    expect(within(dlg).getByText('PRV-1')).toBeInTheDocument();
    const items = within(dlg).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items[0]).toMatch(/^Paiement créé/);
    expect(items.some((x) => /Le fournisseur n’a pas répondu à l’initiation \(timeout\)/.test(x))).toBe(true);
    expect(items.some((x) => /Interrogation du fournisseur n° 6 : inconnu/.test(x))).toBe(true);
    expect(items[items.length - 1]).toMatch(/Prochaine interrogation prévue/);
    await expectNoSeriousViolations();
  });

  it('historique d\'un remboursement : motif, demande, fin', () => {
    const ev = eventsOf(P_REFUNDED).map((e) => e.text);
    expect(ev).toContain('Remboursement demandé : Erreur de formule');
    expect(ev).toContain('Remboursement effectué');
    expect(eventsOf(P_REFUNDING).map((e) => e.text)).toContain('Remboursement : en_attente');
    expect(eventsOf(pay('x', 'initie', { created_at: undefined }))).toEqual([]);
  });

  it('Interroger : appelle POST /check, annonce le statut et recharge la liste', async () => {
    const b = fresh();
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    expect(await screen.findByText('Le fournisseur a été interrogé. Statut : Confirmé.')).toBeInTheDocument();
    expect(b.calls).toContain(`POST /admin/payments/${P_VERIF.id}/check`);
    await waitFor(() => expect(b.calls.filter((c) => c === 'GET /admin/payments?limit=100').length).toBeGreaterThan(1));
  });

  it('Interroger sans issue chez le fournisseur : le dit, sans changer le statut', async () => {
    const b = fresh();
    b.check = (id) => json(200, { id, status: 'a_verifier', checked: true, outcome: 'inconnu' });
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    expect(await screen.findByText('Le fournisseur n’a pas encore donné l’issue (inconnu).')).toBeInTheDocument();
  });

  it('Interroger un paiement deja tranche cote serveur : message neutre', async () => {
    const b = fresh();
    b.check = (id) => json(200, { id, status: 'confirme', checked: false });
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    expect(await screen.findByText('Ce paiement n’est plus à vérifier.')).toBeInTheDocument();
  });

  it('Interroger en erreur : message d\'erreur visible dans le detail', async () => {
    const b = fresh();
    b.check = () => err(500, 'SERVER_ERROR', 'Le serveur rencontre un problème.');
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    expect(await within(dlg).findByText(/Le serveur rencontre un problème/)).toBeInTheDocument();
  });

  it('support : lecture seule, ni Interroger ni Rembourser', async () => {
    setTransport(backend(['support'], fresh()));
    renderApp(<Payments />);
    const dlg = await openDetail(P_VERIF.id);
    expect(within(dlg).queryByRole('button', { name: 'Interroger' })).toBeNull();
    expect(within(dlg).queryByRole('button', { name: 'Rembourser' })).toBeNull();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Terminé' }));
    const ok = await openDetail(P_OK.id);
    expect(within(ok).getByText('Le remboursement est réservé aux administrateurs de la plateforme.')).toBeInTheDocument();
  });

  it('clavier : Entree ouvre le detail, Echap le ferme et rend le focus', async () => {
    setTransport(backend(['ops'], fresh()));
    renderApp(<Payments />);
    const btn = await screen.findByRole('button', { name: `Détails du paiement ${P_OK.id.slice(0, 8)}` });
    btn.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(btn).toHaveFocus());
  });
});

describe('Paiements : remboursement (platform_admin)', () => {
  it('ops : pas de bouton Rembourser, note explicative', async () => {
    setTransport(backend(['ops'], fresh()));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    expect(within(dlg).queryByRole('button', { name: 'Rembourser' })).toBeNull();
    expect(within(dlg).getByText(/réservé aux administrateurs/)).toBeInTheDocument();
  });

  it('seul un paiement confirme se rembourse', async () => {
    setTransport(backend(['platform_admin'], fresh()));
    renderApp(<Payments />);
    const dlg = await openDetail(P_REFUNDED.id);
    expect(within(dlg).queryByRole('button', { name: 'Rembourser' })).toBeNull();
  });

  it('motif obligatoire (5 caracteres), puis POST /refund avec le motif, statut mis a jour', async () => {
    const b = fresh();
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    expect(within(rd).getByText(/150.000.FCFA sera rendu/)).toBeInTheDocument();
    await expectNoSeriousViolations();
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'abc');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await within(rd).findByText('Le motif doit contenir au moins 5 caractères.')).toBeInTheDocument();
    expect(b.calls.some((c) => c.includes('/refund'))).toBe(false);
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'de trop');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await screen.findByText('Remboursement effectué.')).toBeInTheDocument();
    expect(b.calls.filter((c) => c.includes('/refund'))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Remboursé').length).toBe(2));
  });

  it('annuler le remboursement revient au detail, sans appel', async () => {
    const b = fresh();
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.click(within(rd).getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByRole('dialog', { name: /Paiement 22222222/ })).toBeInTheDocument();
    expect(b.calls.some((c) => c.includes('/refund'))).toBe(false);
  });

  it('PAY-REFUND-PENDING : annonce « il ne sera pas fait deux fois » et recharge, sans relance', async () => {
    const b = fresh();
    b.refund = (id) => {
      b.payments.find((p) => p.id === id)!.status = 'remboursement_en_cours';
      return err(422, 'BUSINESS_RULE', 'Remboursement en cours de vérification.', { rule: 'PAY-REFUND-PENDING' });
    };
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'double paiement');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await screen.findByText('Remboursement en cours de vérification. Il ne sera pas fait deux fois.')).toBeInTheDocument();
    expect(b.calls.filter((c) => c.includes('/refund'))).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Remboursement en cours').length).toBe(2));
  });

  it('409 PAY-REFUND-IN-PROGRESS : message dedie', async () => {
    const b = fresh();
    b.refund = () => err(409, 'CONFLICT', 'Un remboursement est déjà en cours pour ce paiement.', { rule: 'PAY-REFUND-IN-PROGRESS' });
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'double paiement');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await screen.findByText('Un remboursement est déjà en cours pour ce paiement.')).toBeInTheDocument();
  });

  it('refus du fournisseur : le message du serveur reste dans la fenetre, on peut corriger', async () => {
    const b = fresh();
    b.refund = () => err(422, 'BUSINESS_RULE', 'Le fournisseur a refusé le remboursement.', { rule: 'PAY-REFUND-REFUSED' });
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'double paiement');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await within(rd).findByText(/Le fournisseur a refusé le remboursement/)).toBeInTheDocument();
    expect(within(rd).getByRole('button', { name: 'Confirmer le remboursement' })).toBeEnabled();
  });

  it('erreur de validation du motif renvoyee par le serveur : affichee sous le champ', async () => {
    const b = fresh();
    b.refund = () => err(422, 'VALIDATION_ERROR', 'Motif invalide.', undefined, { reason: 'trop court cote serveur' });
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    const dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    const rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'double paiement');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await within(rd).findByText('trop court cote serveur')).toBeInTheDocument();
  });
});

describe('Paiements : rapprochement', () => {
  async function openReco(roles: PlatformRole[], b = fresh()) {
    setTransport(backend(roles, b));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Rapprochement' }));
    return b;
  }

  it('liste des rapports : totaux, anomalies, etat complet ou non', async () => {
    await openReco(['ops']);
    const table = await screen.findByRole('table', { name: 'Rapports de rapprochement avec les fournisseurs' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText(/152.500.FCFA/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('5')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Incomplet')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Aucune')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Complet')).toBeInTheDocument();
    await expectNoSeriousViolations();
  });

  it('issuesOf compte toutes les anomalies', () => {
    expect(issuesOf(REPORT)).toBe(5);
    expect(issuesOf(CLEAN)).toBe(0);
  });

  it('detail d\'un rapport : sections, ecarts de statut, rien a signaler', async () => {
    await openReco(['ops']);
    await userEvent.click(await screen.findByRole('button', { name: /Rapport du 11 nov\. 2026/ }));
    const dlg = await screen.findByRole('dialog', { name: /Rapport du 11 nov\. 2026/ });
    expect(within(dlg).getByText('Paiements confirmés sans abonnement (1)')).toBeInTheDocument();
    expect(within(dlg).getByText(/statut différent : À vérifier \/ confirme/)).toBeInTheDocument();
    expect(within(dlg).getByText('sans_requete_de_statut')).toBeInTheDocument();
    await expectNoSeriousViolations();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Terminé' }));
    await userEvent.click(await screen.findByRole('button', { name: /Rapport du 10 nov\. 2026/ }));
    const clean = await screen.findByRole('dialog');
    expect(within(clean).getAllByText('Rien à signaler.')).toHaveLength(5);
  });

  it('etat vide : aucun rapport', async () => {
    const b = fresh();
    b.reports = [];
    await openReco(['ops'], b);
    expect(await screen.findByText('Aucun rapport')).toBeInTheDocument();
  });

  it('administrateur : relancer un jour appelle POST /reconciliations et recharge', async () => {
    const b = await openReco(['platform_admin']);
    await userEvent.type(await screen.findByLabelText('Jour à rapprocher'), '2026-11-09');
    await userEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    expect(await screen.findByText(/Rapprochement du 9 nov\. 2026 terminé\./)).toBeInTheDocument();
    expect(b.calls).toContain('POST /admin/payments/reconciliations');
    expect(await screen.findByRole('button', { name: /Rapport du 9 nov\. 2026/ })).toBeInTheDocument();
  });

  it('le bouton Relancer exige un jour', async () => {
    await openReco(['platform_admin']);
    expect(await screen.findByRole('button', { name: 'Relancer' })).toBeDisabled();
  });

  it('ops : pas de relance manuelle', async () => {
    await openReco(['ops']);
    expect(await screen.findByText(/réservé aux administrateurs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Relancer' })).toBeNull();
  });

  it('etat erreur sur la liste des rapports', async () => {
    const b = fresh();
    setTransport(async (m, u, i) => (u.includes('/reconciliations') && m === 'GET' ? err(500, 'SERVER_ERROR', 'Panne.') : backend(['ops'], b)(m, u, i)));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Rapprochement' }));
    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  it('erreur de la relance : message accessible (role alert)', async () => {
    const b = fresh();
    setTransport(async (m, u, i) => (u.includes('/reconciliations') && m === 'POST' ? err(500, 'SERVER_ERROR', 'Panne du rapprochement.') : backend(['platform_admin'], b)(m, u, i)));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Rapprochement' }));
    await userEvent.type(await screen.findByLabelText('Jour à rapprocher'), '2026-11-09');
    await userEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Panne du rapprochement.');
  });
});

describe('Paiements : relance d\'un remboursement sans issue (regle du serveur)', () => {
  const T0 = Date.UTC(2026, 10, 12, 12, 0);
  const rp = (refund: AdminPayment['refund'], status: AdminPayment['status'] = 'remboursement_en_cours') => pay('77777777-0000-4000-8000-000000000007', status, { refund });

  it('refundAction : confirme -> refund ; relance si a_verifier, inconnu, en_cours > 10 min, date absente ; sinon rien', () => {
    expect(refundAction(pay('x', 'confirme'), T0)).toBe('refund');
    expect(refundAction(pay('x', 'echoue'), T0)).toBeNull();
    expect(refundAction(pay('x', 'rembourse'), T0)).toBeNull();
    expect(refundAction(rp({ status: 'en_attente', requested_at: new Date(T0 - 3_600_000).toISOString() }), T0)).toBeNull();
    expect(refundAction(rp({ status: 'en_cours', requested_at: new Date(T0 - 9 * 60_000).toISOString() }), T0)).toBeNull();
    expect(refundAction(rp({ status: 'en_cours', requested_at: new Date(T0 - 11 * 60_000).toISOString() }), T0)).toBe('retry');
    expect(refundAction(rp({ status: 'en_cours' }), T0)).toBe('retry');
    expect(refundAction(rp({ status: 'a_verifier', requested_at: new Date(T0 - 60_000).toISOString() }), T0)).toBe('retry');
    expect(refundAction(rp({ status: 'inconnu', requested_at: new Date(T0 - 60_000).toISOString() }), T0)).toBe('retry');
    expect(refundAction(rp(null), T0)).toBe('retry');
  });

  async function openRow(p: AdminPayment, roles: PlatformRole[] = ['platform_admin']) {
    const b = fresh();
    b.payments = [p];
    setTransport(backend(roles, b));
    renderApp(<Payments />);
    const dlg = await openDetail(p.id);
    return { b, dlg };
  }

  it('a_verifier : bouton « Relancer le remboursement », motif repris, POST /refund envoye', async () => {
    const { b, dlg } = await openRow(rp({ id: 'r1', status: 'a_verifier', reason: 'Erreur de formule', requested_at: iso(60) }));
    expect(within(dlg).queryByRole('button', { name: 'Rembourser' })).toBeNull();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Relancer le remboursement' }));
    const rd = await screen.findByRole('dialog', { name: 'Relancer ce remboursement ?' });
    expect(within(rd).getByLabelText('Motif du remboursement')).toHaveValue('Erreur de formule');
    await userEvent.click(within(rd).getByRole('button', { name: 'Relancer le remboursement' }));
    expect(await screen.findByText('Remboursement effectué.')).toBeInTheDocument();
    expect(b.calls.filter((c) => c.includes('/refund'))).toHaveLength(1);
  });

  it('en_cours depuis plus de 10 min : relance possible', async () => {
    const { dlg } = await openRow(rp({ status: 'en_cours', reason: 'Double paiement', requested_at: new Date(Date.now() - 20 * 60_000).toISOString() }));
    expect(within(dlg).getByRole('button', { name: 'Relancer le remboursement' })).toBeInTheDocument();
  });

  it('en_attente, ou en_cours depuis moins de 10 min : pas de relance (le serveur repondrait 409)', async () => {
    const first = await openRow(rp({ status: 'en_attente', reason: 'Double paiement', requested_at: iso(90) }));
    expect(within(first.dlg).queryByRole('button', { name: /embours/ })).toBeNull();
  });

  it('en_cours depuis moins de 10 min : pas de bouton', async () => {
    const { dlg } = await openRow(rp({ status: 'en_cours', reason: 'Double paiement', requested_at: new Date(Date.now() - 2 * 60_000).toISOString() }));
    expect(within(dlg).queryByRole('button', { name: /embours/ })).toBeNull();
  });

  it('ops : pas de relance de remboursement, note explicative', async () => {
    const { dlg } = await openRow(rp({ status: 'a_verifier', reason: 'x', requested_at: iso(60) }), ['ops']);
    expect(within(dlg).queryByRole('button', { name: 'Relancer le remboursement' })).toBeNull();
    expect(within(dlg).getByText(/réservé aux administrateurs/)).toBeInTheDocument();
  });
});

describe('Paiements : fermeture, ligne ouverte, focus', () => {
  it('Annuler et Echap font le meme reset : l\'erreur du remboursement ne reste pas a la reouverture', async () => {
    const b = fresh();
    b.refund = () => err(422, 'BUSINESS_RULE', 'Le fournisseur a refusé le remboursement.', { rule: 'PAY-REFUND-REFUSED' });
    setTransport(backend(['platform_admin'], b));
    renderApp(<Payments />);
    let dlg = await openDetail(P_OK.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    let rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    await userEvent.type(within(rd).getByLabelText('Motif du remboursement'), 'double paiement');
    await userEvent.click(within(rd).getByRole('button', { name: 'Confirmer le remboursement' }));
    await within(rd).findByText(/Le fournisseur a refusé/);
    await userEvent.click(within(rd).getByRole('button', { name: 'Annuler' }));
    dlg = await screen.findByRole('dialog', { name: /Paiement 22222222/ });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rembourser' }));
    rd = await screen.findByRole('dialog', { name: 'Rembourser ce paiement ?' });
    expect(within(rd).queryByText(/Le fournisseur a refusé/)).toBeNull();
  });

  it('Terminé efface l\'erreur d\'interrogation comme Echap', async () => {
    const b = fresh();
    b.check = () => err(500, 'SERVER_ERROR', 'Le serveur rencontre un problème.');
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    let dlg = await openDetail(P_VERIF.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    await within(dlg).findByText(/Le serveur rencontre un problème/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Terminé' }));
    dlg = await openDetail(P_VERIF.id);
    expect(within(dlg).queryByText(/Le serveur rencontre un problème/)).toBeNull();
  });

  it('Interroger depuis le filtre « a verifier » : la ligne reste ouverte apres le rechargement, le focus ne se perd pas', async () => {
    const b = fresh();
    setTransport(backend(['ops'], b));
    renderApp(<Payments />);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Statut'), 'a_verifier');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: /Détails du paiement/ }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Interroger' }));
    await screen.findByText('Le fournisseur a été interrogé. Statut : Confirmé.');
    // la ligne est sortie du filtre mais le detail reste affiche, avec son nouveau statut
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
    const still = screen.getByRole('dialog');
    expect(within(still).getByText('Confirmé')).toBeInTheDocument();
    await userEvent.click(within(still).getByRole('button', { name: 'Terminé' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.body).not.toHaveFocus());
    expect(document.activeElement).toBe(screen.getByLabelText('Statut'));
  });
});

describe('mock de la console : memes contrats que l\'API', () => {
  it('liste, interrogation, remboursement reserve a platform_admin (403 sinon)', async () => {
    setTransport(null);
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` };
    const list = (await (await mockTransport('GET', '/v1/admin/payments?status=a_verifier', { headers: auth })).json()) as { data: AdminPayment[] };
    expect(list.data).toHaveLength(1);
    const id = list.data[0].id;
    const checked = (await (await mockTransport('POST', `/v1/admin/payments/${id}/check`, { headers: auth, body: '{}' })).json()) as { status: string; checked: boolean };
    expect(checked).toMatchObject({ status: 'confirme', checked: true });
    expect((await mockTransport('POST', `/v1/admin/payments/${id}/refund`, { headers: auth, body: JSON.stringify({ reason: 'ok' }) })).status).toBe(422);
    expect((await mockTransport('POST', `/v1/admin/payments/${id}/refund`, { headers: auth, body: JSON.stringify({ reason: 'double paiement' }) })).status).toBe(200);
    expect((await mockTransport('POST', `/v1/admin/payments/${id}/refund`, { headers: auth, body: JSON.stringify({ reason: 'double paiement' }) })).status).toBe(200);
    const other = await mockTransport('POST', '/v1/auth/otp/verify', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+237690000002', code: '123456' }) });
    const tok = ((await other.json()) as { access_token: string }).access_token;
    const denied = await mockTransport('GET', '/v1/admin/payments', { headers: { ...auth, Authorization: `Bearer ${tok}` } });
    expect(denied.status).toBe(403);
  });
});
