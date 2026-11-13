/**
 * Mock transport (VITE_MOCK=1 and tests). Answers /v1 requests from the in-memory db with the same
 * shapes and error format as the API contract. Loaded with a dynamic import only in mock mode.
 */
import type { Transport } from '../api/client';
import type { PackContent, PackObject, ProtocolSimulation, ReconciliationReport, Reminder } from '../api/types';
import {
  ORG_ID,
  addDays,
  alerts,
  batchesOf,
  dashboard,
  dogsOf,
  farms,
  leads,
  logsOf,
  meOf,
  members,
  packMeta,
  payments,
  paymentMethods,
  reconciliations,
  plans,
  reminders,
  subscription,
  today,
  uid,
  users,
  versions,
  type MockPayment,
  type MockUser,
} from './db';

const DEV_CODE = '123456';
const LATENCY = import.meta.env.MODE === 'test' ? 0 : 280;

type Ctx = { method: string; path: string; query: URLSearchParams; body: unknown; form?: FormData; user: MockUser | null };
type Handler = (ctx: Ctx, params: Record<string, string>) => unknown | Promise<unknown>;

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const routes: { method: string; re: RegExp; keys: string[]; h: Handler; auth: boolean }[] = [];
function on(method: string, pattern: string, h: Handler, auth = true) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, h, auth });
}

const page = <T,>(data: T[]) => ({ data, next_cursor: null });
const need = (u: MockUser | null): MockUser => {
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Jeton absent ou invalide.');
  return u;
};
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Élément introuvable.');

/* ----------------------------------------------------------------- auth */

const tokens = new Map<string, string>(); // token → user id
function issue(u: MockUser) {
  const access = `mock-at.${u.id}.${Date.now()}`;
  const refresh = `mock-rt.${u.id}.${Date.now()}`;
  tokens.set(access, u.id);
  tokens.set(refresh, u.id);
  return { access, refresh };
}
/** Tokens survive page reloads in mock mode: they embed the user id. */
function userFromToken(t: string | null): MockUser | null {
  if (!t) return null;
  const m = /^mock-(?:at|rt)\.([^.]+)\./.exec(t);
  const id = tokens.get(t) ?? m?.[1];
  return users.find((u) => u.id === id) ?? null;
}

on('POST', '/auth/otp/request', ({ body }) => {
  const phone = String((body as { phone?: string })?.phone ?? '').replace(/\s/g, '');
  if (!/^\+?\d{9,15}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', 'Numéro invalide.', { phone: 'format invalide' });
  return { sent: true, retry_after_s: 30, dev_code: DEV_CODE };
}, false);

on('POST', '/auth/otp/verify', ({ body }) => {
  const b = body as { phone: string; code: string };
  const phone = b.phone.replace(/\s/g, '');
  if (b.code !== DEV_CODE) throw new HttpError(422, 'VALIDATION_ERROR', 'Code incorrect ou expiré.', { code: 'code incorrect' });
  let u = users.find((x) => x.phone === phone);
  if (!u) {
    u = { id: `u-${phone}`, phone, name: '', language: 'fr', platform_roles: [], memberships: [], farms: [], plan: 'decouverte' };
    users.push(u);
  }
  const t = issue(u);
  return { access_token: t.access, refresh_token: t.refresh, user: meOf(u) };
}, false);

on('POST', '/auth/refresh', ({ body }) => {
  const u = userFromToken((body as { refresh_token?: string })?.refresh_token ?? null);
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expirée.');
  return { access_token: issue(u).access };
}, false);

on('GET', '/me', ({ user }) => meOf(need(user)));
on('PATCH', '/me', ({ user, body }) => {
  const u = need(user);
  Object.assign(u, body as object);
  return meOf(u);
});

/* --------------------------------------------------------------- public */

on('GET', '/plans', () => ({ country: 'CM', currency: 'XAF', data: plans, next_cursor: null, payment_methods: paymentMethods }), false);
on('POST', '/leads', ({ body }) => {
  const b = body as { phone?: string; name?: string; source?: string };
  const phone = String(b.phone ?? '').replace(/[\s.-]/g, '');
  if (!/^\+?\d{9,15}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', 'Numéro invalide.', { phone: 'Saisissez un numéro complet, par exemple +237 6 99 12 34 56.' });
  leads.push({ phone, name: b.name, source: b.source ?? 'site', at: new Date().toISOString() });
  return { id: uid(), received: true };
}, false);

on('GET', '/certificates/verify', ({ query }) => {
  const payload = query.get('payload') ?? '';
  const [b64, sig] = payload.split('.');
  if (!b64 || !sig) throw new HttpError(422, 'VALIDATION_ERROR', 'Format de certificat illisible.', { payload: 'format attendu : données.signature' });
  let data: Record<string, string>;
  try {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    data = JSON.parse(decodeURIComponent(escape(s)));
  } catch {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Format de certificat illisible.', { payload: 'données non décodables' });
  }
  const valid = sig.startsWith('demo') && (data.u ?? '') >= today();
  return {
    valid,
    animal_name: data.a,
    species: data.s,
    disease: data.d,
    event_date: data.e,
    valid_until: data.u,
    reason: valid ? undefined : sig.startsWith('demo') ? 'certificat expiré' : 'signature invalide',
  };
}, false);

/* --------------------------------------------------------- organisation */

const orgGuard = (u: MockUser, id: string) => {
  if (!u.memberships.some((m) => m.organisation_id === id)) throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas accès à cette organisation.");
};

on('GET', '/organisations/:id', ({ user }, p) => {
  orgGuard(need(user), p.id);
  return { id: ORG_ID, name: 'Coop. avicole du Centre', plan: 'structure', farmers_count: 312, country: 'CM' };
});
on('GET', '/organisations/:id/dashboard', ({ user, query }, p) => {
  orgGuard(need(user), p.id);
  return dashboard(query.get('speculation') ?? undefined);
});
on('GET', '/organisations/:id/farms', ({ user, query }, p) => {
  orgGuard(need(user), p.id);
  const q = (query.get('q') ?? '').toLowerCase();
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return page(farms.filter((f) => !q || norm(`${f.name} ${f.owner_name} ${f.region} ${f.owner_phone}`).includes(norm(q))));
});

const statusFilter = (status: string | null) => (r: Reminder) => {
  if (!status) return true;
  return status.split(',').includes(r.status);
};
on('GET', '/organisations/:id/reminders', ({ user, query }, p) => {
  orgGuard(need(user), p.id);
  return page(reminders.filter(statusFilter(query.get('status'))).sort((a, b) => a.due_date.localeCompare(b.due_date)));
});
on('GET', '/organisations/:id/members', ({ user }, p) => {
  orgGuard(need(user), p.id);
  return page(members.filter((m) => m.status !== 'retire'));
});
on('POST', '/organisations/:id/members', ({ user, body }, p) => {
  orgGuard(need(user), p.id);
  const b = body as { phone: string; role: string; name?: string };
  const phone = (b.phone ?? '').replace(/\s/g, '');
  if (!/^\+?\d{9,15}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', 'Numéro invalide.', { phone: 'format invalide' });
  if (members.some((m) => m.phone === phone && m.status !== 'retire')) throw new HttpError(409, 'CONFLICT', 'Ce numéro est déjà membre de l’organisation.');
  const m = { id: uid(), name: b.name || null, phone, role: b.role as never, status: 'invite' as const, joined_at: null, last_seen_at: null };
  members.push(m);
  return m;
});
on('PATCH', '/members/:id', ({ body }, p) => {
  const m = members.find((x) => x.id === p.id);
  if (!m) throw notFound();
  if (m.role === 'admin' && (body as { role: string }).role !== 'admin' && members.filter((x) => x.role === 'admin').length === 1)
    throw new HttpError(422, 'BUSINESS_RULE', "L'organisation doit garder au moins un administrateur.", undefined, { rule: 'RG-ORG-01' });
  Object.assign(m, body);
  return m;
});
on('DELETE', '/members/:id', (_c, p) => {
  const m = members.find((x) => x.id === p.id);
  if (!m) throw notFound();
  m.status = 'retire';
  return undefined;
});

/* ---------------------------------------------------------------- farms */

on('GET', '/farms/:id', (_c, p) => farms.find((f) => f.id === p.id) ?? (() => { throw notFound(); })());
on('GET', '/farms/:id/batches', (_c, p) => page(batchesOf(p.id)));
on('GET', '/farms/:id/dogs', (_c, p) => page(dogsOf(p.id)));
on('GET', '/farms/:id/daily-logs', (_c, p) => page(logsOf(p.id)));
on('GET', '/farms/:id/kpis', (_c, p) => {
  const b = batchesOf(p.id);
  const ponte = b.find((x) => x.production_type === 'ponte');
  return {
    period: '7d',
    kpis: [
      ...(ponte ? [{ code: 'taux_ponte', label: 'Taux de ponte', value: 76.4, unit: '%', status: 'ok', subject_name: `Bande ${ponte.name}` }] : []),
      { code: 'mortalite_cumulee', label: 'Mortalité cumulée', value: p.id === 'f-biyong' ? 6.8 : 2.1, unit: '%', status: p.id === 'f-biyong' ? 'red' : 'ok' },
      ...(b.some((x) => x.production_type === 'chair') ? [{ code: 'indice_consommation', label: 'Indice de consommation', value: 1.9, unit: 'kg/kg', status: 'amber', subject_name: 'Bande B02' }] : []),
    ],
    margin: {
      month: today().slice(0, 7),
      revenue: { amount_minor: 1_842_000, currency: 'XAF' },
      expenses: { amount_minor: 1_215_500, currency: 'XAF' },
      margin: { amount_minor: 626_500, currency: 'XAF' },
    },
  };
});

on('GET', '/reminders', ({ query }) =>
  page(reminders.filter((r) => (!query.get('farm_id') || r.farm_id === query.get('farm_id')) && statusFilter(query.get('status'))(r)).sort((a, b) => a.due_date.localeCompare(b.due_date))),
);
on('POST', '/reminders/:id/confirm', (_c, p) => {
  const r = reminders.find((x) => x.id === p.id);
  if (!r) throw notFound();
  if (r.status === 'confirme') throw new HttpError(409, 'CONFLICT', 'Ce rappel est déjà confirmé.');
  r.status = 'confirme';
  r.confirmed_at = new Date().toISOString();
  return r;
});
on('POST', '/reminders/:id/snooze', ({ body }, p) => {
  const r = reminders.find((x) => x.id === p.id);
  if (!r) throw notFound();
  const until = (body as { until: string }).until;
  if (!until || until <= today()) throw new HttpError(422, 'VALIDATION_ERROR', 'Choisissez une date future.', { until: 'date future attendue' });
  r.snoozed_until = until;
  r.due_date = until;
  r.status = 'a_venir';
  return r;
});

/* --------------------------------------------------------------- alerts */

on('GET', '/alerts', ({ query }) => {
  const st = query.get('status');
  const sev = query.get('severity');
  return page(alerts.filter((a) => (!st || st.split(',').includes(a.status)) && (!sev || a.severity === sev)).sort((a, b) => b.opened_at.localeCompare(a.opened_at)));
});
on('POST', '/alerts/:id/ack', ({ user }, p) => {
  const a = alerts.find((x) => x.id === p.id);
  if (!a) throw notFound();
  a.status = 'acquittee';
  a.acked_at = new Date().toISOString();
  a.acked_by = need(user).name;
  return a;
});
on('POST', '/alerts/:id/resolve', ({ body }, p) => {
  const a = alerts.find((x) => x.id === p.id);
  if (!a) throw notFound();
  const b = body as { cause?: string; action?: string };
  if (a.severity === 'critique') {
    const fields: Record<string, string> = {};
    if (!b.cause?.trim()) fields.cause = 'Cause obligatoire pour une alerte critique.';
    if (!b.action?.trim()) fields.action = 'Action obligatoire pour une alerte critique.';
    if (Object.keys(fields).length) throw new HttpError(422, 'VALIDATION_ERROR', 'Précisez la cause et l’action menée.', fields);
  }
  Object.assign(a, { status: 'resolue', resolved_at: new Date().toISOString(), cause: b.cause ?? null, action: b.action ?? null });
  return a;
});

/* ------------------------------------------------------ subscriptions */

on('GET', '/subscriptions/current', () => subscription);
on('POST', '/subscriptions/checkout', ({ body, user }) => {
  const b = body as { id?: string; plan: string; period: string; method: string; phone: string; account_id: string };
  const phone = (b.phone ?? '').replace(/\s/g, '');
  if (!/^\+?\d{9,15}$/.test(phone)) throw new HttpError(422, 'VALIDATION_ERROR', 'Numéro mobile money invalide.', { phone: 'format invalide' });
  const pl = plans.find((x) => x.code === b.plan);
  if (!pl?.price) throw new HttpError(422, 'BUSINESS_RULE', 'Cette formule se souscrit sur devis.', undefined, { rule: 'RG-ABO-01' });
  if (!paymentMethods.some((m) => m.code === b.method)) throw new HttpError(422, 'VALIDATION_ERROR', 'Moyen de paiement indisponible.', { method: 'moyen de paiement non disponible' });
  if (!b.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.id)) throw new HttpError(422, 'VALIDATION_ERROR', 'Identifiant de paiement invalide.', { id: 'UUID v4 attendu' });
  const key = [b.account_id, b.plan, b.period, b.method, phone].join('|');
  // idempotence : meme id = meme paiement, meme issue ; autre demande avec le meme id = 409
  const known = payments.find((x) => x.idem?.id === b.id);
  if (known) {
    if (known.idem?.key !== key) throw new HttpError(409, 'CONFLICT', 'Identifiant de paiement déjà utilisé pour une autre demande', undefined, { rule: 'PAY-IDEMPOTENCY' });
    if (known.status === 'echoue') throw new HttpError(422, 'BUSINESS_RULE', 'Paiement refusé.', undefined, { rule: 'PAY-INIT', payment_id: known.id, replayed: true });
    if (known.error_code && !known.provider_ref && known.status !== 'confirme') throw new HttpError(422, 'BUSINESS_RULE', 'Issue du paiement inconnue.', undefined, { rule: 'PAY-PENDING', payment_id: known.id, status: known.status, replayed: true });
    return { payment_id: known.id, status: 'initie', ussd_push: true, amount: known.amount, replayed: true };
  }
  // garde serveur : un compte n'a qu'un abonnement, donc un seul paiement ouvert toutes formules confondues (409 PAY-OPEN avec le paiement existant)
  const open = payments.find((x) => x.sim && x.payer_id === (user?.id ?? '') && ['initie', 'en_attente', 'a_verifier'].includes(x.status));
  if (open) throw new HttpError(409, 'CONFLICT', 'Un paiement est déjà en cours pour ce compte.', undefined, { rule: 'PAY-OPEN', payment_id: open.id, status: open.status, plan: open.plan });
  // confirm_repeat : un UUID (comme @Matches cote serveur), sinon 422
  const confirm = (body as { confirm_repeat?: unknown }).confirm_repeat;
  if (confirm !== undefined && !(typeof confirm === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(confirm))) throw new HttpError(422, 'VALIDATION_ERROR', 'Requête invalide.', { confirm_repeat: 'UUID attendu' });
  // PAY-RECENT : un paiement du compte confirme il y a moins de 30 min (PAYMENT_RECENT_GUARD_MIN par defaut) exige confirm_repeat = id de ce paiement (meme checkout, meme id)
  const recent = payments.find((x) => x.sim && x.payer_id === (user?.id ?? '') && x.status === 'confirme' && x.paid_at && Date.now() - Date.parse(x.paid_at) < 30 * 60_000);
  if (recent && confirm !== recent.id) throw new HttpError(409, 'CONFLICT', `Vous avez déjà payé la formule ${recent.plan ?? ''} il y a 1 min. Confirmez pour payer encore.`, undefined, { rule: 'PAY-RECENT', payment_id: recent.id, plan: recent.plan, paid_at: recent.paid_at });
  const amount = b.period === 'yearly' ? pl.price.yearly : pl.price.monthly;
  const pay: MockPayment = {
    id: uid(),
    status: 'initie',
    plan: b.plan,
    period: b.period === 'yearly' ? 'annuel' : 'mensuel',
    amount: amount ?? undefined,
    method: b.method,
    created: Date.now(),
    created_at: new Date().toISOString(),
    phone,
    sim: true,
    idem: { id: b.id, key },
    payer_type: 'user',
    payer_id: user?.id ?? '',
    connector: null,
    error_code: null,
    poll: null,
    refund: null,
  };
  payments.push(pay);
  // simulateur : numeros finissant par 97 -> refus explicite (PAY-INIT), par 96 -> issue inconnue (PAY-PENDING)
  if (phone.endsWith('97')) {
    pay.status = 'echoue';
    pay.error_code = 'refus_operateur';
    throw new HttpError(422, 'BUSINESS_RULE', 'Paiement refusé.', undefined, { rule: 'PAY-INIT', payment_id: pay.id });
  }
  if (phone.endsWith('96')) {
    pay.status = 'en_attente';
    pay.error_code = 'timeout';
    throw new HttpError(422, 'BUSINESS_RULE', 'Issue du paiement inconnue.', undefined, { rule: 'PAY-PENDING', payment_id: pay.id, status: 'en_attente' });
  }
  return json(201, { payment_id: pay.id, status: 'initie', ussd_push: true, amount: pay.amount }); // 201 comme le serveur
});
on('GET', '/payments/:id', ({ user }, p) => {
  const u = need(user);
  const pay = payments.find((x) => x.id === p.id);
  if (!pay) throw notFound();
  // proprietaire ou role plateforme (comme getPayment cote API)
  if (pay.payer_id !== u.id && u.platform_roles.length === 0) throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas accès à cette fonction.");
  if (pay.sim) {
    const age = Date.now() - pay.created;
    // simulator: confirms after ~6 s; numbers ending in 99 fail, ending in 98 never answer (timeout demo), 95 -> a_verifier
    if (pay.phone.endsWith('98')) pay.status = 'en_attente';
    else if (pay.phone.endsWith('95') && age > 3000) pay.status = 'a_verifier';
    else if (age > 6000) pay.status = pay.phone.endsWith('99') ? 'echoue' : 'confirme';
    else if (age > 1500) pay.status = 'en_attente';
    if (pay.status === 'confirme') {
      pay.paid_at ??= new Date().toISOString();
      subscription.plan = plans.find((x) => x.price && x.price.monthly?.amount_minor === pay.amount?.amount_minor)?.code ?? subscription.plan;
    }
  }
  return { id: pay.id, status: pay.status, amount: pay.amount, method: pay.method, updated_at: new Date().toISOString() };
});

/* ------------------------------------------- administration des paiements */

const platformRole = (u: MockUser | null, ...roles: string[]): MockUser => {
  const x = need(u);
  if (!x.platform_roles.includes('platform_admin') && !roles.some((r) => (x.platform_roles as string[]).includes(r))) throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas accès à cette fonction.");
  return x;
};
const adminView = (p: MockPayment) => {
  const { created: _c, phone: _p, sim: _s, idem: _i, ...rest } = p;
  return rest;
};
on('GET', '/admin/payments/reconciliations', ({ user, query }) => {
  platformRole(user, 'ops', 'support');
  const day = query.get('day');
  return page(reconciliations.filter((r) => !day || r.day === day));
});
on('POST', '/admin/payments/reconciliations', ({ user, body }) => {
  platformRole(user);
  const day = (body as { day?: string })?.day ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(422, 'VALIDATION_ERROR', 'Jour invalide.', { day: 'AAAA-MM-JJ attendu' });
  const report: ReconciliationReport = {
    day,
    generated_at: new Date().toISOString(),
    totals: { payments: 0, confirmes: 0, confirmed_amounts: [] },
    confirmes_sans_abonnement: [],
    abonnements_sans_paiement: [],
    divergences: [],
    non_verifies: [],
    erreurs: [],
    complet: true,
    sources: [],
  };
  const i = reconciliations.findIndex((r) => r.day === day);
  if (i >= 0) reconciliations[i] = report;
  else reconciliations.unshift(report);
  return report;
});
on('GET', '/admin/payments', ({ user, query }) => {
  platformRole(user, 'ops', 'support');
  const st = query.get('status');
  return page(payments.filter((p) => !st || p.status === st).sort((a, b) => b.created - a.created).map(adminView));
});
on('POST', '/admin/payments/:id/check', ({ user }, p) => {
  platformRole(user, 'ops');
  const pay = payments.find((x) => x.id === p.id);
  if (!pay) throw notFound();
  if (!['initie', 'en_attente', 'a_verifier'].includes(pay.status)) return { id: pay.id, status: pay.status, checked: false };
  pay.poll = { count: (pay.poll?.count ?? 0) + 1, last_at: new Date().toISOString(), last: 'CONFIRMED' };
  pay.status = 'confirme';
  pay.paid_at = new Date().toISOString();
  return { id: pay.id, status: pay.status, checked: true, outcome: 'confirme' };
});
on('POST', '/admin/payments/:id/refund', ({ user, body }, p) => {
  const u = platformRole(user);
  const pay = payments.find((x) => x.id === p.id);
  if (!pay) throw notFound();
  const reason = String((body as { reason?: string })?.reason ?? '');
  if (reason.length < 5 || reason.length > 300) throw new HttpError(422, 'VALIDATION_ERROR', 'Motif invalide.', { reason: 'entre 5 et 300 caractères' });
  if (pay.status === 'rembourse') return { id: pay.id, status: pay.status };
  if (pay.status === 'remboursement_en_cours') {
    // regle du serveur : 409 seulement si en_attente, ou en_cours depuis moins de 10 min ; sinon relance avec la meme reference
    const st = pay.refund?.status;
    const age = Date.now() - Date.parse(pay.refund?.requested_at ?? '');
    if (st === 'en_attente' || (st === 'en_cours' && age < 10 * 60_000)) throw new HttpError(409, 'CONFLICT', 'Un remboursement est déjà en cours pour ce paiement.', undefined, { rule: 'PAY-REFUND-IN-PROGRESS', refund_status: st });
  } else if (pay.status !== 'confirme') throw new HttpError(422, 'BUSINESS_RULE', 'Seul un paiement confirmé peut être remboursé.', undefined, { rule: 'PAY-REFUND-STATUS', status: pay.status });
  pay.status = 'rembourse';
  pay.refund = { ...pay.refund, id: pay.refund?.id ?? uid(), status: 'rembourse', reason, requested_at: new Date().toISOString(), requested_by: u.id, done_at: new Date().toISOString() };
  return adminView(pay);
});

/* ----------------------------------------------------- import / export */

const imports = new Map<string, { rows: Record<string, string>[] }>();
on('POST', '/imports', async ({ form }) => {
  const file = form?.get('file');
  if (!(file instanceof Blob)) throw new HttpError(422, 'VALIDATION_ERROR', 'Fichier manquant.', { file: 'fichier CSV attendu' });
  const text = await file.text();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new HttpError(422, 'VALIDATION_ERROR', 'Le fichier est vide.', { file: 'aucune ligne' });
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const required = ['phone', 'name', 'farm_name', 'region', 'speculations'];
  const missing = required.filter((r) => !head.includes(r));
  if (missing.length) throw new HttpError(422, 'VALIDATION_ERROR', `Colonnes manquantes : ${missing.join(', ')}.`, { file: 'en-têtes attendus : ' + required.join(',') });
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim()])));
  const errors: { row: number; field: string; message: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 2;
    const ph = (r.phone ?? '').replace(/\s/g, '');
    if (!/^\+?2376\d{8}$/.test(ph)) errors.push({ row: n, field: 'phone', message: 'Numéro camerounais attendu (+237 6XX XX XX XX)' });
    else if (seen.has(ph)) errors.push({ row: n, field: 'phone', message: 'Numéro en double dans le fichier' });
    seen.add(ph);
    if (!r.name) errors.push({ row: n, field: 'name', message: 'Nom obligatoire' });
    if (!r.farm_name) errors.push({ row: n, field: 'farm_name', message: "Nom d'exploitation obligatoire" });
    const sp = (r.speculations ?? '').split(/[|/ ]+/).filter(Boolean);
    const bad = sp.filter((s) => !['volaille', 'chien', 'porcin', 'petits_ruminants', 'bovin', 'lapin'].includes(s));
    if (!sp.length || bad.length) errors.push({ row: n, field: 'speculations', message: bad.length ? `Filière inconnue : ${bad.join(', ')}` : 'Au moins une filière' });
  });
  const id = uid();
  imports.set(id, { rows });
  const badRows = new Set(errors.map((e) => e.row));
  return { job_id: id, valid_rows: rows.length - badRows.size, errors, preview: rows.slice(0, 50), total_rows: rows.length };
});
on('POST', '/imports/:id/commit', (_c, p) => {
  const job = imports.get(p.id);
  if (!job) throw notFound();
  imports.delete(p.id);
  return { created: Math.max(0, job.rows.length - 1), updated: job.rows.length ? 1 : 0, skipped: 0 };
});
on('POST', '/exports', ({ body }) => {
  const b = body as { scope: string; period: string };
  let csv = '';
  if (b.scope === 'farms') csv = 'id,name,owner_name,owner_phone,region,speculations\n' + farms.map((f) => [f.id, f.name, f.owner_name, f.owner_phone, f.region, f.speculations.join('|')].join(',')).join('\n');
  else if (b.scope === 'reminders') csv = 'id,farm,subject,disease,due_date,status\n' + reminders.map((r) => [r.id, r.farm_name, r.subject_ref, r.disease, r.due_date, r.status].join(',')).join('\n');
  else csv = 'id,farm,subject,disease,event_date\n' + reminders.filter((r) => r.status === 'confirme').map((r) => [r.id, r.farm_name, r.subject_ref, r.disease, r.due_date].join(',')).join('\n');
  return new Response('\uFEFF' + csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="recallfarm-${b.scope}-${b.period}.csv"` } });
});

/* --------------------------------------------------------------- studio */

on('GET', '/params/packs/:code/versions/:version', (_c, p) => {
  const v = versions.find((x) => x.pack === p.code && x.version === p.version);
  if (!v) throw notFound();
  return { pack: v.pack, version: v.version, content: v.content };
});


const studioGuard = (u: MockUser) => {
  if (!u.platform_roles.some((r) => r.startsWith('param_') || r === 'platform_admin') && !u.memberships.some((m) => m.role === 'admin'))
    throw new HttpError(403, 'FORBIDDEN', 'Le studio est réservé aux référents de paramétrage.');
};
const findVersion = (id: string) => versions.find((v) => v.id === id) ?? (() => { throw notFound(); })();
const strip = <T extends { content?: unknown }>(v: T) => v; // content kept: GET /studio/versions/:id returns it

on('GET', '/studio/packs', ({ user }) => {
  studioGuard(need(user));
  const codes = [...new Set(versions.map((v) => v.pack))];
  return page(
    codes.map((code) => {
      const vs = versions.filter((v) => v.pack === code);
      const pub = [...vs].reverse().find((v) => v.status === 'publie');
      const draft = vs.find((v) => ['brouillon', 'en_revue', 'teste'].includes(v.status));
      return {
        code,
        ...packMeta[code],
        published_version: pub?.version ?? null,
        draft: draft ? { id: draft.id, version: draft.version, status: draft.status } : null,
        requires: (draft ?? pub)?.content.requires,
        updated_at: (draft ?? pub)?.updated_at,
      };
    }),
  );
});
on('GET', '/studio/packs/:code/versions', ({ user }, p) => {
  studioGuard(need(user));
  return page(versions.filter((v) => v.pack === p.code).map(({ content: _c, ...v }) => v));
});
on('POST', '/studio/packs/:code/versions', ({ user }, p) => {
  const u = need(user);
  studioGuard(u);
  const vs = versions.filter((v) => v.pack === p.code);
  if (vs.some((v) => ['brouillon', 'en_revue', 'teste'].includes(v.status))) throw new HttpError(409, 'CONFLICT', 'Un brouillon existe déjà pour ce pack.');
  const last = vs[vs.length - 1];
  if (!last) throw notFound();
  const [a, b] = last.version.split('.').map(Number);
  const nv = {
    ...structuredClone(last), id: uid(), version: `${a}.${b + 1}.0`, status: 'brouillon' as const, author_id: u.id, author_name: u.name,
    reviews: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: null, rollout_pct: null,
  };
  nv.content.version = nv.version;
  versions.push(nv);
  return nv;
});
on('GET', '/studio/versions/:id', ({ user }, p) => {
  studioGuard(need(user));
  return strip(findVersion(p.id));
});
on('PATCH', '/studio/versions/:id', ({ user, body }, p) => {
  const u = need(user);
  const v = findVersion(p.id);
  if (v.status !== 'brouillon') throw new HttpError(422, 'BUSINESS_RULE', 'Seul un brouillon est modifiable.', undefined, { rule: 'RG-PAR-03' });
  if (v.author_id !== u.id && !u.platform_roles.includes('platform_admin')) throw new HttpError(403, 'FORBIDDEN', "Seul l'auteur modifie son brouillon.");
  v.content = (body as { content: PackContent }).content;
  v.updated_at = new Date().toISOString();
  return v;
});

function validateContent(c: PackContent) {
  const errors: { path: string; message: string }[] = [];
  c.objects.forEach((o, i) => {
    const steps = (o.steps as { code: string; offset_days: number; condition?: string; after_step?: string; override?: { offset_days?: { min?: number; max?: number } } }[] | undefined) ?? [];
    steps.forEach((s, j) => {
      const b = s.override?.offset_days;
      if (!Number.isFinite(s.offset_days) || s.offset_days < 0) errors.push({ path: `objects[${i}].steps[${j}].offset_days`, message: 'Décalage positif attendu' });
      else if (b && (s.offset_days < (b.min ?? -Infinity) || s.offset_days > (b.max ?? Infinity)))
        errors.push({ path: `objects[${i}].steps[${j}].offset_days`, message: `${s.code} : ${s.offset_days} j hors des bornes pays (${b.min} – ${b.max} j)` });
      if (s.after_step && !steps.some((x) => x.code === s.after_step)) errors.push({ path: `objects[${i}].steps[${j}].after_step`, message: `Étape « ${s.after_step} » introuvable` });
      if (s.condition && /==\s*$|\(\s*$/.test(s.condition.trim())) errors.push({ path: `objects[${i}].steps[${j}].condition`, message: 'Expression incomplète' });
    });
  });
  return errors;
}
on('POST', '/studio/versions/:id/validate', (_c, p) => ({ errors: validateContent(findVersion(p.id).content) }));
on('POST', '/studio/versions/:id/test', (_c, p) => {
  const v = findVersion(p.id);
  const errs = validateContent(v.content);
  const tests = (v.content.tests as { name?: string }[] | undefined) ?? [];
  const results = tests.map((t, i) => ({ name: t.name ?? `cas_${i + 1}`, ok: errs.length === 0 || i >= errs.length, message: errs[i]?.message }));
  return { passed: results.filter((r) => r.ok).length, total: results.length, results, engines: 'serveur et mobile identiques' };
});
on('POST', '/studio/versions/:id/submit', ({ user }, p) => {
  const v = findVersion(p.id);
  if (v.status !== 'brouillon') throw new HttpError(422, 'BUSINESS_RULE', 'Cette version a déjà été soumise.', undefined, { rule: 'RG-PAR-03' });
  const errs = validateContent(v.content);
  if (errs.length) throw new HttpError(422, 'VALIDATION_ERROR', `${errs.length} erreur(s) de validation à corriger avant la relecture.`, Object.fromEntries(errs.map((e) => [e.path, e.message])));
  v.status = 'en_revue';
  v.submitted_at = new Date().toISOString();
  v.updated_at = v.submitted_at;
  need(user);
  return v;
});
on('POST', '/studio/versions/:id/reviews', ({ user, body }, p) => {
  const u = need(user);
  const v = findVersion(p.id);
  if (v.status !== 'en_revue') throw new HttpError(422, 'BUSINESS_RULE', "Cette version n'est pas en relecture.", undefined, { rule: 'RG-PAR-03' });
  if (v.author_id === u.id) throw new HttpError(422, 'BUSINESS_RULE', "L'auteur ne peut pas relire son propre pack.", undefined, { rule: 'RG-PAR-04' });
  if (!u.platform_roles.some((r) => r === 'param_reviewer' || r === 'platform_admin')) throw new HttpError(403, 'FORBIDDEN', 'La relecture est réservée aux réviseurs (param_reviewer).');
  const b = body as { decision: 'approuve' | 'refuse'; comments: string };
  v.reviews.push({ id: uid(), reviewer_id: u.id, reviewer_name: u.name, decision: b.decision, comments: b.comments, created_at: new Date().toISOString() });
  v.status = b.decision === 'approuve' ? 'teste' : 'brouillon';
  v.updated_at = new Date().toISOString();
  return v;
});
on('POST', '/studio/versions/:id/publish', ({ user, body }, p) => {
  const u = need(user);
  const v = findVersion(p.id);
  const level = v.content.level;
  if (v.author_id === u.id && level !== 'org')
    throw new HttpError(422, 'BUSINESS_RULE', "Un pack global, filière ou pays ne peut pas être publié par son auteur.", undefined, { rule: 'RG-PAR-04', author: v.author_name });
  if (!u.platform_roles.some((r) => r === 'param_publisher' || r === 'platform_admin')) throw new HttpError(403, 'FORBIDDEN', 'La publication est réservée aux publieurs (param_publisher).');
  if (v.status !== 'teste') throw new HttpError(422, 'BUSINESS_RULE', 'La version doit être relue et approuvée avant publication.', undefined, { rule: 'RG-PAR-03' });
  v.status = 'publie';
  v.published_at = new Date().toISOString();
  v.rollout_pct = (body as { rollout_pct?: number })?.rollout_pct ?? 100;
  return v;
});
on('POST', '/studio/packs/:code/rollback', ({ body }, p) => {
  const b = body as { to_version: string; reason: string };
  const target = versions.find((v) => v.pack === p.code && v.version === b.to_version);
  if (!target) throw notFound();
  const cur = [...versions].reverse().find((v) => v.pack === p.code && v.status === 'publie');
  if (cur) cur.status = 'retire';
  target.status = 'publie';
  return target;
});

function protocolsOf(c: PackContent): PackObject[] {
  return c.objects.filter((o) => o.kind === 'vaccination_protocol');
}
type Step = { code: string; label?: string; offset_days: number; condition?: string; after_step?: string; route?: string };
on('GET', '/studio/versions/:id/diff', (_c, p) => {
  const v = findVersion(p.id);
  const base = [...versions].reverse().find((x) => x.pack === v.pack && x.status === 'publie' && x.id !== v.id);
  if (!base) return { base_version: null, changes: [], major: true };
  const changes: { op: 'add' | 'remove' | 'change'; path: string; before?: unknown; after?: unknown }[] = [];
  const bp = new Map(protocolsOf(base.content).map((o) => [o.code, o]));
  for (const o of protocolsOf(v.content)) {
    const old = bp.get(o.code);
    if (!old) {
      changes.push({ op: 'add', path: `protocole ${o.code}` });
      continue;
    }
    const os = new Map(((old.steps as Step[]) ?? []).map((s) => [s.code, s]));
    const ns = (o.steps as Step[]) ?? [];
    for (const s of ns) {
      const prev = os.get(s.code);
      if (!prev) changes.unshift({ op: 'add', path: `etape ${s.code.replace(/_/g, '.').replace('.j3', '').replace('.j7', '')}` });
      else {
        if (prev.offset_days !== s.offset_days) changes.push({ op: 'change', path: `${s.code.split('_')[0]}.declencheur`, before: `+${prev.offset_days} j`, after: `+${s.offset_days} j` });
        if ((prev.condition ?? '') !== (s.condition ?? '')) changes.push({ op: 'change', path: `${s.code.split('_')[0]}.condition` });
        if ((prev.route ?? '') !== (s.route ?? '')) changes.push({ op: 'change', path: `${s.code.split('_')[0]}.voie`, before: prev.route, after: s.route });
      }
    }
    for (const s of os.values()) if (!ns.some((x) => x.code === s.code)) changes.push({ op: 'remove', path: `etape ${s.code}` });
  }
  const major = v.version.split('.')[0] !== base.version.split('.')[0];
  return { base_version: base.version, changes, major, impact: { subjects_recomputed: packMeta[v.pack]?.adoption_farms ?? 0 } };
});

on('POST', '/studio/simulate-protocol', ({ body }) => {
  const b = body as { version_id: string; protocol_code: string; birth_or_start_date: string };
  const v = findVersion(b.version_id);
  const proto = protocolsOf(v.content).find((o) => o.code === b.protocol_code);
  if (!proto) throw notFound();
  const steps = (proto.steps as (Step & { type?: string; short_label?: string; disease?: string })[]) ?? [];
  const at = new Map<string, number>();
  const resolve = (s: Step, depth = 0): number => {
    if (at.has(s.code)) return at.get(s.code)!;
    const prev = s.after_step && depth < 10 ? steps.find((x) => x.code === s.after_step) : undefined;
    const d = (prev ? resolve(prev, depth + 1) : 0) + Number(s.offset_days || 0);
    at.set(s.code, d);
    return d;
  };
  const events: ProtocolSimulation['events'] = steps.map((s) => ({
    step: s.code,
    disease: s.disease,
    label: s.short_label ?? s.label ?? s.code,
    offset_days: resolve(s),
    due_date: addDays(b.birth_or_start_date, resolve(s)),
    kind: s.type === 'vaccin' ? 'vaccin' : 'soin',
    conditional: !!s.condition,
    after_step: s.after_step ?? null,
    route: s.route,
  }));
  const end = proto.end as { label: string; offset_days: number } | undefined;
  if (end) events.push({ step: 'fin', label: end.label, offset_days: end.offset_days, due_date: addDays(b.birth_or_start_date, end.offset_days), kind: 'jalon' });
  events.sort((a, c) => a.offset_days - c.offset_days);
  return { protocol_code: proto.code, reference_date: b.birth_or_start_date, events, reminder_offsets: [-7, -1, 0, 3], withdrawal_applied: !!proto.withdrawal_meat };
});

/* ------------------------------------------------------------- transport */

export const mockTransport: Transport = async (method, url, init) => {
  const u = new URL(url, 'http://mock.local');
  const path = u.pathname.replace(/^\/v1/, '');
  const auth = init.headers.Authorization?.replace(/^Bearer /, '') ?? null;
  let body: unknown;
  let form: FormData | undefined;
  if (init.body instanceof FormData) form = init.body;
  else if (typeof init.body === 'string') body = JSON.parse(init.body);
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = userFromToken(auth);
    try {
      if (r.auth && !user) throw new HttpError(401, 'UNAUTHENTICATED', 'Jeton absent ou invalide.');
      const out = await r.h({ method, path, query: u.searchParams, body, form, user }, params);
      if (out instanceof Response) return out;
      return json(out === undefined ? 204 : 200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message, fields: e.fields, details: e.details } });
      console.error('[mock]', e);
      return json(500, { error: { code: 'SERVER_ERROR', message: String(e) } });
    }
  }
  return json(404, { error: { code: 'NOT_FOUND', message: `Route simulée inconnue : ${method} ${path}` } });
};

/** Sample signed payload for the /verifier demo (mock only). */
export function sampleCertificatePayload(): string {
  const u = addDays(today(), 3);
  const data = { a: 'Rex', s: 'chien', d: 'rage', e: addDays(u, -365), u };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.demo-ed25519-signature`;
}
