import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { AlertEvent, DailyLog } from '../database/entities';
import { WriteOpts } from '../health/health-events.service';
import { SubjectInfo, SubjectsService } from '../health/subjects.service';
import { LivestockService } from '../livestock/livestock.service';
import { computeFields, validateForm } from '../params/engine/forms';
import { ParamsService } from '../params/params.service';

export const LOG_COLUMNS = [
  'present_count', 'mortality', 'culled', 'eggs', 'eggs_broken', 'milk_l', 'milk_sold_l', 'feed_kg', 'feed_item_id', 'water_l', 'temperature_c', 'notes',
] as const;
const NUMERIC = ['present_count', 'mortality', 'culled', 'eggs', 'eggs_broken', 'milk_l', 'milk_sold_l', 'feed_kg', 'water_l', 'temperature_c'];

export interface DailyLogInput {
  id: string;
  subject_type: string;
  subject_id: string;
  log_date: string;
  present_count?: number | null;
  mortality?: number;
  culled?: number;
  eggs?: number | null;
  eggs_broken?: number | null;
  milk_l?: number | null;
  milk_sold_l?: number | null;
  feed_kg?: number | null;
  feed_item_id?: string | null;
  water_l?: number | null;
  temperature_c?: number | null;
  notes?: string | null;
  measured_fields?: string[];
  attributes?: Record<string, unknown>;
}

/**
 * Conflict merge for daily logs (MVP-SCOPE §Synchronisation): mortalities and culls are summed,
 * other counts/quantities keep the maximum, notes are concatenated, attributes merged (incoming wins).
 */
export function mergeDailyLogs(server: Partial<DailyLog>, incoming: Partial<DailyLogInput>): Partial<DailyLogInput> {
  const out: Record<string, unknown> = {};
  for (const k of ['mortality', 'culled'] as const) out[k] = Number(server[k] ?? 0) + Number(incoming[k] ?? 0);
  for (const k of ['present_count', 'eggs', 'eggs_broken', 'milk_l', 'milk_sold_l', 'feed_kg', 'water_l'] as const) {
    const a = server[k];
    const b = incoming[k];
    out[k] = a === null || a === undefined ? (b ?? null) : b === null || b === undefined ? a : Math.max(Number(a), Number(b));
  }
  out.temperature_c = incoming.temperature_c ?? server.temperature_c ?? null;
  out.feed_item_id = incoming.feed_item_id ?? server.feed_item_id ?? null;
  const notes = [server.notes, incoming.notes].filter((n) => n && String(n).trim());
  out.notes = notes.length ? [...new Set(notes)].join(' | ') : null;
  out.attributes = { ...(server.attributes ?? {}), ...(incoming.attributes ?? {}) };
  return out as Partial<DailyLogInput>;
}

@Injectable()
export class JournalService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly subjects: SubjectsService,
    private readonly params: ParamsService,
    private readonly livestock: LivestockService,
    private readonly alerts: AlertsService,
  ) {}

  serialize(l: DailyLog, computed: Record<string, unknown> = {}) {
    return { ...l, sync_version: Number(l.sync_version), computed };
  }

  async list(user: AuthUser, farmId: string, q: { subject_type?: string; subject_id?: string; date_from?: string; date_to?: string }, offset: number, take: number) {
    await this.access.farm(user, farmId);
    const qb = this.ds.getRepository(DailyLog).createQueryBuilder('l').where('l.farm_id = :farmId', { farmId });
    if (q.subject_type) qb.andWhere('l.subject_type = :st', { st: q.subject_type });
    if (q.subject_id) qb.andWhere('l.subject_id = :sid', { sid: q.subject_id });
    if (q.date_from) qb.andWhere('l.log_date >= :df', { df: q.date_from });
    if (q.date_to) qb.andWhere('l.log_date <= :dt', { dt: q.date_to });
    const rows = await qb.orderBy('l.log_date', 'DESC').skip(offset).take(take).getMany();
    const ids = [...new Set(rows.map((r) => r.subject_id))];
    const names: Array<{ id: string; name: string }> = ids.length
      ? await this.ds.query(`SELECT id, name FROM batches WHERE id = ANY($1) UNION ALL SELECT id, name FROM dogs WHERE id = ANY($1) UNION ALL SELECT id, coalesce(name, tag) FROM animals WHERE id = ANY($1)`, [ids])
      : [];
    const map = new Map(names.map((n) => [n.id, n.name]));
    return rows.map((r) => Object.assign(r, { subject_name: map.get(r.subject_id) ?? null }));
  }

  async findBySubjectDate(subjectType: string, subjectId: string, date: string): Promise<DailyLog | null> {
    return this.ds.getRepository(DailyLog).findOne({ where: { subject_type: subjectType, subject_id: subjectId, log_date: date } });
  }

  private presentBefore(subject: SubjectInfo, existing: DailyLog | null): number | null {
    if (subject.type !== 'batch') return 1;
    const b = subject.entity as { current_count: number | null; initial_count: number };
    const current = b.current_count ?? b.initial_count;
    // Present count at the start of the day: current count plus what this log already removed.
    return current + (existing ? existing.mortality + existing.culled : 0);
  }

  /**
   * Creates or updates a log. `mode = 'create'` refuses a second log for the same (subject, date)
   * with 409 CONFLICT + details.existing_id (RG-JOU-05); `mode = 'upsert'` is used by PATCH and sync.
   */
  async save(user: AuthUser, farmId: string | null, input: DailyLogInput, opts: WriteOpts & { mode?: 'create' | 'upsert' } = {}) {
    const subject = await this.subjects.load(input.subject_type, input.subject_id);
    if (farmId && subject.farm_id !== farmId) throw Errors.validation({ subject_id: 'sujet d’une autre exploitation' });
    const farm = await this.access.farm(user, subject.farm_id);
    if (!isDateString(input.log_date)) throw Errors.validation({ log_date: 'date attendue (AAAA-MM-JJ)' });
    if (input.log_date > todayIn()) throw Errors.validation({ log_date: 'date future interdite' });
    const repo = this.ds.getRepository(DailyLog);
    const byId = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    const bySubjectDate = await this.findBySubjectDate(subject.type, subject.id, input.log_date);
    if (bySubjectDate && bySubjectDate.id !== input.id) {
      throw Errors.conflict('Un journal existe déjà pour ce sujet et cette date', { existing_id: bySubjectDate.id, rule: 'RG-JOU-05' });
    }
    if (byId && (byId.subject_id !== subject.id || byId.log_date !== input.log_date) && opts.mode === 'create') {
      throw Errors.conflict('Identifiant déjà utilisé', { existing_id: byId.id });
    }
    const existing = byId;
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...input, attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) } };
    for (const k of NUMERIC) if (typeof merged[k] === 'string' && merged[k] !== '') merged[k] = Number(merged[k]);
    const present = (merged.present_count as number | null | undefined) ?? this.presentBefore(subject, existing);
    merged.present_count = present;
    merged.mortality = merged.mortality ?? 0;
    merged.culled = merged.culled ?? 0;

    const resolved = await this.params.resolveFarm(farm);
    const form = this.params.form(resolved, 'daily_log', subject.species);
    const fields: Record<string, string> = {};
    let attributes = merged.attributes as Record<string, unknown>;
    let computed: Record<string, unknown> = {};
    if (form) {
      const r = validateForm(form, merged as never, (v) => ({ subject: subject.ctx, log: { ...merged, ...v }, now: todayIn() }));
      Object.assign(fields, r.errors);
      attributes = r.attributes;
      for (const [k, v] of Object.entries(r.columns)) if (v !== undefined) merged[k] = v;
      computed = computeFields(form, { subject: subject.ctx, log: merged, now: todayIn() });
    }
    for (const k of ['mortality', 'culled', 'eggs', 'eggs_broken', 'present_count'] as const) {
      const v = merged[k];
      if (v !== null && v !== undefined && (!Number.isInteger(v) || (v as number) < 0)) fields[k] = fields[k] ?? 'entier ≥ 0 attendu';
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);
    if (present !== null && (merged.mortality as number) + (merged.culled as number) > present) {
      throw Errors.business('RG-JOU-03', 'La mortalité du jour dépasse l’effectif présent', { present_count: present, mortality: merged.mortality });
    }

    const row = existing ?? repo.create({ id: input.id, created_by: user.id });
    for (const k of LOG_COLUMNS) if (merged[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = merged[k];
    Object.assign(row, {
      farm_id: subject.farm_id,
      subject_type: subject.type,
      subject_id: subject.id,
      log_date: input.log_date,
      measured_fields: input.measured_fields ?? existing?.measured_fields ?? [],
      attributes,
      param_version: resolved.param_version,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    if (subject.type === 'batch') await this.livestock.recount(subject.id);
    const alerts: AlertEvent[] = await this.alerts.evaluateDailyLog(farm, subject, row, present);
    const critical = alerts.find((a) => a.severity === 'critique');
    if (critical && row.alert_event_id !== critical.id) {
      row.alert_event_id = critical.id;
      await repo.save(row);
    }
    const saved = (await repo.findOne({ where: { id: row.id } }))!;
    return { ...this.serialize(saved, computed), alerts: alerts.map((a) => this.alerts.serialize(a)) };
  }

  async get(user: AuthUser, id: string): Promise<DailyLog> {
    const l = await this.ds.getRepository(DailyLog).findOne({ where: { id } });
    if (!l) throw Errors.notFound('Journal');
    await this.access.farm(user, l.farm_id);
    return l;
  }
}
