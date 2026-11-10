import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { addDays, daysBetween, todayIn } from '../common/dates';
import { Farm, HealthEvent, Reminder } from '../database/entities';
import {
  ComputedReminder, computeManualReminders, computeProtocolReminders, notificationPlan, timing,
} from '../params/engine/reminders';
import { Resolved } from '../params/engine/types';
import { ParamsService } from '../params/params.service';
import { SubjectInfo, SubjectsService } from './subjects.service';

export const OPEN_STATUSES = ['a_venir', 'envoye'];

/** Materialises the reminder engine output (ENGINES.md §2) into the `reminders` table. */
@Injectable()
export class RemindersService {
  constructor(
    private readonly ds: DataSource,
    private readonly params: ParamsService,
    private readonly subjects: SubjectsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Engine output for a subject (pure computation, nothing persisted). */
  async compute(subject: SubjectInfo, farm: Farm, today = todayIn(), resolved?: Resolved): Promise<ComputedReminder[]> {
    const r = resolved ?? (await this.params.resolveFarm(farm));
    const diseases = this.params.diseases(r);
    const events = await this.ds.getRepository(HealthEvent).find({ where: { subject_type: subject.type, subject_id: subject.id } });
    const engineEvents = events.map((e) => ({ protocol_step: e.protocol_step, disease: e.disease, event_date: e.event_date, next_due: e.next_due }));
    const engineSubject = { type: subject.type, start_date: subject.start_date, birth_date: subject.birth_date, created_at: subject.created_date };
    const out: ComputedReminder[] = [];
    for (const p of this.params.protocols(r, subject.species, subject.production_type)) {
      out.push(...computeProtocolReminders(p, engineSubject, engineEvents, today, diseases));
    }
    out.push(...computeManualReminders(engineEvents, today, diseases));
    return out;
  }

  private async shortCode(m: EntityManager, ownerId: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = String(randomInt(1000, 10000));
      const rows = await m.query(
        `SELECT 1 FROM reminders r JOIN farms f ON f.id = r.farm_id
          WHERE f.owner_id = $1 AND r.short_code = $2 AND r.status IN ('a_venir','envoye') LIMIT 1`,
        [ownerId, code],
      );
      if (!rows.length) return code;
    }
    return String(randomInt(10000, 100000));
  }

  /** Recomputes and upserts open reminders for one subject. Returns the open reminders. */
  async recompute(subjectType: string, subjectId: string, opts: { today?: string; manager?: EntityManager } = {}): Promise<Reminder[]> {
    const m = opts.manager ?? this.ds.manager;
    const today = opts.today ?? todayIn();
    const subject = await this.subjects.load(subjectType, subjectId, { withDeleted: true });
    const repo = m.getRepository(Reminder);
    const farm = await m.getRepository(Farm).findOne({ where: { id: subject.farm_id }, withDeleted: true });
    if (!farm) return [];
    const existing = await repo.find({ where: { subject_type: subject.type, subject_id: subject.id, status: In(OPEN_STATUSES) } });
    if ((subject.entity as { deleted_at?: Date | null }).deleted_at || (subject.entity as { status?: string }).status === 'terminee') {
      for (const e of existing) {
        e.status = 'clos';
        e.cancel_reason = 'sujet retiré';
      }
      await repo.save(existing);
      return [];
    }
    const resolved = await this.params.resolveFarm(farm);
    const computed = await this.compute(subject, farm, today, resolved);
    const ent = await this.entitlements.forFarm(farm);
    const plan = this.params.reminderPlan(resolved);
    const events = await m.getRepository(HealthEvent).find({ where: { subject_type: subject.type, subject_id: subject.id } });
    const byStep = new Map(existing.map((e) => [e.step ?? '', e]));
    const keep = new Set<string>();
    const toSave: Reminder[] = [];

    for (const c of computed) {
      const channelPlan = plan ? notificationPlan(plan, c.due_date, ent.features) : [];
      const cur = byStep.get(c.step);
      if (cur && cur.due_date !== c.due_date) {
        // Same step with a new date (recurrence moved by a new act): close the old occurrence.
        const doneAct = events.find((e) => e.disease === c.disease && e.event_date >= addDays(cur.due_date, -30));
        if (doneAct) {
          cur.status = 'confirme';
          cur.confirmed_at = cur.confirmed_at ?? new Date();
          cur.health_event_id = cur.health_event_id ?? doneAct.id;
          cur.confirmed_via = cur.confirmed_via ?? 'acte';
          await repo.save(cur);
          byStep.delete(c.step);
        }
      }
      const target = byStep.get(c.step);
      if (target) {
        keep.add(target.id);
        target.due_date = c.due_date;
        target.priority = c.priority;
        target.kind = c.kind;
        target.disease = c.disease;
        target.protocol_code = c.protocol ?? null;
        target.channel_plan = channelPlan;
        target.subject_ref = subject.label;
        target.param_version = resolved.param_version;
        toSave.push(target);
      } else {
        const r = repo.create({
          id: randomUUID(),
          farm_id: farm.id,
          source_type: 'health_event',
          subject_type: subject.type,
          subject_id: subject.id,
          subject_ref: subject.label,
          protocol_code: c.protocol ?? null,
          step: c.step,
          disease: c.disease,
          kind: c.kind,
          due_date: c.due_date,
          priority: c.priority,
          status: 'a_venir',
          channel_plan: channelPlan,
          short_code: await this.shortCode(m, farm.owner_id),
          param_version: resolved.param_version,
        });
        toSave.push(r);
      }
    }
    for (const e of existing) {
      if (keep.has(e.id) || !byStep.has(e.step ?? '')) continue;
      const done = events.find((ev) => ev.protocol_step === e.step || (e.kind !== 'protocole' && ev.disease === e.disease && ev.event_date >= addDays(e.due_date, -30)));
      if (done) {
        e.status = 'confirme';
        e.confirmed_at = e.confirmed_at ?? new Date();
        e.health_event_id = e.health_event_id ?? done.id;
        e.confirmed_via = e.confirmed_via ?? 'acte';
      } else {
        e.status = 'clos';
        e.cancel_reason = 'hors protocole';
      }
      toSave.push(e);
    }
    // Save closed rows before inserting new ones (partial unique index on open steps).
    const closing = toSave.filter((r) => !OPEN_STATUSES.includes(r.status));
    const open = toSave.filter((r) => OPEN_STATUSES.includes(r.status));
    if (closing.length) await repo.save(closing);
    if (open.length) await repo.save(open);
    return repo.find({ where: { subject_type: subject.type, subject_id: subject.id, status: In(OPEN_STATUSES) }, order: { due_date: 'ASC' } });
  }

  serialize(r: Reminder, today = todayIn()) {
    const open = OPEN_STATUSES.includes(r.status);
    return {
      id: r.id,
      farm_id: r.farm_id,
      source_type: r.source_type,
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      subject_ref: r.subject_ref,
      protocol_code: r.protocol_code,
      step: r.step,
      protocol_step: r.kind === 'protocole' ? r.step : null,
      disease: r.disease,
      kind: r.kind,
      due_date: r.due_date,
      days_until: daysBetween(today, r.due_date),
      status: r.status,
      timing: open ? timing(r.due_date, today) : null,
      priority: r.priority,
      short_code: r.short_code,
      channel_plan: r.channel_plan,
      sent_at: r.sent_at,
      confirmed_at: r.confirmed_at,
      confirmed_via: r.confirmed_via,
      snoozed_until: r.snoozed_until,
      cancel_reason: r.cancel_reason,
      health_event_id: r.health_event_id,
      param_version: r.param_version,
      created_at: r.created_at,
      updated_at: r.updated_at,
      sync_version: Number(r.sync_version),
    };
  }
}
