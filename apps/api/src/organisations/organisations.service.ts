import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { addDays, isoWeek, isoWeekMonday, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { E164, normalisePhone } from '../common/text';
import { Membership, Organisation, User } from '../database/entities';
import { ParamsService } from '../params/params.service';

export const K_ANONYMITY_MIN = 5; // RG-SUR-02
const ROLES = ['proprietaire', 'membre', 'agent', 'veterinaire', 'admin', 'prestataire'];

function speculationFilter(spec?: string): string[] | null {
  if (!spec) return null;
  if (['volaille', 'aviculture'].includes(spec)) return ['volaille', 'aviculture'];
  if (['chien', 'canin', 'elevage_canin'].includes(spec)) return ['chien', 'elevage_canin', 'dressage', 'pension_canine'];
  return [spec];
}

const DB_STATUSES = ['a_venir', 'envoye', 'confirme', 'manque', 'annule', 'clos'];

/** Status filter accepting a comma list of stored statuses and engine timings (en_retard, aujourdhui, a_venir, ouvert). */
export function statusCondition(status: string | undefined, todayParam: string, listParam: string): { sql: string; statuses: string[] } {
  if (!status) return { sql: `(TRUE OR ${listParam}::text[] IS NULL)`, statuses: [] };
  const parts = status.split(',').map((s) => s.trim()).filter(Boolean);
  const ors: string[] = [];
  const stored = parts.filter((p) => DB_STATUSES.includes(p) && p !== 'a_venir');
  if (stored.length) ors.push(`r.status = ANY(${listParam}::text[])`);
  const open = `r.status IN ('a_venir','envoye')`;
  if (parts.includes('ouvert')) ors.push(open);
  if (parts.includes('en_retard')) ors.push(`(${open} AND r.due_date < ${todayParam})`);
  if (parts.includes('aujourdhui')) ors.push(`(${open} AND r.due_date = ${todayParam})`);
  if (parts.includes('a_venir')) ors.push(`(${open} AND r.due_date > ${todayParam})`);
  // The list parameter is always referenced so PostgreSQL can type it even when only timing filters are used.
  const typed = `${listParam}::text[] IS NOT NULL`;
  return { sql: ors.length ? `(${typed} AND (${ors.join(' OR ')}))` : `(FALSE AND ${typed})`, statuses: stored };
}

/** Axial hex coordinates (spiral) for the coverage map. */
export function hexSpiral(n: number): Array<{ q: number; r: number }> {
  const out = [{ q: 0, r: 0 }];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let ring = 1; out.length < n; ring++) {
    let q = -ring;
    let r = ring;
    for (const [dq, dr] of dirs) {
      for (let k = 0; k < ring && out.length < n; k++) {
        out.push({ q, r });
        q += dq;
        r += dr;
      }
    }
  }
  return out.slice(0, n);
}

function sinceLabel(d: Date): string {
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly params: ParamsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async get(user: AuthUser, id: string) {
    await this.access.assertOrgMember(user, id);
    const o = await this.ds.getRepository(Organisation).findOne({ where: { id } });
    if (!o) throw Errors.notFound('Organisation');
    const counts: Array<{ farms: number; members: number }> = await this.ds.query(
      `SELECT (SELECT count(*)::int FROM farms WHERE organisation_id = $1 AND deleted_at IS NULL) AS farms,
              (SELECT count(*)::int FROM memberships WHERE organisation_id = $1 AND deleted_at IS NULL AND status = 'actif') AS members`,
      [id],
    );
    const ent = await this.entitlements.forOrganisation(id);
    const farmers: Array<{ n: number }> = await this.ds.query(
      `SELECT count(DISTINCT owner_id)::int AS n FROM farms WHERE organisation_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return { ...o, farms_count: counts[0].farms, farmers_count: farmers[0].n, members_count: counts[0].members, plan: ent.plan, subscription_status: ent.status };
  }

  async members(user: AuthUser, orgId: string, offset: number, take: number) {
    await this.access.assertOrgMember(user, orgId);
    return this.ds.query(
      `SELECT m.id, m.user_id, u.full_name AS name, u.phone, m.role, m.status, m.farmer_scope, u.has_smartphone, u.last_active_at,
              u.last_active_at AS last_seen_at, m.created_at, m.created_at AS joined_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organisation_id = $1 AND m.deleted_at IS NULL
        ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'agent' THEN 1 WHEN 'veterinaire' THEN 2 ELSE 3 END, u.full_name
        OFFSET $2 LIMIT $3`,
      [orgId, offset, take],
    );
  }

  async addMember(user: AuthUser, orgId: string, body: { phone: string; name?: string; role: string; farmer_scope?: string[] }) {
    await this.access.assertOrgManager(user, orgId);
    const phone = normalisePhone(body.phone);
    if (!E164.test(phone)) throw Errors.validation({ phone: 'format E.164 attendu' });
    if (!ROLES.includes(body.role)) throw Errors.validation({ role: 'rôle inconnu' });
    const users = this.ds.getRepository(User);
    let u = await users.findOne({ where: { phone } });
    if (!u) u = await users.save(users.create({ phone, full_name: body.name ?? null, account_status: 'provisoire' }));
    const repo = this.ds.getRepository(Membership);
    const existing = await repo.findOne({ where: { user_id: u.id, organisation_id: orgId } });
    if (existing) throw Errors.conflict('Déjà membre', { existing_id: existing.id });
    const m = await repo.save(repo.create({ user_id: u.id, organisation_id: orgId, role: body.role, farmer_scope: body.farmer_scope ?? [], status: 'actif' }));
    return { ...m, phone: u.phone, name: u.full_name };
  }

  async patchMember(user: AuthUser, id: string, body: { role?: string; farmer_scope?: string[]; status?: string }) {
    const repo = this.ds.getRepository(Membership);
    const m = await repo.findOne({ where: { id } });
    if (!m) throw Errors.notFound('Membre');
    await this.access.assertOrgManager(user, m.organisation_id);
    if (body.role && !ROLES.includes(body.role)) throw Errors.validation({ role: 'rôle inconnu' });
    if (body.status && !['invite', 'actif', 'retire'].includes(body.status)) throw Errors.validation({ status: 'statut inconnu' });
    Object.assign(m, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    return repo.save(m);
  }

  async removeMember(user: AuthUser, id: string) {
    const repo = this.ds.getRepository(Membership);
    const m = await repo.findOne({ where: { id } });
    if (!m) throw Errors.notFound('Membre');
    await this.access.assertOrgManager(user, m.organisation_id);
    m.status = 'retire';
    await repo.save(m);
    await repo.softDelete({ id });
  }

  async farms(user: AuthUser, orgId: string, q: string | undefined, offset: number, take: number) {
    await this.access.assertOrgManager(user, orgId);
    const today = todayIn();
    return this.ds.query(
      `SELECT f.id, f.name, f.locality, f.region, f.speculations, f.gps_lat, f.gps_lng, u.full_name AS owner_name, u.phone AS owner_phone,
              u.has_smartphone, u.last_active_at, GREATEST(u.last_active_at, f.updated_at) AS last_sync_at,
              (SELECT count(*)::int FROM reminders r WHERE r.farm_id = f.id AND r.status IN ('a_venir','envoye') AND r.deleted_at IS NULL) AS open_reminders,
              (SELECT count(*)::int FROM reminders r WHERE r.farm_id = f.id AND r.status IN ('a_venir','envoye') AND r.deleted_at IS NULL AND r.due_date < $2::date) AS overdue_reminders,
              (SELECT count(*)::int FROM alert_events a WHERE a.farm_id = f.id AND a.status IN ('ouverte','escaladee','acquittee')) AS open_alerts,
              (SELECT COALESCE(sum(b.current_count),0)::int FROM batches b WHERE b.farm_id = f.id AND b.deleted_at IS NULL AND b.status = 'en_cours') AS animals
         FROM farms f JOIN users u ON u.id = f.owner_id
        WHERE f.organisation_id = $1 AND f.deleted_at IS NULL
          AND ($3::text IS NULL OR f.name ILIKE '%' || $3 || '%' OR f.locality ILIKE '%' || $3 || '%' OR u.full_name ILIKE '%' || $3 || '%')
        ORDER BY f.name OFFSET $4 LIMIT $5`,
      [orgId, today, q ?? null, offset, take],
    );
  }

  async reminders(user: AuthUser, orgId: string, status: string | undefined, offset: number, take: number) {
    await this.access.assertOrgManager(user, orgId);
    const today = todayIn();
    const cond = statusCondition(status, '$2::date', '$3');
    const rows: Array<Record<string, unknown>> = await this.ds.query(
      `SELECT r.id, r.farm_id, f.name AS farm_name, f.locality, r.subject_type, r.subject_id, r.subject_ref, r.step, r.disease, r.kind,
              r.due_date::text AS due_date, r.status, r.priority, r.short_code, r.confirmed_at, r.confirmed_via, ($2::date - r.due_date) AS days_late,
              CASE WHEN r.status IN ('a_venir','envoye') THEN CASE WHEN r.due_date < $2::date THEN 'en_retard' WHEN r.due_date = $2::date THEN 'aujourdhui' ELSE 'a_venir' END END AS timing
         FROM reminders r JOIN farms f ON f.id = r.farm_id
        WHERE f.organisation_id = $1 AND r.deleted_at IS NULL AND ${cond.sql}
        ORDER BY r.due_date ASC OFFSET $4 LIMIT $5`,
      [orgId, today, cond.statuses, offset, take],
    );
    const resolved = await this.params.resolveBase();
    return rows.map((r) => ({ ...r, label: `${this.params.label(resolved, r.disease as string)} · ${r.subject_ref ?? ''}`.trim() }));
  }

  /** Structure dashboard (Admin mock): KPIs, 12-week series, k-anonymised coverage, to-do, params, SMS usage. */
  async dashboard(user: AuthUser, orgId: string, weekParam?: string, speculation?: string, disease = 'newcastle') {
    await this.access.assertOrgManager(user, orgId);
    const org = await this.ds.getRepository(Organisation).findOne({ where: { id: orgId } });
    if (!org) throw Errors.notFound('Organisation');
    const today = todayIn();
    const week = weekParam ?? isoWeek(today);
    let monday: string;
    try {
      monday = isoWeekMonday(week);
    } catch {
      throw Errors.validation({ week: 'format AAAA-Wss attendu' });
    }
    const specs = speculationFilter(speculation);
    const farmCond = `f.organisation_id = $1 AND f.deleted_at IS NULL AND ($2::text[] IS NULL OR f.speculations && $2::text[])`;

    // 12-week series (due = reminders whose due date has arrived in that week).
    const weekly: Array<{ week_start: string; due: number; confirmed: number }> = await this.ds.query(
      `WITH weeks AS (SELECT generate_series($3::date - 77, $3::date, interval '7 day')::date AS ws)
       SELECT w.ws::text AS week_start,
              count(r.id)::int AS due,
              count(r.id) FILTER (WHERE r.status = 'confirme')::int AS confirmed
         FROM weeks w
         LEFT JOIN reminders r ON r.due_date >= w.ws AND r.due_date < w.ws + 7 AND r.due_date <= $4::date
              AND r.deleted_at IS NULL AND r.status NOT IN ('annule','clos')
              AND r.farm_id IN (SELECT f.id FROM farms f WHERE ${farmCond})
        GROUP BY w.ws ORDER BY w.ws`,
      [orgId, specs, monday, today],
    );
    const series = weekly.map((w) => ({ week: isoWeek(w.week_start), week_start: w.week_start, due: w.due, confirmed: w.confirmed }));
    const rate = (w?: { due: number; confirmed: number }) => (w && w.due ? Math.round((w.confirmed / w.due) * 1000) / 10 : null);
    const cur = series[series.length - 1];
    const prev = series[series.length - 2];
    const confirmedRate = rate(cur);
    const prevRate = rate(prev);

    const farmerStats: Array<{ total: number; active: number; no_phone: number }> = await this.ds.query(
      `SELECT count(DISTINCT f.owner_id)::int AS total,
              count(DISTINCT f.owner_id) FILTER (WHERE u.last_active_at >= now() - interval '7 days')::int AS active,
              count(DISTINCT f.owner_id) FILTER (WHERE NOT u.has_smartphone)::int AS no_phone
         FROM farms f JOIN users u ON u.id = f.owner_id WHERE ${farmCond}`,
      [orgId, specs],
    );
    const overdue: Array<{ overdue: number; j3: number }> = await this.ds.query(
      `SELECT count(*)::int AS overdue, count(*) FILTER (WHERE r.due_date <= $3::date - 3)::int AS j3
         FROM reminders r JOIN farms f ON f.id = r.farm_id
        WHERE ${farmCond} AND r.deleted_at IS NULL AND r.status IN ('a_venir','envoye') AND r.due_date < $3::date`,
      [orgId, specs, today],
    );
    const resolved = await this.params.resolve({ country: org.country, speculations: ['volaille'], organisation_id: orgId });
    const mortKpi = this.params.get<{ thresholds?: { red?: string } }>(resolved, 'kpi', 'mortalite_cumulee');
    const mortThreshold = Number(/(\d+(\.\d+)?)/.exec(mortKpi?.thresholds?.red ?? '5')?.[1] ?? 5);
    const mort: Array<{ avg: number | null; over: number }> = await this.ds.query(
      `SELECT avg(b.mortality_total::float / b.initial_count * 100) AS avg,
              count(*) FILTER (WHERE b.mortality_total::float / b.initial_count * 100 >= $3)::int AS over
         FROM batches b JOIN farms f ON f.id = b.farm_id
        WHERE ${farmCond} AND b.deleted_at IS NULL AND b.status = 'en_cours'`,
      [orgId, specs, mortThreshold],
    );

    // Coverage by zone over 30 days, cells with fewer than K farms masked (RG-SUR-02).
    const diseaseSpecies = (this.params.diseases(resolved)[disease]?.species as string[] | undefined) ?? [];
    const covSpecs = diseaseSpecies.includes('volaille') ? ['volaille', 'aviculture'] : diseaseSpecies.includes('chien') ? ['chien', 'elevage_canin'] : specs;
    const cov: Array<{ zone: string; farms: number; vaccinated: number }> = await this.ds.query(
      `SELECT COALESCE(f.locality, 'Inconnue') AS zone, count(*)::int AS farms,
              count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM health_events h WHERE h.farm_id = f.id AND h.disease = $3 AND h.deleted_at IS NULL AND h.event_date > $4::date - 30)
              OR EXISTS (
                 SELECT 1 FROM reminders r WHERE r.farm_id = f.id AND r.disease = $3 AND r.status = 'confirme' AND r.due_date > $4::date - 30))::int AS vaccinated
         FROM farms f
        WHERE f.organisation_id = $1 AND f.deleted_at IS NULL AND ($2::text[] IS NULL OR f.speculations && $2::text[])
        GROUP BY 1 ORDER BY 1`,
      [orgId, covSpecs, disease, today],
    );
    const hex = hexSpiral(cov.length);
    const cells = cov.map((c, i) => {
      const masked = c.farms < K_ANONYMITY_MIN;
      return { zone: c.zone, rate: masked ? null : Math.round((c.vaccinated / c.farms) * 1000) / 10, masked, q: hex[i].q, r: hex[i].r, ...(masked ? {} : { farms: c.farms }) };
    });

    const alerts: Array<{ id: string; severity: string; farm_name: string | null; reason: string | null; title: string | null; opened_at: Date; action_label: string | null; farm_id: string | null }> = await this.ds.query(
      `SELECT a.id, a.severity, COALESCE(f.name, a.title) AS farm_name, a.reason, a.title, a.opened_at, a.action_label, a.farm_id
         FROM alert_events a LEFT JOIN farms f ON f.id = a.farm_id
        WHERE (a.organisation_id = $1 OR f.organisation_id = $1) AND a.status IN ('ouverte','escaladee','acquittee')
        ORDER BY CASE a.severity WHEN 'critique' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, a.opened_at DESC LIMIT 20`,
      [orgId],
    );
    const todo = alerts.map((a) => ({
      id: a.id,
      severity: a.severity === 'critique' ? 'critique' : a.severity === 'attention' ? 'elevee' : 'info',
      farm_id: a.farm_id,
      farm_name: a.farm_name,
      reason: a.reason,
      since: new Date(a.opened_at).toISOString(),
      since_label: sinceLabel(new Date(a.opened_at)),
      action: a.action_label ?? 'Voir',
    }));

    const stack = await this.params.stackFor({ country: org.country, speculations: ['volaille'], organisation_id: orgId });
    const params = stack.map((p) => ({ pack: p.doc.pack, version: p.doc.version, status: 'publie' }));
    const pending: Array<{ id: string; code: string; version: string; status: string; changelog: string | null }> = await this.ds.query(
      `SELECT v.id, p.code, v.version, v.status, v.changelog FROM param_pack_versions v JOIN param_packs p ON p.id = v.pack_id
        WHERE p.level = 'org' AND p.scope_ref = $1 AND v.status IN ('en_revue','teste','brouillon') ORDER BY v.created_at DESC LIMIT 1`,
      [orgId],
    );
    if (pending[0]) params.push({ pack: pending[0].code, version: pending[0].version, status: pending[0].status });

    const ent = await this.entitlements.forOrganisation(orgId);
    const used: Array<{ value: number }> = await this.ds.query(
      `SELECT value FROM usage_counters WHERE account_type = 'organisation' AND account_id = $1 AND period = $2 AND metric = 'sms'`,
      [orgId, today.slice(0, 7)],
    );

    return {
      organisation: { id: org.id, name: org.name },
      week,
      period: { from: monday, to: addDays(monday, 6) },
      speculation: speculation ?? null,
      kpis: {
        confirmed_rate: confirmedRate,
        confirmed_rate_delta_pts: confirmedRate !== null && prevRate !== null ? Math.round((confirmedRate - prevRate) * 10) / 10 : null,
        target_rate: Number(org.settings?.target_rate ?? 85),
        confirmed: cur?.confirmed ?? 0,
        due: cur?.due ?? 0,
        active_farmers_7d: farmerStats[0].active,
        total_farmers: farmerStats[0].total,
        farmers_without_smartphone: farmerStats[0].no_phone,
        overdue_reminders: overdue[0].overdue,
        overdue_j3: overdue[0].j3,
        avg_mortality_pct: mort[0].avg === null ? null : Math.round(Number(mort[0].avg) * 10) / 10,
        batches_over_threshold: mort[0].over,
        mortality_threshold_pct: mortThreshold,
      },
      weekly: series.map(({ week: w, due, confirmed }) => ({ week: w, due, confirmed })),
      coverage: { disease, disease_label: this.params.label(resolved, disease), period_days: 30, window_days: 30, k_min: K_ANONYMITY_MIN, cells },
      todo,
      params,
      ...(pending[0]
        ? { pending_change: { version_id: pending[0].id, pack: pending[0].code, version: pending[0].version, status: pending[0].status, summary: pending[0].changelog, reviewer_name: /demandée à ([^.]+)/.exec(pending[0].changelog ?? '')?.[1]?.trim() ?? null } }
        : {}),
      sms: { used: used[0]?.value ?? 0, quota: ent.quotas.sms_per_month ?? 0 },
    };
  }
}
