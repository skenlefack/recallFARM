import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { addDays, isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { decodeCursor, encodeCursor, paginate } from '../common/pagination';
import { Reminder } from '../database/entities';
import { ParamsService } from '../params/params.service';
import { CertificatesService } from './certificates.service';
import {
  CancelDto, ConfirmReminderDto, CreateHealthEventDto, HealthEventsQuery, ProtocolsQuery, RemindersQuery, SnoozeDto, TaskDto, TasksQuery, VerifyQuery,
} from './dto';
import { HealthEventInput, HealthEventsService } from './health-events.service';
import { OPEN_STATUSES, RemindersService } from './reminders.service';
import { TasksService } from './tasks.service';

@ApiTags('health')
@ApiBearerAuth()
@Controller()
export class HealthController {
  constructor(
    private readonly ds: DataSource,
    private readonly events: HealthEventsService,
    private readonly reminders: RemindersService,
    private readonly tasks: TasksService,
    private readonly certificates: CertificatesService,
    private readonly params: ParamsService,
    private readonly access: AccessService,
  ) {}

  // ---- Health events -------------------------------------------------------------------
  @Post('health-events')
  createEvent(@CurrentUser() user: AuthUser, @Body() dto: CreateHealthEventDto) {
    return this.events.upsert(user, dto as HealthEventInput);
  }

  @Get('health-events')
  async listEvents(@CurrentUser() user: AuthUser, @Query() q: HealthEventsQuery) {
    return paginate(q, (offset, take) => this.events.list(user, { ...q, offset, limit: take }), (e) => this.events.serialize(e));
  }

  @Get('health-events/:id')
  async getEvent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.serialize(await this.events.get(user, id));
  }

  @Delete('health-events/:id')
  @HttpCode(204)
  async deleteEvent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.events.remove(user, id);
  }

  @Get('health-events/:id/certificate')
  @ApiProduces('application/pdf')
  async certificate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.certificates.pdf(user, id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="certificat-${id}.pdf"`);
    res.send(pdf);
  }

  @Get('health-events/:id/certificate.json')
  certificateJson(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.certificates.json(user, id);
  }

  @Public()
  @Get('certificates/verify')
  verify(@Query() q: VerifyQuery) {
    return this.certificates.verify(q.payload);
  }

  // ---- Protocols -----------------------------------------------------------------------
  @Get('protocols')
  async protocols(@CurrentUser() user: AuthUser, @Query() q: ProtocolsQuery) {
    const resolved = q.farm_id
      ? await this.params.resolveFarm(await this.access.farm(user, q.farm_id))
      : await this.params.resolveBase(q.country ?? 'CM');
    const list = Object.entries(resolved.objects)
      .filter(([, o]) => o.kind === 'vaccination_protocol')
      .filter(([, o]) => !q.species || o.species === q.species)
      .filter(([, o]) => !q.disease || (o.steps as Array<{ disease: string }>).some((s) => s.disease === q.disease) || (o.recurring as { disease?: string })?.disease === q.disease)
      .map(([key, o]) => ({ ...o, label: this.params.label(resolved, o.code), provenance: resolved.provenance[key] }));
    return { data: list, next_cursor: null, param_version: resolved.param_version };
  }

  // ---- Reminders -----------------------------------------------------------------------
  @Get('reminders')
  async listReminders(@CurrentUser() user: AuthUser, @Query() q: RemindersQuery) {
    const farmIds = q.farm_id ? [(await this.access.farm(user, q.farm_id)).id] : await this.access.farmIds(user);
    if (!farmIds.length) return { data: [], next_cursor: null };
    const today = todayIn();
    const qb = this.ds.getRepository(Reminder).createQueryBuilder('r').where('r.farm_id IN (:...farmIds)', { farmIds });
    if (q.status) {
      const parts = q.status.split(',').map((x) => x.trim()).filter(Boolean);
      const stored = parts.filter((p) => ['envoye', 'confirme', 'manque', 'annule', 'clos'].includes(p));
      const ors: string[] = [];
      const open = `r.status IN ('a_venir','envoye')`;
      if (stored.length) ors.push('r.status IN (:...stored)');
      if (parts.includes('ouvert') || parts.includes('a_venir_ou_envoye')) ors.push(open);
      if (parts.includes('en_retard')) ors.push(`(${open} AND r.due_date < :today)`);
      if (parts.includes('aujourdhui')) ors.push(`(${open} AND r.due_date = :today)`);
      if (parts.includes('a_venir')) ors.push(`(${open} AND r.due_date > :today)`);
      qb.andWhere(ors.length ? `(${ors.join(' OR ')})` : 'FALSE', { stored, today });
    }
    if (q.priority) qb.andWhere('r.priority = :priority', { priority: q.priority });
    if (q.due_before) {
      if (!isDateString(q.due_before)) throw Errors.validation({ due_before: 'date invalide' });
      qb.andWhere('r.due_date <= :dueBefore', { dueBefore: q.due_before });
    }
    const limit = q.limit ?? 50;
    const offset = decodeCursor(q.cursor);
    const rows = await qb.orderBy('r.due_date', 'ASC').addOrderBy('r.priority', 'ASC').skip(offset).take(limit + 1).getMany();
    const farmNames = new Map<string, string>(
      (await this.ds.query(`SELECT id, name FROM farms WHERE id = ANY($1)`, [[...new Set(rows.map((r) => r.farm_id))]])).map((f: { id: string; name: string }) => [f.id, f.name]),
    );
    const resolved = await this.params.resolveBase();
    return {
      data: rows.slice(0, limit).map((r) => ({
        ...this.reminders.serialize(r, today),
        farm_name: farmNames.get(r.farm_id) ?? null,
        disease_label: this.params.label(resolved, r.disease),
        label: `${this.params.label(resolved, r.disease)} · ${r.subject_ref ?? ''}`.trim(),
      })),
      next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }

  private async reminder(user: AuthUser, id: string): Promise<Reminder> {
    const r = await this.ds.getRepository(Reminder).findOne({ where: { id } });
    if (!r) throw Errors.notFound('Rappel');
    await this.access.farm(user, r.farm_id);
    return r;
  }

  @Post('reminders/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReminderDto) {
    return this.events.confirmReminder(user, id, (dto.health_event ?? {}) as Partial<HealthEventInput>, 'app');
  }

  @Post('reminders/:id/snooze')
  @HttpCode(200)
  async snooze(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SnoozeDto) {
    const r = await this.reminder(user, id);
    const today = todayIn();
    if (!isDateString(dto.until) || dto.until <= today) throw Errors.validation({ until: 'date future attendue' });
    if (dto.until > addDays(today, 14)) throw Errors.business('RG-VAC-02', 'Report limité à 14 jours', { max: addDays(today, 14) });
    if (!OPEN_STATUSES.includes(r.status)) throw Errors.business('RG-VAC-02', 'Ce rappel n’est plus ouvert');
    r.snoozed_until = dto.until;
    r.updated_by = user.id;
    await this.ds.getRepository(Reminder).save(r);
    return this.reminders.serialize((await this.ds.getRepository(Reminder).findOne({ where: { id } }))!);
  }

  @Post('reminders/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    const r = await this.reminder(user, id);
    if (!OPEN_STATUSES.includes(r.status)) throw Errors.business('RG-VAC-02', 'Ce rappel n’est plus ouvert');
    r.status = 'annule';
    r.cancel_reason = dto.reason;
    r.updated_by = user.id;
    await this.ds.getRepository(Reminder).save(r);
    return this.reminders.serialize((await this.ds.getRepository(Reminder).findOne({ where: { id } }))!);
  }

  // ---- Tasks ---------------------------------------------------------------------------
  @Get('farms/:farmId/tasks')
  async listTasks(@CurrentUser() user: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: TasksQuery) {
    return { data: await this.tasks.list(user, farmId, q.status), next_cursor: null };
  }

  @Post('farms/:farmId/tasks')
  createTask(@CurrentUser() user: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: TaskDto) {
    return this.tasks.upsert(user, farmId, dto);
  }

  @Post('tasks/:id/done')
  @HttpCode(200)
  done(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.done(user, id);
  }
}
