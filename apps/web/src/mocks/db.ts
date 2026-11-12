/** In-memory mock database seeded with the data of the designs (all fictitious). Dev/test only. */
import type {
  Alert,
  Batch,
  DailyLog,
  Dashboard,
  Dog,
  Farm,
  Me,
  Member,
  PackContent,
  PackVersion,
  AdminPayment,
  Payment,
  PaymentStatus,
  ReconciliationReport,
  PaymentMethodOption,
  Plan,
  Reminder,
  ReminderStatus,
  Speculation,
  StudioPack,
  Subscription,
} from '../api/types';
import globalCore from './packs/global.core.json';
import volaille from './packs/filiere.volaille.json';
import canin from './packs/filiere.canin.json';
import paysCM from './packs/pays.CM.json';
import { porcinPack } from './porcin';

/* deterministic PRNG so screenshots are stable */
let seed = 44;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

export const ORG_ID = 'b6a1c2d0-0c0f-4c55-9a43-1c0e6f2d4401';
const DAY = 86_400_000;
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
let idn = 1000;
export const uid = () => {
  idn++;
  return `00000000-0000-4000-8000-${String(idn).padStart(12, '0')}`;
};

/* --------------------------------------------------------------- users */

export interface MockUser extends Omit<Me, 'entitlements'> {
  plan: Plan['code'];
}

const ent = (plan: Plan['code']) => ({
  plan,
  features: plan === 'structure' ? ['tableau_bord_org', 'campagnes', 'import_masse', 'multi_utilisateurs', 'studio_org'] : [],
  quotas: { sms_per_month: plan === 'structure' ? 5000 : 60 },
  expires_at: '2027-03-31T23:59:59Z',
  grace_until: '2027-04-14T23:59:59Z',
  token: 'eyJhbGciOiJFZERTQSJ9.mock.sig',
});

export const users: MockUser[] = [
  {
    id: 'u-marthe',
    phone: '+237690000001',
    name: 'Marthe Ngo Bayiha',
    language: 'fr',
    platform_roles: [],
    memberships: [],
    farms: [{ id: 'f-mfou', name: 'Ferme de Mfou' }],
    plan: 'pro',
  },
  {
    id: 'u-aicha',
    phone: '+237690000002',
    name: 'Aïcha Nana',
    language: 'fr',
    platform_roles: [],
    memberships: [{ organisation_id: ORG_ID, organisation_name: 'Coop. avicole du Centre', role: 'admin' }],
    farms: [],
    plan: 'structure',
  },
  {
    id: 'u-jeanmarc',
    phone: '+237690000003',
    name: 'Jean-Marc',
    language: 'fr',
    platform_roles: ['param_author'],
    memberships: [],
    farms: [],
    plan: 'decouverte',
  },
  {
    id: 'u-mbarga',
    phone: '+237690000004',
    name: 'Dr Mbarga',
    language: 'fr',
    platform_roles: ['param_reviewer', 'param_publisher', 'referent_sanitaire'],
    memberships: [],
    farms: [],
    plan: 'decouverte',
  },
  {
    id: 'u-super',
    phone: '+237690000009',
    name: 'Super admin',
    language: 'fr',
    platform_roles: ['platform_admin', 'param_author', 'param_reviewer', 'param_publisher'],
    memberships: [{ organisation_id: ORG_ID, organisation_name: 'Coop. avicole du Centre', role: 'admin' }],
    farms: [],
    plan: 'institution',
  },
];

export const meOf = (u: MockUser): Me => {
  const { plan, ...rest } = u;
  return { ...rest, entitlements: ent(plan) };
};

/* --------------------------------------------------------------- farms */

const zones = ['Mfou', 'Obala', 'Soa', 'Okola', 'Esse', 'Mbalmayo', 'Nkolafamba', 'Awaé', 'Monatélé', 'Sa’a', 'Evodoula', 'Bikok', 'Mbankomo', 'Nkoteng', 'Akono'];
const owners = ['M. Essomba', 'Mme Biyong', 'GIC Les Pionniers', 'Paul Mvondo', 'Ruth Abena', 'Joseph Owona', 'Clarisse Ndzana', 'Hervé Atangana', 'Sylvie Mbida', 'Samuel Ekani', 'Brigitte Nkoa', 'Alain Fouda', 'Thérèse Manga', 'Martin Onana', 'Pauline Etoundi', 'Eric Tsala', 'Odile Menye', 'Patrice Ze', 'Irène Bella', 'Gaston Mbarga', 'Nadège Ayissi', 'Luc Messi'];

export const farms: Farm[] = [
  {
    id: 'f-mfou', name: 'Ferme de Mfou', speculations: ['volaille', 'chien'], country: 'CM', region: 'Centre · Mfou', currency: 'XAF',
    gps_lat: 3.72, gps_lng: 11.64, organisation_id: ORG_ID, owner_name: 'Marthe Ngo Bayiha', owner_phone: '+237690000001', has_smartphone: true,
    last_sync_at: hoursAgo(1), open_reminders: 3, overdue_reminders: 0, open_alerts: 1, subjects_count: 2178,
  },
  {
    id: 'f-biyong', name: 'Ferme Biyong', speculations: ['volaille'], country: 'CM', region: 'Centre · Obala', currency: 'XAF', organisation_id: ORG_ID,
    owner_name: 'Mme Biyong', owner_phone: '+237677120344', has_smartphone: true, last_sync_at: hoursAgo(2), open_reminders: 2, overdue_reminders: 1, open_alerts: 1, subjects_count: 860,
  },
  {
    id: 'f-pionniers', name: 'GIC Les Pionniers', speculations: ['volaille'], country: 'CM', region: 'Centre · Soa', currency: 'XAF', organisation_id: ORG_ID,
    owner_name: 'GIC Les Pionniers', owner_phone: '+237699443120', has_smartphone: false, last_sync_at: hoursAgo(80), open_reminders: 4, overdue_reminders: 2, open_alerts: 0, subjects_count: 1200,
  },
  {
    id: 'f-essomba', name: 'Élevage Essomba', speculations: ['volaille'], country: 'CM', region: 'Centre · Mfou', currency: 'XAF', organisation_id: ORG_ID,
    owner_name: 'M. Essomba', owner_phone: '+237675009812', has_smartphone: true, last_sync_at: hoursAgo(20), open_reminders: 1, overdue_reminders: 0, open_alerts: 0, subjects_count: 540,
  },
];
for (let i = 0; i < 26; i++) {
  const owner = owners[(i + 4) % owners.length];
  const zone = zones[(i * 7) % zones.length];
  const spec: Speculation[] = i % 7 === 3 ? ['volaille', 'chien'] : i % 9 === 5 ? ['chien'] : ['volaille'];
  farms.push({
    id: `f-${i + 10}`,
    name: i % 3 === 0 ? `Ferme ${owner.split(' ').pop()}` : i % 3 === 1 ? `Élevage ${owner.split(' ').pop()}, ${zone}` : `GIC ${pick(['Espoir', 'Avenir', 'Union', 'Renouveau', 'Solidarité'])} de ${zone}`,
    speculations: spec,
    country: 'CM',
    region: `Centre · ${zone}`,
    currency: 'XAF',
    organisation_id: ORG_ID,
    owner_name: owner,
    owner_phone: `+2376${String(70000000 + Math.floor(rnd() * 29999999))}`,
    has_smartphone: rnd() > 0.25,
    last_sync_at: hoursAgo(Math.floor(rnd() * 120)),
    open_reminders: Math.floor(rnd() * 6),
    overdue_reminders: Math.floor(rnd() * 3),
    open_alerts: rnd() > 0.85 ? 1 : 0,
    subjects_count: 100 + Math.floor(rnd() * 3000),
  });
}

export const batches: Record<string, Batch[]> = {
  'f-mfou': [
    {
      id: 'b-01', name: 'B01', species: 'volaille', production_type: 'ponte', start_date: '2026-03-02', initial_count: 2000, current_count: 1980,
      attributes: { strain: 'ISA Brown', supplier: 'Couvoir de Mvog-Betsi' }, param_version: 'global.core@1.4.0+filiere.volaille@2.1.0+pays.CM@1.3.2',
    },
    {
      id: 'b-02', name: 'B02', species: 'volaille', production_type: 'chair', start_date: '2026-10-08', initial_count: 200, current_count: 197,
      attributes: { strain: 'Cobb 500' }, param_version: 'global.core@1.4.0+filiere.volaille@2.1.0+pays.CM@1.3.2',
    },
  ],
};
export const dogs: Record<string, Dog[]> = {
  'f-mfou': [
    {
      id: 'd-rex', name: 'Rex', breed: 'Berger allemand', sex: 'M', birth_date: '2023-05-14', chip_number: '120093000418271',
      attributes: { color: 'Noir et feu', weight_kg: 34, role: 'garde' }, rabies_status: 'a_jour', rabies_valid_until: '2026-10-30',
    },
  ],
};

export function batchesOf(farmId: string): Batch[] {
  if (batches[farmId]) return batches[farmId];
  const f = farms.find((x) => x.id === farmId);
  if (!f?.speculations.includes('volaille')) return [];
  const n = (f.subjects_count ?? 500) - 20;
  return [
    {
      id: `${farmId}-b1`, name: 'B01', species: 'volaille', production_type: 'ponte', start_date: '2026-04-11', initial_count: n, current_count: n - 23,
      attributes: { strain: 'Lohmann Brown' }, param_version: 'global.core@1.4.0+filiere.volaille@2.1.0+pays.CM@1.3.2',
    },
  ];
}
export function dogsOf(farmId: string): Dog[] {
  if (dogs[farmId]) return dogs[farmId];
  const f = farms.find((x) => x.id === farmId);
  if (!f?.speculations.includes('chien')) return [];
  return [
    { id: `${farmId}-d1`, name: 'Bella', breed: 'Malinois', sex: 'F', birth_date: '2024-02-01', chip_number: '120093000512004', attributes: {}, rabies_status: 'expire', rabies_valid_until: '2026-09-12' },
  ];
}

export function logsOf(farmId: string): DailyLog[] {
  const subs = batchesOf(farmId);
  const out: DailyLog[] = [];
  for (let d = 0; d < 7; d++) {
    for (const b of subs) {
      const ponte = b.production_type === 'ponte';
      out.push({
        id: `${b.id}-log-${d}`,
        subject_type: 'batch',
        subject_id: b.id,
        subject_name: `Bande ${b.name}`,
        log_date: addDays(today(), -d),
        mortality: [3, 1, 0, 2, 1, 0, 0][d],
        present_count: b.current_count + d,
        eggs: ponte ? 1512 - d * 9 : null,
        feed_kg: ponte ? 236 : 24 + d,
        water_l: ponte ? 480 : 52,
        notes: d === 0 && ponte ? 'RAS, ramassage à 8 h et 15 h' : null,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------- reminders */

const diseases = [
  ['newcastle', 'Newcastle'],
  ['gumboro', 'Gumboro'],
  ['variole_aviaire', 'Variole aviaire'],
  ['rage', 'Rage'],
  ['marek', 'Marek'],
] as const;

export const reminders: Reminder[] = [];
function pushReminder(status: ReminderStatus, dueOffset: number, farm: Farm, disease: (typeof diseases)[number], subject = 'Bande B01') {
  reminders.push({
    id: uid(),
    farm_id: farm.id,
    farm_name: farm.name,
    subject_type: disease[0] === 'rage' ? 'dog' : 'batch',
    subject_id: 'x',
    subject_ref: disease[0] === 'rage' ? subject.replace('Bande B01', '« Bella »') : subject,
    disease: disease[0],
    label: disease[1],
    step: `${disease[0]}_rappel`,
    due_date: addDays(today(), dueOffset),
    status,
    priority: disease[0] === 'rage' || disease[0] === 'newcastle' ? 'haute' : 'normale',
    kind: 'protocole',
  });
}
const mfou = farms[0];
pushReminder('aujourdhui', 0, mfou, diseases[0], 'Bande B02 · 197 sujets');
reminders.push({
  id: uid(), farm_id: 'f-mfou', farm_name: 'Ferme de Mfou', subject_type: 'dog', subject_id: 'd-rex', subject_ref: '« Rex » · berger allemand',
  disease: 'rage', label: 'Rage', step: 'rage_recurrent', due_date: addDays(today(), 3), status: 'a_venir', priority: 'critique', kind: 'recurrent',
});
pushReminder('a_venir', 9, mfou, diseases[1], 'Bande B02 · 197 sujets');
pushReminder('en_retard', -3, farms[2], diseases[1], 'Bande B03 · 1 200 sujets');
for (let i = 0; i < 47; i++) pushReminder('en_retard', -1 - (i % 9), farms[4 + (i % 26)], pick([...diseases]), `Bande B0${1 + (i % 4)}`);
for (let i = 0; i < 9; i++) pushReminder('aujourdhui', 0, farms[3 + i * 2], pick([...diseases]));
for (let i = 0; i < 22; i++) pushReminder('a_venir', 1 + (i % 14), farms[4 + ((i * 3) % 26)], pick([...diseases]));
for (let i = 0; i < 30; i++) {
  pushReminder('confirme', -(i % 12), farms[4 + ((i * 5) % 26)], pick([...diseases]));
  reminders[reminders.length - 1].confirmed_at = hoursAgo(i * 6 + 1);
}

/* -------------------------------------------------------------- alerts */

export const alerts: Alert[] = [
  {
    id: uid(), farm_id: 'f-biyong', farm_name: 'Ferme Biyong, Obala', rule_code: 'mortalite_journaliere', title: 'Mortalité anormale',
    message: 'Mortalité 6,8 % en 48 h sur la bande B01 · suspicion de maladie', severity: 'critique', status: 'escaladee', opened_at: hoursAgo(2),
    escalation: [
      { level: 1, target: 'Propriétaire', at: hoursAgo(2), done: true },
      { level: 2, target: 'Astreinte coopérative', at: hoursAgo(1.75), done: true },
    ],
  },
  {
    id: uid(), farm_id: 'f-mfou', farm_name: 'Ferme de Mfou', rule_code: 'temperature_poulailler', title: 'Chaleur · Poulailler 2',
    message: '31,4 °C, seuil 32 °C dans 6 min', severity: 'attention', status: 'ouverte', opened_at: hoursAgo(0.2),
  },
  {
    id: uid(), farm_id: 'f-14', farm_name: farms[8].name, rule_code: 'chute_ponte', title: 'Chute de ponte',
    message: 'Taux de ponte 58 % (seuil 60 %) sur 3 jours', severity: 'attention', status: 'ouverte', opened_at: hoursAgo(26),
  },
  {
    id: uid(), farm_id: 'f-essomba', farm_name: 'Élevage Essomba', rule_code: 'stock_peremption', title: 'Vaccin bientôt périmé',
    message: 'Stock vaccin Newcastle périmé dans 4 j', severity: 'info', status: 'acquittee', opened_at: hoursAgo(30), acked_at: hoursAgo(20), acked_by: 'Aïcha Nana',
  },
  {
    id: uid(), farm_id: 'f-12', farm_name: farms[6].name, rule_code: 'mortalite_journaliere', title: 'Mortalité anormale',
    message: 'Mortalité 2,4 % en 24 h', severity: 'critique', status: 'resolue', opened_at: hoursAgo(120), acked_at: hoursAgo(119), resolved_at: hoursAgo(100),
    cause: 'chaleur', action: 'Ventilateur remplacé, abreuvement renforcé',
  },
];

/* ------------------------------------------------------------- members */

export const members: Member[] = [
  { id: uid(), user_id: 'u-aicha', name: 'Aïcha Nana', phone: '+237690000002', role: 'admin', status: 'actif', joined_at: '2026-02-03T09:00:00Z', last_seen_at: hoursAgo(0.1) },
  { id: uid(), user_id: 'u-paul', name: 'Paul Mvondo', phone: '+237677451209', role: 'agent', status: 'actif', joined_at: '2026-03-11T09:00:00Z', last_seen_at: hoursAgo(72) },
  { id: uid(), user_id: 'u-mbarga', name: 'Dr Mbarga', phone: '+237690000004', role: 'veterinaire', status: 'actif', joined_at: '2026-03-15T09:00:00Z', last_seen_at: hoursAgo(5) },
  { id: uid(), user_id: 'u-ruth', name: 'Ruth Abena', phone: '+237699120876', role: 'agent', status: 'actif', joined_at: '2026-05-20T09:00:00Z', last_seen_at: hoursAgo(9) },
  { id: uid(), user_id: 'u-herve', name: 'Hervé Atangana', phone: '+237655781233', role: 'membre', status: 'actif', joined_at: '2026-06-02T09:00:00Z', last_seen_at: hoursAgo(50) },
  { id: uid(), name: null, phone: '+237670334455', role: 'agent', status: 'invite', joined_at: null, last_seen_at: null },
];

/* ---------------------------------------------------------- dashboard */

const W_DUE = [360, 373, 383, 400, 393, 420, 433, 447, 460, 473, 493, 508];
const W_CONF = [173, 200, 220, 253, 263, 300, 327, 353, 380, 403, 427, 444];

export function isoWeek(d = new Date()): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return { year: y, week: w };
}

export function dashboard(speculation?: string): Dashboard {
  const { year, week } = isoWeek();
  const canin = speculation === 'chien';
  const k = canin ? 0.18 : speculation === 'volaille' ? 0.9 : 1;
  return {
    kpis: {
      confirmed_rate: canin ? 91.2 : 87.4,
      confirmed_rate_delta_pts: canin ? 2.3 : 4.1,
      target_rate: 85,
      active_farmers_7d: Math.round(241 * k),
      total_farmers: Math.round(312 * k),
      farmers_without_smartphone: Math.round(64 * k),
      overdue_reminders: Math.round(48 * k),
      overdue_j3: Math.round(17 * k),
      avg_mortality_pct: canin ? 0.4 : 3.2,
      batches_over_threshold: canin ? 0 : 2,
      mortality_threshold_pct: 5,
    },
    weekly: W_DUE.map((due, i) => ({
      week: `${year}-W${String(week - 11 + i).padStart(2, '0')}`,
      due: Math.round(due * k),
      confirmed: Math.round(W_CONF[i] * k),
    })),
    coverage: {
      disease: canin ? 'rage' : 'newcastle',
      window_days: 30,
      cells: [
        { zone: 'Okola', rate: 0.93, masked: false, q: 0, r: 0, farms: 21 },
        { zone: 'Monatélé', rate: 0.86, masked: false, q: 1, r: 0, farms: 14 },
        { zone: 'Evodoula', rate: 0.95, masked: false, q: 2, r: 0, farms: 18 },
        { zone: 'Nkoteng', rate: null, masked: true, q: 3, r: 0, farms: 3 },
        { zone: 'Sa’a', rate: 0.84, masked: false, q: 0, r: 1, farms: 26 },
        { zone: 'Bikok', rate: 0.91, masked: false, q: 1, r: 1, farms: 19 },
        { zone: 'Soa', rate: 0.76, masked: false, q: 2, r: 1, farms: 33 },
        { zone: 'Esse', rate: 0.62, masked: false, q: 3, r: 1, farms: 12 },
        { zone: 'Awaé', rate: 0.78, masked: false, q: 4, r: 1, farms: 9 },
        { zone: 'Mfou', rate: 0.92, masked: false, q: 0, r: 2, farms: 41 },
        { zone: 'Nkolafamba', rate: 0.88, masked: false, q: 1, r: 2, farms: 17 },
        { zone: 'Mbalmayo', rate: 0.58, masked: false, q: 2, r: 2, farms: 22 },
        { zone: 'Obala', rate: 0.41, masked: false, q: 3, r: 2, farms: 28 },
        { zone: 'Mbankomo', rate: 0.74, masked: false, q: 1, r: 3, farms: 15 },
        { zone: 'Akono', rate: 0.85, masked: false, q: 2, r: 3, farms: 11 },
      ],
    },
    todo: canin
      ? [{ id: 't-c1', severity: 'elevee', farm_name: 'Ferme de Mfou', reason: 'Rage « Bella » expirée depuis 45 j', since: hoursAgo(24 * 45), action: 'Appeler', farm_id: 'f-mfou' }]
      : [
          { id: 't1', severity: 'critique', farm_name: 'Ferme Biyong, Obala', reason: 'Mortalité 6,8 % en 48 h · suspicion', since: hoursAgo(2), action: 'Envoyer un vétérinaire', farm_id: 'f-biyong' },
          { id: 't2', severity: 'elevee', farm_name: 'GIC Les Pionniers', reason: 'Gumboro J+3 non confirmé · 1 200 sujets', since: hoursAgo(72), action: 'Appeler', farm_id: 'f-pionniers' },
          { id: 't3', severity: 'elevee', farm_name: 'M. Essomba, Mfou', reason: 'Stock vaccin Newcastle périmé dans 4 j', since: hoursAgo(24), action: 'Réaffecter', farm_id: 'f-essomba' },
          { id: 't4', severity: 'info', farm_name: 'Agent : Paul M.', reason: '14 saisies non synchronisées depuis 3 j', since: hoursAgo(72), action: 'Relancer' },
        ],
    params: [
      { pack: 'global.core', version: '1.4.0', status: 'publie' },
      { pack: 'filiere.volaille', version: '2.1.0', status: 'publie' },
      { pack: 'pays.CM', version: '1.3.2', status: 'publie' },
      { pack: 'org.coop-centre', version: '0.3.0', status: 'en_revue' },
    ],
    pending_change: { summary: "2 champs ajoutés au journal (poids d'œuf, lot d'aliment).", reviewer_name: 'Dr Mbarga', pack: 'org.coop-centre' },
    sms: { used: 3412, quota: 5000 },
  };
}

/* --------------------------------------------------------------- plans */

export const plans: Plan[] = [
  { code: 'decouverte', name: 'Découverte', rank: 0, features: ['carnet', 'rappels_locaux', 'journal', 'stocks', 'ventes', 'marche'], quotas: { farms: 1, cameras: 0, sms_per_month: 0 }, price: { monthly: { amount_minor: 0, currency: 'XAF' }, yearly: { amount_minor: 0, currency: 'XAF' } } },
  { code: 'pro', name: 'Pro', rank: 1, features: ['rappels_sms', 'rappels_whatsapp', 'certificat_qr', 'genealogie', 'tresorerie', 'simulateur', 'facturation'], quotas: { farms: 3, cameras: 2, sms_per_month: 60 }, price: { monthly: { amount_minor: 2500, currency: 'XAF' }, yearly: { amount_minor: 25000, currency: 'XAF' } } },
  { code: 'structure', name: 'Structure', rank: 2, features: ['multi_utilisateurs', 'mode_agent', 'import_masse', 'campagnes', 'studio_org', 'tableau_bord_org'], quotas: { farms: 1000, cameras: 10, sms_per_month: 5000 }, price: { monthly: { amount_minor: 15000, currency: 'XAF' }, yearly: { amount_minor: 150000, currency: 'XAF' }, from: true } },
  { code: 'institution', name: 'Institution', rank: 3, features: ['surveillance', 'exports_dhis2', 'hebergement_souverain', 'api'], quotas: { farms: 100000, cameras: 50, sms_per_month: 100000 }, price: null },
];

/** Meme contenu que le pack pays CM (GET /plans -> payment_methods). */
export const paymentMethods: PaymentMethodOption[] = [
  { code: 'orange_money', label: 'Orange Money' },
  { code: 'mtn_momo', label: 'MTN MoMo' },
];

export const subscription: Subscription = {
  plan: 'structure', period: 'yearly', status: 'active', started_at: '2026-04-01T00:00:00Z', expires_at: '2027-03-31T23:59:59Z', grace_until: '2027-04-14T23:59:59Z',
  account_type: 'organisation', account_id: ORG_ID,
};

export interface MockPayment extends Payment {
  created: number;
  phone: string;
  /** Paiement simule par le suivi eleveur (confirme apres quelques secondes) ; faux pour les donnees d'administration. */
  sim: boolean;
  /** Cle d'idempotence du checkout (id envoye par le client) et empreinte de la demande. */
  idem?: { id: string; key: string };
  payer_type: 'user' | 'organisation';
  payer_id: string;
  connector: string | null;
  error_code: string | null;
  poll: AdminPayment['poll'];
  refund: AdminPayment['refund'];
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const seedPay = (id: string, status: PaymentStatus, plan: string, period: string, minor: number, method: string, minutesAgo: number, extra: Partial<MockPayment> = {}): MockPayment => ({
  id,
  status,
  purpose: 'abonnement',
  plan,
  period,
  amount: { amount_minor: minor, currency: 'XAF' },
  method,
  provider_ref: `PRV-${id.slice(-4).toUpperCase()}`,
  paid_at: status === 'confirme' || status === 'remboursement_en_cours' || status === 'rembourse' ? ago(minutesAgo - 1) : null,
  created_at: ago(minutesAgo),
  created: Date.now() - minutesAgo * 60_000,
  phone: '+237690000002',
  sim: false,
  payer_type: 'user',
  payer_id: 'u-690000002',
  connector: 'agregateur_cm',
  error_code: null,
  poll: null,
  refund: null,
  ...extra,
});

export const payments: MockPayment[] = [
  seedPay('00000000-0000-4000-8000-0000000000a1', 'a_verifier', 'pro', 'mensuel', 2500, 'orange_money', 190, { error_code: 'timeout', poll: { count: 6, last_at: ago(20), next_at: ago(-40), last: 'inconnu' } }),
  seedPay('00000000-0000-4000-8000-0000000000a2', 'confirme', 'structure', 'annuel', 150000, 'mtn_momo', 1500, { payer_type: 'organisation', payer_id: ORG_ID }),
  seedPay('00000000-0000-4000-8000-0000000000a3', 'en_attente', 'pro', 'mensuel', 2500, 'mtn_momo', 4, { poll: { count: 1, last_at: ago(1), next_at: ago(-1), last: 'PENDING' } }),
  seedPay('00000000-0000-4000-8000-0000000000a4', 'echoue', 'pro', 'annuel', 25000, 'orange_money', 3000, { error_code: 'refus_operateur' }),
  seedPay('00000000-0000-4000-8000-0000000000a5', 'remboursement_en_cours', 'pro', 'mensuel', 2500, 'orange_money', 2900, {
    refund: { id: '00000000-0000-4000-8000-0000000000b5', status: 'en_attente', reason: 'Double paiement constate par le support', requested_at: ago(30) },
  }),
  seedPay('00000000-0000-4000-8000-0000000000a6', 'rembourse', 'pro', 'mensuel', 2500, 'mtn_momo', 4400, {
    refund: { id: '00000000-0000-4000-8000-0000000000b6', status: 'rembourse', reason: 'Erreur de formule', requested_at: ago(4300), done_at: ago(4290), ref: 'RF-8841' },
  }),
];

export const reconciliations: ReconciliationReport[] = [
  {
    day: '2026-11-11',
    generated_at: '2026-11-12T01:05:00Z',
    totals: { payments: 4, confirmes: 2, confirmed_amounts: [{ amount_minor: 152500, currency: 'XAF' }] },
    confirmes_sans_abonnement: [{ payment_id: '00000000-0000-4000-8000-0000000000a2', payer_type: 'organisation', payer_id: ORG_ID, plan: 'structure' }],
    abonnements_sans_paiement: [],
    divergences: [{ connector: 'agregateur_cm', payment_id: '00000000-0000-4000-8000-0000000000a1', provider_ref: 'PRV-00A1', base: 'a_verifier', fournisseur: 'confirme', ecart: 'statut' }],
    non_verifies: [],
    erreurs: [],
    complet: true,
    sources: [{ connector: 'agregateur_cm', source: 'liste' }],
  },
  {
    day: '2026-11-10',
    generated_at: '2026-11-11T01:05:00Z',
    totals: { payments: 1, confirmes: 1, confirmed_amounts: [{ amount_minor: 2500, currency: 'XAF' }] },
    confirmes_sans_abonnement: [],
    abonnements_sans_paiement: [],
    divergences: [],
    non_verifies: [],
    erreurs: [],
    complet: true,
    sources: [{ connector: 'agregateur_cm', source: 'statut' }],
  },
];

/* -------------------------------------------------------------- studio */

const asContent = (x: unknown) => x as PackContent;
const bump = (c: PackContent, version: string): PackContent => ({ ...c, version });

export interface MockVersion extends PackVersion {
  content: PackContent;
  assigned_reviewer_name?: string;
}

export const versions: MockVersion[] = [];
function addVersion(v: Omit<MockVersion, 'reviews' | 'created_at' | 'updated_at'> & Partial<MockVersion>) {
  versions.push({ reviews: [], created_at: hoursAgo(24 * 40), updated_at: hoursAgo(24 * 40), ...v });
}
const published = (pack: string, version: string, content: PackContent, author = 'Jean-Marc') =>
  addVersion({ id: uid(), pack, version, status: 'publie', author_id: 'u-jeanmarc', author_name: author, content: bump(content, version), published_at: hoursAgo(24 * 30), rollout_pct: 100 });

published('global.core', '1.4.0', asContent(globalCore));
published('filiere.volaille', '2.1.0', asContent(volaille));
published('filiere.canin', '1.2.0', asContent(canin));
published('pays.CM', '1.3.2', asContent(paysCM));
published('filiere.porcin', '1.4.0', porcinPack(false));
addVersion({
  id: 'v-porcin-200', pack: 'filiere.porcin', version: '2.0.0', status: 'brouillon', author_id: 'u-jeanmarc', author_name: 'Jean-Marc',
  content: porcinPack(true), created_at: '2026-10-26T08:12:00Z', updated_at: hoursAgo(3), assigned_reviewer_name: 'Dr Mbarga',
});
addVersion({
  id: 'v-org-030', pack: 'org.coop-centre', version: '0.3.0', status: 'en_revue', author_id: 'u-aicha', author_name: 'Aïcha Nana', submitted_at: hoursAgo(20),
  assigned_reviewer_name: 'Dr Mbarga',
  content: {
    pack: 'org.coop-centre', version: '0.3.0', level: 'org', requires: { 'filiere.volaille': '^2.0.0' },
    objects: [
      {
        kind: 'form', code: 'daily_log_volaille', title: 'Journal volaille (ajouts coopérative)', applies_to: 'daily_log', species: 'volaille',
        override_mode: 'ajout_seulement',
        fields: [
          { code: 'egg_weight_g', type: 'decimal', label: 'poids_oeuf', unit: 'g', min: 30, max: 90, visible_if: "subject.production_type == 'ponte'" },
          { code: 'feed_lot', type: 'text', label: 'lot_aliment' },
        ],
      },
    ],
    i18n: { fr: { poids_oeuf: "Poids moyen d'un œuf", lot_aliment: "N° de lot d'aliment" } },
  },
});

export const packMeta: Record<string, Pick<StudioPack, 'level' | 'title' | 'adoption_farms'>> = {
  'global.core': { level: 'global', title: 'Socle commun : espèces, maladies, unités, formules', adoption_farms: 4120 },
  'filiere.volaille': { level: 'filiere', title: 'Volaille : chair, ponte, poulette', adoption_farms: 2985 },
  'filiere.canin': { level: 'filiere', title: 'Canin : élevage, dressage, pension', adoption_farms: 1210 },
  'filiere.porcin': { level: 'filiere', title: 'Porcins : naissage, engraissement', adoption_farms: 1284 },
  'pays.CM': { level: 'pays', title: 'Cameroun : protocoles, messages, prix', adoption_farms: 4120 },
  'org.coop-centre': { level: 'org', title: 'Coop. avicole du Centre', adoption_farms: 312 },
};

export const leads: { phone: string; name?: string; source: string; at: string }[] = [];
