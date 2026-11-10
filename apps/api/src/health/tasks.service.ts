import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { addDays, isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { Task } from '../database/entities';
import { WriteOpts } from './health-events.service';

export const TASK_CATEGORIES = ['alimentation', 'eau', 'hygiene', 'pesee', 'reproduction', 'biosecurite', 'stock', 'traite', 'economie', 'suivi', 'autre'];

export interface TaskInput {
  id: string;
  title: string;
  category?: string;
  due_date: string;
  subject_type?: string | null;
  subject_id?: string | null;
  template_id?: string | null;
  recurrence?: string | null;
  assignee_user_id?: string | null;
  notes?: string | null;
  status?: string;
}

/** Interval in days of a minimal RRULE (FREQ=DAILY|WEEKLY;INTERVAL=n) or "every_days:n". */
export function recurrenceDays(rule: string | null | undefined): number | null {
  if (!rule) return null;
  const every = /^every_days:(\d+)$/.exec(rule);
  if (every) return Number(every[1]);
  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY)/.exec(rule)?.[1];
  if (!freq) return null;
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
  return interval * (freq === 'DAILY' ? 1 : freq === 'WEEKLY' ? 7 : 30);
}

@Injectable()
export class TasksService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
  ) {}

  async list(user: AuthUser, farmId: string, status?: string): Promise<Task[]> {
    await this.access.farm(user, farmId);
    const where: Record<string, unknown> = { farm_id: farmId };
    if (status) where.status = status;
    return this.ds.getRepository(Task).find({ where, order: { due_date: 'ASC' } });
  }

  async upsert(user: AuthUser, farmId: string, input: TaskInput, opts: WriteOpts = {}): Promise<Task> {
    await this.access.farm(user, farmId);
    const fields: Record<string, string> = {};
    if (!isDateString(input.due_date)) fields.due_date = 'date attendue (AAAA-MM-JJ)';
    if (input.category && !TASK_CATEGORIES.includes(input.category)) fields.category = 'catégorie inconnue';
    if (input.status && !['a_faire', 'fait', 'annule'].includes(input.status)) fields.status = 'statut inconnu';
    if (Object.keys(fields).length) throw Errors.validation(fields);
    const repo = this.ds.getRepository(Task);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, {
      title: input.title,
      category: input.category ?? row.category ?? 'autre',
      due_date: input.due_date,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      template_id: input.template_id ?? null,
      recurrence: input.recurrence ?? null,
      assignee_user_id: input.assignee_user_id ?? null,
      notes: input.notes ?? null,
      status: input.status ?? row.status ?? 'a_faire',
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    if (row.status === 'fait' && !row.done_at) row.done_at = new Date();
    await repo.save(row);
    return (await repo.findOne({ where: { id: row.id } }))!;
  }

  async done(user: AuthUser, id: string): Promise<{ task: Task; next: Task | null }> {
    const repo = this.ds.getRepository(Task);
    const t = await repo.findOne({ where: { id } });
    if (!t) throw Errors.notFound('Tâche');
    await this.access.farm(user, t.farm_id);
    if (t.status === 'fait') return { task: t, next: null };
    t.status = 'fait';
    t.done_at = new Date();
    t.updated_by = user.id;
    await repo.save(t);
    let next: Task | null = null;
    const every = recurrenceDays(t.recurrence);
    if (every) {
      const base = t.due_date > todayIn() ? t.due_date : todayIn();
      next = await repo.save(
        repo.create({
          id: randomUUID(), farm_id: t.farm_id, template_id: t.template_id, subject_type: t.subject_type, subject_id: t.subject_id,
          title: t.title, category: t.category, due_date: addDays(base, every), recurrence: t.recurrence, assignee_user_id: t.assignee_user_id,
          status: 'a_faire', created_by: user.id,
        }),
      );
    }
    return { task: (await repo.findOne({ where: { id } }))!, next };
  }
}
