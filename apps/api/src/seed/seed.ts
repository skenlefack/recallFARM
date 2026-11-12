import { INestApplicationContext, Logger } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { hashKey } from '../alerts/alerts.service';
import { addDays, todayIn } from '../common/dates';
import { KeysService } from '../common/keys.service';
import {
  AlertEvent, Batch, DailyLog, Device, Dog, Expense, Farm, FarmSettings, FeatureFlag, HealthEvent, Membership, Organisation, ParamPack,
  ParamPackVersion, ParamPublication, ParamReview, Reminder, Sale, StockMovement, StockThreshold, Subscription, Task, Telemetry, User,
} from '../database/entities';
import { RemindersService } from '../health/reminders.service';
import { LivestockService } from '../livestock/livestock.service';
import { PackDoc } from '../params/engine/types';
import { ParamsService } from '../params/params.service';
import { DEMO, demoId } from './demo';

const log = new Logger('Seed');

/** Small deterministic PRNG (mulberry32) so that the demo data is stable between runs. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ins<T extends ObjectLiteral>(ds: DataSource, entity: EntityTarget<T>, rows: unknown): Promise<void> {
  await ds.getRepository(entity).insert(rows as never);
}

async function insertIgnore<T extends ObjectLiteral>(ds: DataSource, entity: EntityTarget<T>, rows: Array<Partial<T>>, chunk = 400): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    await ds.createQueryBuilder().insert().into(entity).values(rows.slice(i, i + chunk) as never).orIgnore().execute();
  }
}

const ZONES: Array<{ name: string; farms: number; coverage: number; lat: number; lng: number; reliability: number }> = [
  { name: 'Obala', farms: 34, coverage: 0.45, lat: 4.168, lng: 11.533, reliability: 0.9 },
  { name: 'Mfou', farms: 38, coverage: 0.93, lat: 3.723, lng: 11.638, reliability: 1.06 },
  { name: 'Soa', farms: 31, coverage: 0.88, lat: 3.976, lng: 11.594, reliability: 1.04 },
  { name: 'Mbalmayo', farms: 33, coverage: 0.72, lat: 3.517, lng: 11.501, reliability: 1.0 },
  { name: 'Okola', farms: 22, coverage: 0.58, lat: 4.025, lng: 11.383, reliability: 0.95 },
  { name: 'Esse', farms: 18, coverage: 0.66, lat: 4.1, lng: 11.9, reliability: 0.97 },
  { name: 'Awaé', farms: 17, coverage: 0.81, lat: 3.97, lng: 11.9, reliability: 1.02 },
  { name: 'Nkolafamba', farms: 21, coverage: 0.9, lat: 3.85, lng: 11.68, reliability: 1.05 },
  { name: 'Monatélé', farms: 19, coverage: 0.52, lat: 4.267, lng: 11.2, reliability: 0.93 },
  { name: "Sa'a", farms: 20, coverage: 0.77, lat: 4.37, lng: 11.45, reliability: 1.0 },
  { name: 'Evodoula', farms: 16, coverage: 0.62, lat: 4.083, lng: 11.2, reliability: 0.96 },
  { name: 'Elig-Mfomo', farms: 14, coverage: 0.7, lat: 4.13, lng: 11.12, reliability: 0.98 },
  { name: 'Mbankomo', farms: 22, coverage: 0.85, lat: 3.783, lng: 11.383, reliability: 1.03 },
  { name: 'Bikok', farms: 3, coverage: 0.6, lat: 3.62, lng: 11.33, reliability: 1.0 },
  { name: 'Ngoumou', farms: 4, coverage: 0.5, lat: 3.583, lng: 11.3, reliability: 1.0 },
];

const FIRST = ['Jean', 'Paul', 'Marie', 'Françoise', 'Joseph', 'Pierre', 'Thérèse', 'Emmanuel', 'Christine', 'Alain', 'Hélène', 'Martin', 'Grâce', 'Serge', 'Odile', 'Didier', 'Cécile', 'Roger', 'Sylvie', 'Bernard', 'Brigitte', 'Victor', 'Pauline', 'Hervé'];
const LAST = ['Mbarga', 'Essomba', 'Atangana', 'Ndzana', 'Owona', 'Abena', 'Manga', 'Onana', 'Fouda', 'Mvondo', 'Ngono', 'Nkoulou', 'Ekani', 'Bilong', 'Tsala', 'Nga', 'Ayissi', 'Zambo', 'Mballa', 'Amougou', 'Elanga', 'Ondoa', 'Belinga', 'Edzoa', 'Mengue', 'Ateba'];

export interface SeedReport {
  packs: number;
  users: number;
  coopFarms: number;
  historyReminders: number;
}

export async function runSeed(app: INestApplicationContext, opts: { today?: string } = {}): Promise<SeedReport> {
  const ds = app.get(DataSource);
  const params = app.get(ParamsService);
  const reminders = app.get(RemindersService);
  const livestock = app.get(LivestockService);
  const keys = app.get(KeysService);
  const today = opts.today ?? todayIn();
  const now = new Date();
  const report: SeedReport = { packs: 0, users: 0, coopFarms: 0, historyReminders: 0 };

  // ---- 1. Parameter packs (signed) ---------------------------------------------------------
  report.packs = await params.ensureSourcePacks();

  // ---- 2. Demo accounts ----------------------------------------------------------------------
  const users: Array<Partial<User>> = [
    { id: demoId('user:marthe'), phone: DEMO.phones.marthe, full_name: 'Marthe Ngo Bayiha', platform_roles: [], last_active_at: now },
    { id: demoId('user:aicha'), phone: DEMO.phones.aicha, full_name: 'Aïcha Nana', platform_roles: [], last_active_at: now },
    { id: demoId('user:jean-marc'), phone: DEMO.phones.jeanMarc, full_name: 'Jean-Marc', platform_roles: ['param_author'], last_active_at: now },
    { id: demoId('user:mbarga'), phone: DEMO.phones.mbarga, full_name: 'Dr Mbarga', platform_roles: ['param_reviewer', 'param_publisher'], last_active_at: now },
    { id: demoId('user:paul'), phone: DEMO.phones.paul, full_name: 'Paul Mballa', platform_roles: [], last_active_at: new Date(now.getTime() - 3 * 86400_000) },
    { id: demoId('user:admin'), phone: DEMO.phones.admin, full_name: 'Super admin', platform_roles: ['platform_admin'], last_active_at: now },
  ].map((u) => ({ ...u, otp_verified: true, account_status: 'actif', locale: 'fr', country: 'CM', default_currency: 'XAF' }));
  for (const u of users) {
    const existing = await ds.getRepository(User).findOne({ where: { phone: u.phone! } });
    if (existing) {
      // Keep roles in sync with the documented demo accounts.
      await ds.getRepository(User).update({ id: existing.id }, { platform_roles: u.platform_roles, full_name: u.full_name });
      u.id = existing.id;
    } else await ins(ds, User, u);
  }
  const [marthe, aicha, jeanMarc, mbarga, paul] = users;

  // ---- 3. Organisation ------------------------------------------------------------------------
  await insertIgnore(ds, Organisation, [
    { id: DEMO.orgId, name: 'Coop. avicole du Centre', type: 'cooperative', country: 'CM', region: 'Centre', currency: 'XAF', plan: 'structure', settings: { target_rate: 85 } },
  ]);
  await insertIgnore(ds, Membership, [{ id: demoId('member:aicha'), user_id: aicha.id!, organisation_id: DEMO.orgId, role: 'admin', status: 'actif' }]);
  await insertIgnore(ds, Subscription, [
    {
      account_type: 'organisation', account_id: DEMO.orgId, plan: 'structure', period: 'annuel', price_minor: 150000, currency: 'XAF', payment_provider: 'mtn_momo',
      started_at: new Date(`${addDays(today, -295)}T08:00:00Z`), expires_at: new Date(`${addDays(today, 70)}T08:00:00Z`), grace_until: new Date(`${addDays(today, 77)}T08:00:00Z`), status: 'actif',
    },
    {
      account_type: 'user', account_id: marthe.id!, plan: 'pro', period: 'mensuel', price_minor: 2500, currency: 'XAF', payment_provider: 'orange_money',
      started_at: new Date(`${addDays(today, -10)}T08:00:00Z`), expires_at: new Date(`${addDays(today, 20)}T08:00:00Z`), grace_until: new Date(`${addDays(today, 27)}T08:00:00Z`), status: 'actif',
    },
  ]);

  // ---- 4. Marthe's "Ferme de Mfou" (mirrors the mobile mocks) -----------------------------
  const M = DEMO.marthe;
  const farmExists = await ds.getRepository(Farm).findOne({ where: { id: M.farmId }, withDeleted: true });
  if (!farmExists) await seedMarthe(ds, marthe.id!, today, now);
  for (const [t, id] of [['batch', M.b01], ['batch', M.b02], ['dog', M.rex], ['dog', M.nala]] as const) {
    if (t === 'batch') await livestock.recount(id);
    await reminders.recompute(t, id, { today });
  }

  // ---- 5a. Reset demo organisation state left by manual/e2e testing ------------------------
  await resetDemoOrg(ds, today);

  // ---- 5. Coop: 312 simulated farmers / farms + 12 weeks of reminders ------------------------
  const coopCount: Array<{ n: number }> = await ds.query(`SELECT count(*)::int AS n FROM farms WHERE organisation_id = $1`, [DEMO.orgId]);
  if (coopCount[0].n < 312) {
    const r = await seedCoop(ds, today, now, paul.id!);
    report.coopFarms = r.farms;
    report.historyReminders = r.reminders;
  }
  await insertIgnore(ds, Membership, [{ id: demoId('member:paul'), user_id: paul.id!, organisation_id: DEMO.orgId, role: 'agent', status: 'actif', farmer_scope: Array.from({ length: 20 }, (_, i) => demoId(`coop-farm:${i}`)) }]);

  // ---- 6. Organisation pack (0.2.0 published, 0.3.0 in review) ------------------------------
  await seedOrgPack(ds, keys, aicha.id!, mbarga.id!);

  // ---- 7. Feature flags -----------------------------------------------------------------------
  await insertIgnore(ds, FeatureFlag, [
    { key: 'ferme_connectee', description: 'Écran Ferme en direct (capteurs)', rules: { plans: ['pro', 'structure', 'institution'] }, enabled: true },
    { key: 'genealogie', description: 'Simulateur de saillie', rules: { percent: 100 }, enabled: true },
    { key: 'ussd_menu', description: 'Menu USSD du pilote', rules: { countries: ['CM'] }, enabled: true },
    { key: 'campagnes_v2', description: 'Campagnes de vaccination (V2)', rules: {}, enabled: false },
  ]);

  params.invalidate();
  report.users = (await ds.query(`SELECT count(*)::int AS n FROM users`))[0].n;
  void jeanMarc;
  log.log(`seed done: ${JSON.stringify(report)}`);
  return report;
}

const FARM_CHILD_TABLES = [
  'telemetry', 'devices', 'reminders', 'health_events', 'daily_logs', 'tasks', 'stock_movements', 'stock_thresholds', 'products_sales',
  'expenses', 'alert_events', 'mating_checks', 'batches', 'dogs', 'animals', 'farm_settings',
];

/** Hard-deletes farms and everything attached to them (test leftovers only). */
async function purgeFarms(ds: DataSource, farmIds: string[]): Promise<void> {
  if (!farmIds.length) return;
  for (const t of FARM_CHILD_TABLES) {
    if (t === 'telemetry') await ds.query(`DELETE FROM telemetry WHERE device_id IN (SELECT id FROM devices WHERE farm_id = ANY($1))`, [farmIds]);
    else await ds.query(`DELETE FROM ${t} WHERE farm_id = ANY($1)`, [farmIds]);
  }
  await ds.query(`DELETE FROM farms WHERE id = ANY($1)`, [farmIds]);
}

/**
 * Restores the documented demo organisation: removes farms/members added by tests, restores seeded memberships,
 * the Structure annual subscription, org.coop-centre (0.2.0 published, 0.3.0 in review, no self-review) and the mock alerts.
 */
async function resetDemoOrg(ds: DataSource, today: string): Promise<void> {
  const org = await ds.getRepository(Organisation).findOne({ where: { id: DEMO.orgId } });
  if (!org) return;
  const seededFarms = Array.from({ length: 312 }, (_, i) => demoId(`coop-farm:${i}`));
  const junkFarms: Array<{ id: string; owner_id: string }> = await ds.query(
    `SELECT id, owner_id FROM farms WHERE (organisation_id = $1 AND NOT (id = ANY($2))) OR name ILIKE 'Ferme Test%' OR name ILIKE 'Test Import%'`,
    [DEMO.orgId, seededFarms],
  );
  await purgeFarms(ds, junkFarms.map((f) => f.id));
  const seededMembers = [demoId('member:aicha'), demoId('member:paul'), ...Array.from({ length: 312 }, (_, i) => demoId(`member:farmer:${i}`))];
  const junkMembers: Array<{ user_id: string }> = await ds.query(
    `DELETE FROM memberships WHERE organisation_id = $1 AND NOT (id = ANY($2)) RETURNING user_id`,
    [DEMO.orgId, seededMembers],
  );
  const demoPhones = Object.values(DEMO.phones);
  const candidates = [...new Set([...junkMembers.map((m) => m.user_id), ...junkFarms.map((f) => f.owner_id)])];
  if (candidates.length) {
    const removable: Array<{ id: string }> = await ds.query(
      `SELECT u.id FROM users u WHERE u.id = ANY($1) AND NOT (u.phone = ANY($2)) AND u.phone NOT LIKE '+237677%'
          AND NOT EXISTS (SELECT 1 FROM farms f WHERE f.owner_id = u.id) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)`,
      [candidates, demoPhones],
    );
    const ids = removable.map((r) => r.id);
    if (ids.length) {
      for (const t of ['consents', 'account_requests', 'refresh_tokens']) await ds.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [ids]);
      await ds.query(`DELETE FROM subscriptions WHERE account_type = 'user' AND account_id = ANY($1)`, [ids]);
      await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    }
  }
  await ds.query(`UPDATE memberships SET status = 'actif', deleted_at = NULL WHERE organisation_id = $1`, [DEMO.orgId]);
  await ds.query(`UPDATE memberships SET role = 'admin' WHERE id = $1`, [demoId('member:aicha')]);
  await ds.query(`UPDATE memberships SET role = 'agent' WHERE id = $1`, [demoId('member:paul')]);
  await ds.query(`UPDATE organisations SET name = 'Coop. avicole du Centre', plan = 'structure', settings = '{"target_rate":85}'::jsonb, deleted_at = NULL WHERE id = $1`, [DEMO.orgId]);
  await ds.query(
    `UPDATE subscriptions SET plan = 'structure', period = 'annuel', price_minor = 150000, currency = 'XAF', status = 'actif',
            started_at = $2, expires_at = $3, grace_until = $4 WHERE account_type = 'organisation' AND account_id = $1`,
    [DEMO.orgId, new Date(`${addDays(today, -295)}T08:00:00Z`), new Date(`${addDays(today, 70)}T08:00:00Z`), new Date(`${addDays(today, 77)}T08:00:00Z`)],
  );
  // Org pack: keep only the seeded 0.2.0 (published) and 0.3.0 (in review, no review yet).
  const pack: Array<{ id: string }> = await ds.query(`SELECT id FROM param_packs WHERE code = 'org.coop-centre'`);
  if (pack[0]) {
    const extra: Array<{ id: string }> = await ds.query(`SELECT id FROM param_pack_versions WHERE pack_id = $1 AND version NOT IN ('0.2.0','0.3.0')`, [pack[0].id]);
    const ids = extra.map((e) => e.id);
    const v030: Array<{ id: string }> = await ds.query(`SELECT id FROM param_pack_versions WHERE pack_id = $1 AND version = '0.3.0'`, [pack[0].id]);
    const cleanup = [...ids, ...v030.map((v) => v.id)];
    for (const t of ['param_reviews', 'param_test_runs', 'param_publications']) {
      if (t === 'param_publications') await ds.query(`DELETE FROM ${t} WHERE version_id = ANY($1)`, [ids]);
      else await ds.query(`DELETE FROM ${t} WHERE version_id = ANY($1)`, [cleanup]);
    }
    await ds.query(`DELETE FROM param_pack_versions WHERE id = ANY($1)`, [ids]);
    await ds.query(`UPDATE param_pack_versions SET status = 'publie', rollout = NULL, retired_at = NULL WHERE pack_id = $1 AND version = '0.2.0'`, [pack[0].id]);
    await ds.query(
      `UPDATE param_pack_versions SET status = 'en_revue', signature = NULL, content_hash = NULL, published_at = NULL, published_by = NULL, rollout = NULL WHERE pack_id = $1 AND version = '0.3.0'`,
      [pack[0].id],
    );
    await ds.query(`UPDATE param_packs SET review_required = true WHERE id = $1`, [pack[0].id]);
  }
  // Mock alerts back to their documented state.
  await ds.query(
    `UPDATE alert_events SET status = 'ouverte', acknowledged_at = NULL, acknowledged_by = NULL, resolved_at = NULL, resolution_cause = NULL, resolution_action = NULL
      WHERE id = ANY($1)`,
    [['biyong', 'pionniers', 'essomba', 'paul'].map((k) => demoId(`alert:${k}`))],
  );
  for (const [k, h] of [['biyong', 2], ['pionniers', 72], ['essomba', 24], ['paul', 72]] as const) {
    await ds.query(`UPDATE alert_events SET opened_at = now() - make_interval(hours => $2), last_triggered_at = now() - make_interval(hours => $2) WHERE id = $1`, [demoId(`alert:${k}`), h]);
  }
}

async function seedMarthe(ds: DataSource, owner: string, today: string, now: Date): Promise<void> {
  const M = DEMO.marthe;
  const b01Start = addDays(today, -218); // week 31 of lay on the mock date
  const b02Start = addDays(today, -19); // Newcastle J19 due today
  const ts = (d: string) => new Date(`${d}T07:00:00Z`);

  await ins(ds, Farm, {
    id: M.farmId, owner_id: owner, name: 'Ferme de Mfou', speculations: ['volaille', 'chien'], country: 'CM', region: 'Centre', locality: 'Mfou',
    currency: 'XAF', gps_lat: 3.7231, gps_lng: 11.6379, area_ha: 1.5, manager_name: 'Marthe Ngo Bayiha', created_by: owner, created_at: ts(addDays(today, -230)),
  });
  await ins(ds, FarmSettings, { farm_id: M.farmId, oncall_default: { name: 'Joseph (gardien)', phone: DEMO.phones.oncall }, dashboard_kpis: ['taux_ponte', 'marge_mois'] });
  await ins(ds, Batch, [
    {
      id: M.b01, farm_id: M.farmId, code: 'B01', name: 'B01', species: 'volaille', production_type: 'ponte', strain: 'ISA Brown', initial_count: 2000, current_count: 2000,
      start_date: b01Start, housing: 'Poulailler 1', attributes: { strain: 'ISA Brown', age_at_start_days: 1, supplier: 'Couvoir de Yaoundé' }, param_version: 'global.core@1.0.0+filiere.volaille@1.0.0+filiere.canin@1.0.0+pays.CM@1.0.0',
      created_by: owner, created_at: ts(b01Start),
    },
    {
      id: M.b02, farm_id: M.farmId, code: 'B02', name: 'B02', species: 'volaille', production_type: 'chair', strain: 'Cobb 500', initial_count: 200, current_count: 200,
      start_date: b02Start, housing: 'Poulailler 2', attributes: { strain: 'Cobb 500', age_at_start_days: 1, supplier: 'Couvoir de Yaoundé' }, param_version: 'global.core@1.0.0+filiere.volaille@1.0.0+filiere.canin@1.0.0+pays.CM@1.0.0',
      created_by: owner, created_at: ts(b02Start),
    },
  ]);

  // Dogs: Rex + a small pedigree (Rex × Nala are half first cousins → F = 3.125 %).
  const dog = (slug: string, name: string, sex: 'M' | 'F', birth: string, extra: Partial<Dog> = {}): Partial<Dog> => ({
    id: demoId(`dog:${slug}`), farm_id: M.farmId, name, breed: 'Berger allemand', sex, birth_date: birth, status: 'reproducteur', created_by: owner, attributes: {}, ...extra,
  });
  await ins(ds, Dog, [
    dog('atlas', 'Atlas', 'M', '2016-03-02', { status: 'decede' }),
    dog('dina', 'Dina', 'F', '2016-07-11', { status: 'decede' }),
    dog('gaia', 'Gaia', 'F', '2017-01-20', { status: 'decede' }),
    dog('kira', 'Kira', 'F', '2019-04-18'),
    dog('luna', 'Luna', 'F', '2019-09-05'),
  ]);
  await ins(ds, Dog, [
    dog('bruno', 'Bruno', 'M', '2019-02-14', { sire_id: demoId('dog:atlas'), dam_id: demoId('dog:dina') }),
    dog('max', 'Max', 'M', '2019-05-30', { sire_id: demoId('dog:atlas'), dam_id: demoId('dog:gaia') }),
  ]);
  await ins(ds, Dog, [
    dog('rex', 'Rex', 'M', '2023-06-10', {
      sire_id: demoId('dog:bruno'), dam_id: demoId('dog:kira'), chip_number: '120093000418271', identification_type: 'puce', coat: 'noir et feu', status: 'pension',
      attributes: { color: 'noir et feu', weight_kg: 34.2, role: 'pension', box: 'B-07' }, created_at: new Date('2026-01-15T09:00:00Z'),
    }),
    dog('nala', 'Nala', 'F', '2024-05-12', { sire_id: demoId('dog:max'), dam_id: demoId('dog:luna'), chip_number: '120093000533904', identification_type: 'puce', attributes: { role: 'reproducteur', weight_kg: 29 } }),
  ]);

  const he = (key: string, partial: Partial<HealthEvent>): Partial<HealthEvent> => ({
    id: demoId(`he:${key}`), farm_id: M.farmId, event_type: 'vaccination', created_by: owner, attributes: {}, ...partial,
  });
  const ponteSteps: Array<[string, string, number, string]> = [
    ['marek_j1', 'marek', 1, 'injection'], ['newcastle_bi_j7', 'newcastle', 7, 'oculaire'], ['gumboro_j12', 'gumboro', 12, 'eau_de_boisson'],
    ['newcastle_rappel_j19', 'newcastle', 19, 'eau_de_boisson'], ['variole_s8', 'variole_aviaire', 56, 'transfixion'], ['newcastle_s16', 'newcastle', 112, 'injection'],
  ];
  const rabies = addDays(today, -362); // 2025-10-30 on the mock date
  await ins(ds, HealthEvent, [
    ...ponteSteps.map(([step, disease, off, route]) =>
      he(`b01:${step}`, { subject_type: 'batch', subject_id: M.b01, disease, protocol_id: 'volaille_ponte_cm', protocol_step: step, dose_route: route, event_date: addDays(b01Start, off), performed_by: 'Marthe' }),
    ),
    he('b01:newcastle_rec1', { subject_type: 'batch', subject_id: M.b01, disease: 'newcastle', dose_route: 'eau_de_boisson', event_date: addDays(b01Start, 202), product: 'Hipraviar S', performed_by: 'Marthe' }),
    he('b02:marek_j1', { subject_type: 'batch', subject_id: M.b02, disease: 'marek', protocol_id: 'volaille_chair_cm', protocol_step: 'marek_j1', dose_route: 'injection', event_date: addDays(b02Start, 1), performed_by: 'Couvoir' }),
    he('b02:newcastle_bi_j7', {
      subject_type: 'batch', subject_id: M.b02, disease: 'newcastle', protocol_id: 'volaille_chair_cm', protocol_step: 'newcastle_bi_j7', dose_route: 'oculaire', event_date: addDays(b02Start, 7),
      product: 'Hitchner B1', product_batch_no: 'ND-5521', performed_by: 'Marthe',
    }),
    he('rex:chppil_s8', { subject_type: 'dog', subject_id: M.rex, disease: 'chppil', protocol_id: 'chien_cm', protocol_step: 'chppil_s8', event_date: '2023-08-05', performed_by: 'Dr Ngono' }),
    he('rex:chppil_s12', { subject_type: 'dog', subject_id: M.rex, disease: 'chppil', protocol_id: 'chien_cm', protocol_step: 'chppil_s12', event_date: '2023-09-02', performed_by: 'Dr Ngono' }),
    he('rex:rage_m3', { subject_type: 'dog', subject_id: M.rex, disease: 'rage', protocol_id: 'chien_cm', protocol_step: 'rage_m3', event_date: '2023-09-08', performed_by: 'Dr Ngono' }),
    he('rex:rage_annual', { subject_type: 'dog', subject_id: M.rex, disease: 'rage', event_date: rabies, product: 'Rabisin', product_batch_no: 'RB-2291', dose_route: 'injection', performed_by: 'Dr Ngono' }),
    he('rex:chppil_annual', { subject_type: 'dog', subject_id: M.rex, disease: 'chppil', event_date: rabies, product: 'Eurican', product_batch_no: 'RB-2291', performed_by: 'Dr Ngono' }),
    he('rex:vermifuge', { subject_type: 'dog', subject_id: M.rex, event_type: 'deparasitage', disease: 'vermifugation', event_date: addDays(today, -45), product: 'Milbemax', performed_by: 'Marthe' }),
    he('nala:rage', { subject_type: 'dog', subject_id: M.nala, disease: 'rage', event_date: addDays(today, -200), product: 'Rabisin', performed_by: 'Dr Ngono' }),
  ]);

  // Daily logs: 14 days for B01 (≈76 % lay, 20 deaths) and since placement for B02 (3 deaths).
  const logs: Array<Partial<DailyLog>> = [];
  const mortB01 = [1, 2, 1, 2, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1];
  let cum = 0;
  for (let d = 14; d >= 1; d--) {
    const present = 2000 - cum;
    const m = mortB01[14 - d];
    const rate = 0.75 + ((d * 7) % 5) / 200;
    logs.push({
      id: demoId(`log:b01:${d}`), farm_id: M.farmId, subject_type: 'batch', subject_id: M.b01, log_date: addDays(today, -d), present_count: present, mortality: m,
      eggs: Math.round(present * rate), eggs_broken: 6 + (d % 4), feed_kg: 236, water_l: 405 + (d % 5) * 3, attributes: { behaviour: 'normal' }, created_by: owner,
    });
    cum += m;
  }
  cum = 0;
  for (let d = 1; d <= 18; d++) {
    const m = [3, 9, 15].includes(d) ? 1 : 0;
    logs.push({
      id: demoId(`log:b02:${d}`), farm_id: M.farmId, subject_type: 'batch', subject_id: M.b02, log_date: addDays(b02Start, d), present_count: 200 - cum, mortality: m,
      feed_kg: Math.round((2 + d * 1.3) * 10) / 10, water_l: Math.round(4 + d * 2.4), attributes: { behaviour: 'normal', avg_weight_g: Math.round(42 * Math.pow(1.17, d)) }, created_by: owner,
    });
    cum += m;
  }
  await ins(ds, DailyLog, logs);

  // Stock: feed for ~6 days, vaccines, kibble.
  const mv = (key: string, p: Partial<StockMovement>): Partial<StockMovement> => ({ id: demoId(`mv:${key}`), farm_id: M.farmId, created_by: owner, ...p });
  const moves: Array<Partial<StockMovement>> = [
    mv('feed-in-1', { item_id: 'aliment_ponte', movement_date: addDays(today, -20), direction: 'entree', quantity: 2360, unit_cost_minor: 260, currency: 'XAF', supplier: 'Provenderie du Centre' }),
    mv('feed-in-2', { item_id: 'aliment_ponte', movement_date: addDays(today, -8), direction: 'entree', quantity: 2360, unit_cost_minor: 260, currency: 'XAF', supplier: 'Provenderie du Centre' }),
    mv('nd-in', { item_id: 'vaccin_newcastle', movement_date: addDays(today, -25), direction: 'entree', quantity: 1000, lot_no: 'ND-5521', expiry_date: addDays(today, 60), supplier: 'Pharmavet' }),
    mv('nd-out', { item_id: 'vaccin_newcastle', movement_date: addDays(b02Start, 7), direction: 'sortie', quantity: 200, subject_type: 'batch', subject_id: M.b02 }),
    mv('kibble-in', { item_id: 'croquettes_chien', movement_date: addDays(today, -12), direction: 'entree', quantity: 60, supplier: 'Animalerie Bastos' }),
  ];
  for (let d = 1; d <= 14; d++) moves.push(mv(`feed-out-${d}`, { item_id: 'aliment_ponte', movement_date: addDays(today, -d), direction: 'sortie', quantity: 236, subject_type: 'batch', subject_id: M.b01 }));
  await ins(ds, StockMovement, moves);
  await insertIgnore(ds, StockThreshold, [{ farm_id: M.farmId, item_id: 'aliment_ponte', min_quantity: 1500 }]);

  // Sales and expenses: margin 184 500 this month, +12 % vs last month.
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
  const clamp = (d: string) => (d > today ? today : d);
  const sale = (key: string, date: string, qty: number): Partial<Sale> => ({
    id: demoId(`sale:${key}`), farm_id: M.farmId, product: 'oeufs_plateau', species: 'volaille', quantity: qty, unit: 'plateau', unit_price_minor: 2500, amount_minor: qty * 2500,
    currency: 'XAF', client_name: 'Marché Mfou', payment: 'especes', payment_status: 'paye', sale_date: date, subject_type: 'batch', subject_id: M.b01, created_by: owner, attributes: {},
  });
  await ins(ds, Sale, [
    sale('cur-1', clamp(addDays(monthStart, 2)), 60), sale('cur-2', clamp(addDays(monthStart, 9)), 60), sale('cur-3', clamp(addDays(monthStart, 16)), 60),
    sale('prev-1', addDays(prevStart, 4), 56), sale('prev-2', addDays(prevStart, 12), 56), sale('prev-3', addDays(prevStart, 22), 56),
  ]);
  const exp = (key: string, date: string, category: string, amount: number, description: string): Partial<Expense> => ({
    id: demoId(`exp:${key}`), farm_id: M.farmId, category, amount_minor: amount, currency: 'XAF', payment_method: 'orange_money', expense_date: date, description, created_by: owner, attributes: {},
  });
  await ins(ds, Expense, [
    exp('cur-feed', clamp(addDays(monthStart, 1)), 'aliment', 236000, 'Aliment ponte (sacs)'),
    exp('cur-vet', clamp(addDays(monthStart, 6)), 'veterinaire', 19500, 'Vaccins et vermifuges'),
    exp('cur-energy', clamp(addDays(monthStart, 8)), 'energie_eau', 10000, 'Électricité'),
    exp('prev-feed', addDays(prevStart, 1), 'aliment', 228000, 'Aliment ponte (sacs)'),
    exp('prev-vet', addDays(prevStart, 9), 'veterinaire', 17300, 'Vaccins'),
    exp('prev-energy', addDays(prevStart, 10), 'energie_eau', 10000, 'Électricité'),
  ]);

  await ins(ds, Task, [
    { id: demoId('task:aliment'), farm_id: M.farmId, title: "Commander l'aliment ponte", category: 'stock', due_date: addDays(today, 5), status: 'a_faire', notes: 'Stock estimé : 6 jours', created_by: owner },
    { id: demoId('task:abreuvoirs'), farm_id: M.farmId, template_id: 'nettoyage_abreuvoirs', title: 'Nettoyer les abreuvoirs', category: 'hygiene', due_date: today, recurrence: 'every_days:1', status: 'a_faire', created_by: owner },
    { id: demoId('task:pesee-b02'), farm_id: M.farmId, template_id: 'pesee_hebdo_chair', title: 'Pesée hebdomadaire B02', category: 'pesee', subject_type: 'batch', subject_id: M.b02, due_date: addDays(today, 2), recurrence: 'FREQ=WEEKLY;INTERVAL=1', status: 'a_faire', created_by: owner },
  ]);

  // Connected farm: gateway + 5 sensors with 24 h of telemetry.
  const cfgs: Record<string, Record<string, unknown>> = {
    'poulailler-1': { threshold: 32, warn_when: 'reading.value > 31' },
    'poulailler-2': { threshold: 32, warn_when: 'reading.value > 31' },
    'chateau-eau': { threshold: 20, alert: { when: 'reading.value < 10', for: '15m', severity: 'critique' }, warn_when: 'reading.value < 20' },
    'ammoniac-p2': { threshold: 25, alert: { when: 'reading.value > 35', for: '0m', severity: 'critique' }, warn_when: 'reading.value > 25' },
    'eau-consommee': { auto_journal: true },
  };
  const lastSeen = new Date(now.getTime() - 40_000);
  await ins(ds, Device, 
    DEMO.devices.map((d) => ({
      id: DEMO.deviceId(d.slug), farm_id: M.farmId, type: d.type, name: d.name, serial: `RF-${d.slug.toUpperCase()}`, metric: d.metric, unit: d.unit,
      housing: d.slug.includes('2') ? 'Poulailler 2' : d.slug.includes('1') ? 'Poulailler 1' : null,
      sensor_profile_code: d.slug.startsWith('poulailler') ? 'temperature_poulailler' : null, config: cfgs[d.slug] ?? {}, key_hash: hashKey(DEMO.deviceKey(d.slug)),
      status: 'en_ligne', last_seen_at: lastSeen, last_value: d.base, battery_pct: d.type === 'gateway' ? 100 : 80 + (d.slug.length % 15),
    })),
  );
  const tel: Array<Partial<Telemetry>> = [];
  const rnd = prng(42);
  for (const d of DEMO.devices.filter((x) => x.metric)) {
    for (let k = 47; k >= 0; k--) {
      const at = new Date(lastSeen.getTime() - k * 30 * 60_000);
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Douala', hour: '2-digit', hour12: false }).format(at));
      const diurnal = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
      let v = d.base!;
      if (d.metric === 'temperature') v = d.base! - 2.2 + diurnal * 2.4 + (rnd() - 0.5) * 0.4;
      else if (d.metric === 'water_level') v = d.base! + 6 * Math.cos((k / 48) * 2 * Math.PI) + (rnd() - 0.5);
      else if (d.metric === 'nh3') v = d.base! + (rnd() - 0.5) * 3;
      else v = Math.max(0, d.base! * ((47 - k) / 47));
      if (k === 0) v = d.base!;
      tel.push({ device_id: DEMO.deviceId(d.slug), metric: d.metric!, ts: at, value: Math.round(v * 10) / 10, quality: 1 });
    }
  }
  await insertIgnore(ds, Telemetry, tel);
}

async function seedCoop(ds: DataSource, today: string, now: Date, _paulId: string): Promise<{ farms: number; reminders: number }> {
  const rnd = prng(2026);
  const pick = <T>(l: T[]) => l[Math.floor(rnd() * l.length)];
  const usersRows: Array<Partial<User>> = [];
  const farmRows: Array<Partial<Farm>> = [];
  const batchRows: Array<Partial<Batch>> = [];
  const logRows: Array<Partial<DailyLog>> = [];
  const memberRows: Array<Partial<Membership>> = [];
  const farms: Array<{ id: string; batch: string; zone: (typeof ZONES)[number]; name: string; count: number; vaccinated: boolean }> = [];
  const special: Record<number, { farm: string; owner: string; zone: string }> = {
    0: { farm: 'Ferme Biyong', owner: 'Jacques Biyong', zone: 'Obala' },
    1: { farm: 'GIC Les Pionniers', owner: 'Rose Tchakounté', zone: 'Soa' },
    2: { farm: 'Ferme Essomba', owner: 'M. Essomba', zone: 'Mfou' },
  };
  const zoneQueue: string[] = ZONES.flatMap((z) => Array(z.farms).fill(z.name));
  // Put the named farms in their zones.
  for (const s of Object.values(special)) zoneQueue.splice(zoneQueue.indexOf(s.zone), 1);
  let qi = 0;
  const noPhone = new Set<number>();
  while (noPhone.size < 64) noPhone.add(3 + Math.floor(rnd() * 309));
  const inactive = new Set<number>();
  while (inactive.size < 71) inactive.add(Math.floor(rnd() * 312));
  inactive.delete(0);
  inactive.delete(1);
  if (inactive.size < 71) inactive.add(311);
  const overThreshold = new Set([0, 57]);

  for (let i = 0; i < 312; i++) {
    const s = special[i];
    const zoneName = s?.zone ?? zoneQueue[qi++];
    const zone = ZONES.find((z) => z.name === zoneName)!;
    const ownerName = s?.owner ?? `${pick(FIRST)} ${pick(LAST)}`;
    const farmName = s?.farm ?? (rnd() < 0.18 ? `GIC ${pick(['Espoir', 'Avenir', 'Union', 'Solidarité', 'Progrès', 'Réveil'])} de ${zone.name}` : `Ferme ${ownerName.split(' ').slice(-1)[0]}`);
    const userId = demoId(`farmer:${i}`);
    const farmId = demoId(`coop-farm:${i}`);
    const batchId = demoId(`coop-batch:${i}`);
    const lastActive = inactive.has(i) ? new Date(now.getTime() - (8 + Math.floor(rnd() * 30)) * 86400_000) : new Date(now.getTime() - Math.floor(rnd() * 6.5 * 86400_000));
    usersRows.push({ id: userId, phone: `+237677${String(i + 1).padStart(6, '0')}`, full_name: ownerName, otp_verified: true, account_status: 'actif', has_smartphone: !noPhone.has(i), last_active_at: lastActive });
    farmRows.push({
      id: farmId, owner_id: userId, organisation_id: DEMO.orgId, name: farmName, speculations: ['volaille'], country: 'CM', region: 'Centre', locality: zone.name, currency: 'XAF',
      gps_lat: Math.round((zone.lat + (rnd() - 0.5) * 0.06) * 1e6) / 1e6, gps_lng: Math.round((zone.lng + (rnd() - 0.5) * 0.06) * 1e6) / 1e6, created_by: userId,
    });
    memberRows.push({ id: demoId(`member:farmer:${i}`), user_id: userId, organisation_id: DEMO.orgId, role: 'membre', status: 'actif' });
    const ponte = rnd() < 0.35;
    const initial = i === 1 ? 1200 : Math.round((ponte ? 500 + rnd() * 1500 : 200 + rnd() * 900) / 10) * 10;
    const pct = i === 0 ? 6.8 : overThreshold.has(i) ? 5.4 : Math.max(0.6, Math.min(4.8, 3.2 + (rnd() - 0.5) * 3));
    const mortality = Math.round((initial * pct) / 100);
    const start = addDays(today, -(ponte ? 60 + Math.floor(rnd() * 200) : 22 + Math.floor(rnd() * 20)));
    batchRows.push({
      id: batchId, farm_id: farmId, code: 'L1', name: `L1-${zone.name.slice(0, 3).toUpperCase()}`, species: 'volaille', production_type: ponte ? 'ponte' : 'chair', initial_count: initial,
      current_count: initial - mortality, mortality_total: mortality, start_date: start, attributes: {}, created_by: userId,
    });
    logRows.push({
      id: demoId(`coop-log:${i}`), farm_id: farmId, subject_type: 'batch', subject_id: batchId, log_date: i === 0 ? addDays(today, -1) : addDays(start, 10), present_count: initial,
      mortality, notes: 'Cumul repris à l’adhésion', attributes: {}, created_by: userId,
    });
    farms.push({ id: farmId, batch: batchId, zone, name: farmName, count: initial - mortality, vaccinated: rnd() < zone.coverage });
  }
  await insertIgnore(ds, User, usersRows);
  await insertIgnore(ds, Farm, farmRows);
  await insertIgnore(ds, Membership, memberRows);
  await insertIgnore(ds, Batch, batchRows);
  await insertIgnore(ds, DailyLog, logRows);

  // ---- 12 weeks of reminders: confirmation rate rising from ~61 % to ~87 % -------------------
  const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
  const curMonday = mondayOf(today);
  const rows: Array<Partial<Reminder> & { _nc?: boolean }> = [];
  const others = ['gumboro', 'bronchite_infectieuse', 'variole_aviaire', 'marek', 'newcastle'];
  for (let w = 0; w < 12; w++) {
    const monday = addDays(curMonday, -(11 - w) * 7);
    const days = Array.from({ length: 7 }, (_, k) => addDays(monday, k)).filter((d) => d <= today);
    const due = Math.round(390 + ((508 - 390) * w) / 11);
    const rate = w === 11 ? 0.874 : 0.61 + ((0.833 - 0.61) * w) / 10;
    const weekRows: Array<Partial<Reminder> & { _nc?: boolean }> = [];
    for (let k = 0; k < due; k++) {
      const f = farms[Math.floor(rnd() * farms.length)];
      const d = days[k % days.length];
      const disease = d < addDays(today, -28) ? pick(others) : pick(others.slice(0, 4));
      weekRows.push({
        id: demoId(`hist:${w}:${k}`), farm_id: f.id, source_type: 'health_event', subject_ref: `Bande ${f.name} · ${f.count} sujets`, disease, step: `${disease}_hist`, kind: 'protocole',
        due_date: d, priority: disease === 'newcastle' ? 'haute' : 'normale', status: 'a_venir', short_code: String(1000 + ((w * 997 + k * 31) % 9000)), channel_plan: [],
      });
    }
    // One Newcastle reminder per farm in the last ~4 weeks drives the 30-day coverage map.
    if (w >= 8) {
      let slot = 0;
      farms.forEach((f, idx) => {
        if (idx % 4 !== w - 8) return;
        const d = days[idx % days.length];
        const r = weekRows[slot++ % weekRows.length];
        Object.assign(r, { farm_id: f.id, disease: 'newcastle', step: 'newcastle_hist', priority: 'haute', due_date: d, subject_ref: `Bande ${f.name} · ${f.count} sujets`, _nc: true });
        r.status = f.vaccinated ? 'confirme' : 'a_venir';
      });
    }
    const target = Math.round(due * rate);
    let confirmed = weekRows.filter((r) => r.status === 'confirme').length;
    for (const r of weekRows) {
      if (confirmed >= target) break;
      if (r._nc || r.status === 'confirme') continue;
      const f = farms.find((x) => x.id === r.farm_id)!;
      if (rnd() > f.zone.reliability * 0.95) continue;
      r.status = 'confirme';
      confirmed++;
    }
    for (const r of weekRows) {
      if (confirmed >= target) break;
      if (r._nc || r.status === 'confirme') continue;
      r.status = 'confirme';
      confirmed++;
    }
    rows.push(...weekRows);
  }
  // Unconfirmed reminders: 48 still open and overdue (17 at J+3 or more), the rest missed.
  const unconfirmed = rows.filter((r) => r.status !== 'confirme').sort((a, b) => (a.due_date! < b.due_date! ? 1 : -1));
  // The 31 recent ones (last 2 days) must not depend on the weekday: top the window up with
  // unconfirmed rows of the same week, so weekly rates and the coverage map are unchanged.
  const recentDays = [addDays(today, -1), addDays(today, -2)];
  const inRecent = (d: string) => d >= recentDays[1] && d < today;
  let missing = 31 - unconfirmed.filter((r) => inRecent(r.due_date!)).length;
  for (const r of unconfirmed) {
    if (missing <= 0) break;
    if (r._nc || r.due_date! >= recentDays[1]) continue;
    const target = recentDays.find((d) => mondayOf(d) === mondayOf(r.due_date!));
    if (!target) continue;
    r.due_date = target;
    missing--;
  }
  unconfirmed.sort((a, b) => (a.due_date! < b.due_date! ? 1 : -1));
  let recent = 0;
  let late = 0;
  for (const r of unconfirmed) {
    const d = r.due_date!;
    if (d === today) r.status = 'envoye';
    else if (d >= addDays(today, -2) && recent < 31) {
      r.status = 'envoye';
      recent++;
    } else if (d <= addDays(today, -3) && d >= addDays(today, -12) && late < 17) {
      r.status = 'envoye';
      late++;
    } else r.status = 'manque';
  }
  const vias = ['sms', 'app', 'app', 'ussd', 'agent'];
  const final = rows.map(({ _nc: _drop, ...r }) => ({
    ...r,
    sent_at: new Date(`${addDays(r.due_date!, -1)}T08:00:00Z`),
    ...(r.status === 'confirme'
      ? { confirmed_at: new Date(Math.min(now.getTime(), new Date(`${r.due_date}T10:00:00Z`).getTime() + Math.floor(rnd() * 2) * 86400_000)), confirmed_via: pick(vias) }
      : {}),
  }));
  await insertIgnore(ds, Reminder, final as Array<Partial<Reminder>>);

  // ---- Alerts of the Admin mock ------------------------------------------------------------
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const alerts: Array<Partial<AlertEvent>> = [
    {
      id: demoId('alert:biyong'), farm_id: farms[0].id, organisation_id: DEMO.orgId, rule_code: 'mortalite_journaliere', source: 'daily_logs', severity: 'critique', status: 'ouverte',
      title: 'Mortalité anormale', reason: 'Mortalité 6,8 % en 48 h · suspicion', action_label: 'Envoyer un vétérinaire', subject_type: 'batch', subject_id: farms[0].batch,
      trigger_value: { pct: 6.8 }, opened_at: hoursAgo(2), last_triggered_at: hoursAgo(2),
      escalation: [
        { level: 1, target: 'proprietaire', at: hoursAgo(2).toISOString(), done: true },
        { level: 2, target: 'astreinte', at: hoursAgo(1.75).toISOString(), done: true },
      ],
    },
    {
      id: demoId('alert:pionniers'), farm_id: farms[1].id, organisation_id: DEMO.orgId, rule_code: 'rappel_manque', source: 'reminders', severity: 'attention', status: 'ouverte',
      title: 'Rappel manqué', reason: 'Gumboro J+3 non confirmé · 1 200 sujets', action_label: 'Appeler', trigger_value: { disease: 'gumboro', days_late: 3 }, opened_at: hoursAgo(72), last_triggered_at: hoursAgo(72),
    },
    {
      id: demoId('alert:essomba'), farm_id: farms[2].id, organisation_id: DEMO.orgId, rule_code: 'stock_peremption', source: 'stock_movements', severity: 'attention', status: 'ouverte',
      title: 'Péremption de stock', reason: 'Stock vaccin Newcastle périmé dans 4 j', action_label: 'Réaffecter', trigger_value: { item_id: 'vaccin_newcastle', expiry_date: addDays(today, 4) }, opened_at: hoursAgo(24), last_triggered_at: hoursAgo(24),
    },
    {
      id: demoId('alert:paul'), farm_id: null, organisation_id: DEMO.orgId, rule_code: 'agent_non_synchronise', source: 'sync', severity: 'info', status: 'ouverte',
      title: 'Agent : Paul M.', reason: '14 saisies non synchronisées depuis 3 j', action_label: 'Relancer', trigger_value: { pending: 14, agent: 'Paul M.' }, opened_at: hoursAgo(72), last_triggered_at: hoursAgo(72),
    },
  ];
  await insertIgnore(ds, AlertEvent, alerts);
  await insertIgnore(ds, StockMovement, [
    { id: demoId('mv:essomba-nd'), farm_id: farms[2].id, item_id: 'vaccin_newcastle', movement_date: addDays(today, -40), direction: 'entree', quantity: 500, lot_no: 'ND-4410', expiry_date: addDays(today, 4) },
  ]);
  await ds.query(
    `INSERT INTO usage_counters (account_type, account_id, period, metric, value) VALUES ('organisation', $1, $2, 'sms', 3412) ON CONFLICT DO NOTHING`,
    [DEMO.orgId, today.slice(0, 7)],
  );
  return { farms: farmRows.length, reminders: final.length };
}

async function seedOrgPack(ds: DataSource, keys: KeysService, authorId: string, reviewerId: string): Promise<void> {
  const code = 'org.coop-centre';
  let pack = await ds.getRepository(ParamPack).findOne({ where: { code } });
  if (!pack) {
    pack = await ds.getRepository(ParamPack).save({ code, level: 'org', scope_ref: DEMO.orgId, title: 'Coop. avicole du Centre', owner_user_id: authorId, review_required: true });
  }
  const v020: PackDoc = {
    pack: code, version: '0.2.0', level: 'org', requires: { 'pays.CM': '^1.0.0' },
    objects: [
      { kind: 'alert_rule', code: 'mortalite_journaliere', params: { seuil_mortalite_jour_pct: 1.5 } },
      { kind: 'message_template', code: 'rappel_sms', channel: 'sms', lang: 'fr', text: 'Coop Centre: {{disease}} pour {{subject}} {{when}}. Repondez OK {{code}}.' },
    ],
    i18n: { fr: {} },
  };
  const daily = (await ds.query(
    `SELECT v.content FROM param_pack_versions v JOIN param_packs p ON p.id = v.pack_id WHERE p.code = 'filiere.volaille' AND v.status = 'publie' LIMIT 1`,
  )) as Array<{ content: PackDoc }>;
  const baseForm = daily[0]?.content.objects.find((o) => o.kind === 'form' && o.code === 'daily_log_volaille') as { fields: unknown[] } | undefined;
  const v030: PackDoc = {
    ...v020,
    version: '0.3.0',
    objects: [
      ...v020.objects,
      {
        kind: 'form', code: 'daily_log_volaille',
        fields: [
          ...((baseForm?.fields as unknown[]) ?? []),
          { code: 'egg_weight_g', type: 'decimal', label: 'poids_oeuf_g', unit: 'g', min: 30, max: 90, visible_if: "subject.production_type == 'ponte'", maps_to: 'attributes.egg_weight_g' },
          { code: 'feed_lot', type: 'text', label: 'lot_aliment', maps_to: 'attributes.feed_lot' },
        ],
      },
    ],
    i18n: { fr: { poids_oeuf_g: 'Poids moyen d’un œuf (g)', lot_aliment: 'Lot d’aliment' } },
  };
  const repo = ds.getRepository(ParamPackVersion);
  if (!(await repo.findOne({ where: { pack_id: pack.id, version: '0.2.0' } }))) {
    const { hash, signature } = keys.signPack(v020);
    const v = await repo.save({
      pack_id: pack.id, version: '0.2.0', status: 'publie', content: v020 as never, content_hash: hash, signature, requires: v020.requires ?? {}, changelog: 'Seuil de mortalité de la coopérative (1,5 %)',
      author_id: authorId, published_by: authorId, published_at: new Date(Date.now() - 20 * 86400_000),
    });
    await ds.getRepository(ParamReview).save({ version_id: v.id, reviewer_id: reviewerId, decision: 'approuve', comments: 'Conforme aux bornes du pack filière.' });
    await ds.getRepository(ParamPublication).save({ version_id: v.id, action: 'publish', actor_id: authorId, reason: 'seed' });
  }
  if (!(await repo.findOne({ where: { pack_id: pack.id, version: '0.3.0' } }))) {
    await repo.save({
      pack_id: pack.id, version: '0.3.0', status: 'en_revue', content: v030 as never, requires: v030.requires ?? {}, author_id: authorId,
      changelog: '2 champs ajoutés au journal (poids d’œuf, lot d’aliment). Relecture demandée à Dr Mbarga.',
    });
  }
}
