import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { money } from '../common/pagination';
import { HealthEvent, Reminder, StockMovement } from '../database/entities';
import { validateForm } from '../params/engine/forms';
import { ParamsService } from '../params/params.service';
import { OPEN_STATUSES, RemindersService } from './reminders.service';
import { SubjectsService } from './subjects.service';

export const EVENT_TYPES = ['vaccination', 'traitement', 'deparasitage', 'vitamines', 'desinfection', 'depistage', 'soin_neonatal'];

export interface HealthEventInput {
  id: string;
  subject_type: string;
  subject_id: string;
  event_type: string;
  disease?: string | null;
  product?: string | null;
  product_batch_no?: string | null;
  dose_route?: string | null;
  event_date: string;
  next_due?: string | null;
  withdrawal_meat_until?: string | null;
  withdrawal_milk_until?: string | null;
  withdrawal_eggs_until?: string | null;
  protocol_id?: string | null;
  protocol_step?: string | null;
  cost?: { amount_minor: number; currency: string } | null;
  performed_by?: string | null;
  campaign_id?: string | null;
  active_substance_code?: string | null;
  quantity_value?: number | null;
  quantity_unit?: string | null;
  doses_count?: number | null;
  notes?: string | null;
  consume_stock?: { item_id: string; quantity: number } | null;
  attributes?: Record<string, unknown>;
}

export interface WriteOpts {
  deviceId?: string | null;
  clientRev?: number;
}

@Injectable()
export class HealthEventsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly subjects: SubjectsService,
    private readonly reminders: RemindersService,
    private readonly params: ParamsService,
  ) {}

  serialize(e: HealthEvent) {
    const { cost_minor, currency, ...rest } = e;
    return { ...rest, cost: money(cost_minor, currency), sync_version: Number(e.sync_version) };
  }

  async list(user: AuthUser, q: { subject_type?: string; subject_id?: string; farm_id?: string; limit: number; offset: number }) {
    let farmIds: string[];
    if (q.subject_type && q.subject_id) {
      const s = await this.subjects.load(q.subject_type, q.subject_id);
      await this.access.farm(user, s.farm_id);
      farmIds = [s.farm_id];
    } else if (q.farm_id) {
      await this.access.farm(user, q.farm_id);
      farmIds = [q.farm_id];
    } else {
      farmIds = await this.access.farmIds(user);
    }
    if (!farmIds.length) return [];
    const where: Record<string, unknown> = { farm_id: In(farmIds) };
    if (q.subject_type) where.subject_type = q.subject_type;
    if (q.subject_id) where.subject_id = q.subject_id;
    return this.ds.getRepository(HealthEvent).find({ where, order: { event_date: 'DESC', created_at: 'DESC' }, skip: q.offset, take: q.limit });
  }

  async get(user: AuthUser, id: string): Promise<HealthEvent> {
    const e = await this.ds.getRepository(HealthEvent).findOne({ where: { id } });
    if (!e) throw Errors.notFound('Acte');
    await this.access.farm(user, e.farm_id);
    return e;
  }

  /** Create or idempotent upsert (05 §7). Recomputes the subject's reminders. */
  async upsert(user: AuthUser, input: HealthEventInput, opts: WriteOpts = {}) {
    const subject = await this.subjects.load(input.subject_type, input.subject_id);
    const farm = await this.access.farm(user, subject.farm_id);
    const resolved = await this.params.resolveFarm(farm);
    const fields: Record<string, string> = {};
    if (!EVENT_TYPES.includes(input.event_type)) fields.event_type = 'type d’acte inconnu';
    if (!isDateString(input.event_date)) fields.event_date = 'date attendue (AAAA-MM-JJ)';
    else if (input.event_date > todayIn()) fields.event_date = 'date future interdite';
    if (input.disease && !this.params.diseases(resolved)[input.disease]) fields.disease = 'maladie inconnue du référentiel';
    for (const k of ['next_due', 'withdrawal_meat_until', 'withdrawal_milk_until', 'withdrawal_eggs_until'] as const) {
      if (input[k] && !isDateString(input[k])) fields[k] = 'date attendue (AAAA-MM-JJ)';
    }
    let protocolId = input.protocol_id ?? null;
    if (input.protocol_step) {
      const protocols = this.params.protocols(resolved, subject.species, subject.production_type);
      const owner = protocols.find((p) => (protocolId ? p.code === protocolId : true) && p.steps.some((s) => s.code === input.protocol_step));
      if (!owner) fields.protocol_step = 'étape inconnue pour ce sujet';
      else {
        protocolId = owner.code;
        if (!input.disease) input.disease = owner.steps.find((s) => s.code === input.protocol_step)!.disease;
      }
    }
    const form = this.params.form(resolved, 'health_event', subject.species);
    if (form) {
      const r = validateForm(form, input as never, (v) => ({ subject: subject.ctx, event: v }));
      Object.assign(fields, r.errors);
    }
    if (Object.keys(fields).length) throw Errors.validation(fields);

    const repo = this.ds.getRepository(HealthEvent);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && (existing.subject_id !== input.subject_id || existing.farm_id !== farm.id)) {
      throw Errors.conflict('Identifiant déjà utilisé pour un autre sujet', { existing_id: existing.id });
    }
    const row = existing ?? repo.create({ id: input.id, created_by: user.id });
    Object.assign(row, {
      farm_id: farm.id,
      subject_type: subject.type,
      subject_id: subject.id,
      event_type: input.event_type,
      disease: input.disease ?? null,
      product: input.product ?? null,
      product_batch_no: input.product_batch_no ?? null,
      dose_route: input.dose_route ?? null,
      event_date: input.event_date,
      next_due: input.next_due ?? null,
      withdrawal_meat_until: input.withdrawal_meat_until ?? null,
      withdrawal_milk_until: input.withdrawal_milk_until ?? null,
      withdrawal_eggs_until: input.withdrawal_eggs_until ?? null,
      protocol_id: protocolId,
      protocol_step: input.protocol_step ?? null,
      cost_minor: input.cost?.amount_minor ?? null,
      currency: input.cost?.currency ?? (input.cost ? farm.currency : null),
      performed_by: input.performed_by ?? null,
      campaign_id: input.campaign_id ?? null,
      active_substance_code: input.active_substance_code ?? null,
      quantity_value: input.quantity_value ?? null,
      quantity_unit: input.quantity_unit ?? null,
      doses_count: input.doses_count ?? null,
      notes: input.notes ?? null,
      attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) },
      param_version: resolved.param_version,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await this.ds.transaction(async (m) => {
      await m.getRepository(HealthEvent).save(row);
      if (input.consume_stock && !existing?.stock_movement_id) {
        const mv = m.getRepository(StockMovement).create({
          id: randomUUID(),
          farm_id: farm.id,
          item_id: input.consume_stock.item_id,
          movement_date: input.event_date,
          direction: 'sortie',
          quantity: input.consume_stock.quantity,
          subject_type: subject.type,
          subject_id: subject.id,
          health_event_id: row.id,
          notes: `Acte ${input.event_type}${input.disease ? ` ${input.disease}` : ''}`,
          created_by: user.id,
        });
        await m.getRepository(StockMovement).save(mv);
        row.stock_movement_id = mv.id;
        await m.getRepository(HealthEvent).save(row);
      }
    });
    const reminders = await this.reminders.recompute(subject.type, subject.id);
    const saved = (await repo.findOne({ where: { id: row.id } }))!;
    return { ...this.serialize(saved), reminders: reminders.map((r) => this.reminders.serialize(r)) };
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const e = await this.get(user, id);
    await this.ds.getRepository(HealthEvent).softDelete({ id: e.id });
    await this.reminders.recompute(e.subject_type, e.subject_id);
  }

  /** POST /reminders/:id/confirm — closes the reminder and plans the next occurrence (05 §7). */
  async confirmReminder(user: AuthUser, reminderId: string, body: Partial<HealthEventInput> = {}, via = 'app') {
    const repo = this.ds.getRepository(Reminder);
    const r = await repo.findOne({ where: { id: reminderId } });
    if (!r) throw Errors.notFound('Rappel');
    await this.access.farm(user, r.farm_id);
    if (r.status === 'confirme') return { reminder: this.reminders.serialize(r), health_event: null, next: [] };
    if (!OPEN_STATUSES.includes(r.status)) throw Errors.business('RG-VAC-02', 'Ce rappel n’est plus ouvert', { status: r.status });
    if (!r.subject_type || !r.subject_id) {
      // Reminder without a subject (imported history, farm-level reminder): confirmed without recording an act.
      r.status = 'confirme';
      r.confirmed_at = new Date();
      r.confirmed_by = user.id;
      r.confirmed_via = via;
      await repo.save(r);
      return { reminder: this.reminders.serialize((await repo.findOne({ where: { id: r.id } }))!), health_event: null, next: [] };
    }
    const eventInput: HealthEventInput = {
      id: body.id ?? randomUUID(),
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      event_type: body.event_type ?? 'vaccination',
      disease: body.disease ?? r.disease,
      event_date: body.event_date ?? todayIn(),
      protocol_id: body.protocol_id ?? (r.kind === 'protocole' ? r.protocol_code : null),
      protocol_step: body.protocol_step ?? (r.kind === 'protocole' ? r.step : null),
      ...body,
    } as HealthEventInput;
    r.status = 'confirme';
    r.confirmed_at = new Date();
    r.confirmed_by = user.id;
    r.confirmed_via = via;
    r.health_event_id = eventInput.id;
    await repo.save(r);
    try {
      const ev = await this.upsert(user, eventInput);
      const fresh = (await repo.findOne({ where: { id: r.id } }))!;
      const { reminders, ...event } = ev;
      return { reminder: this.reminders.serialize(fresh), health_event: event, next: reminders };
    } catch (e) {
      // Restore the reminder when the act could not be recorded.
      await repo.update({ id: r.id }, { status: 'a_venir', confirmed_at: null, confirmed_by: null, confirmed_via: null, health_event_id: null });
      throw e;
    }
  }
}
