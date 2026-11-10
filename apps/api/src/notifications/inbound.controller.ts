import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, hasPlatformRole, Public } from '../common/auth';
import { todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { decodeCursor, encodeCursor, PageQuery } from '../common/pagination';
import { normalisePhone } from '../common/text';
import { config } from '../config';
import { User } from '../database/entities';
import { HealthEventsService } from '../health/health-events.service';
import { JournalService } from '../journal/journal.service';
import { ParamsService } from '../params/params.service';
import { MessagingService } from './messaging.service';

export class InboundSmsDto {
  @ApiProperty({ example: '+237690000001' }) @IsString() @MaxLength(20) from: string;
  @ApiProperty({ example: 'OK 4821' }) @IsString() @MaxLength(500) text: string;
}

export class InboundUssdDto {
  @ApiProperty() @IsString() @MaxLength(100) session_id: string;
  @ApiProperty({ example: '+237690000001' }) @IsString() @MaxLength(20) phone: string;
  @ApiProperty({ example: '', description: 'Accumulated input, e.g. "2*4821"' }) @IsString() @MaxLength(200) text: string;
}

export class MessagesQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: ['sms', 'whatsapp', 'push'] }) @IsOptional() @IsIn(['sms', 'whatsapp', 'push']) channel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisation_id?: string;
}

/** Inbound channels: SMS confirmation "OK <code>" and the pilot USSD menu (02 E80, EF-NOT-05). */
@ApiTags('notifications')
@Controller()
export class InboundController {
  constructor(
    private readonly ds: DataSource,
    private readonly health: HealthEventsService,
    private readonly journal: JournalService,
    private readonly params: ParamsService,
    private readonly messaging: MessagingService,
    private readonly access: AccessService,
  ) {}

  private checkSecret(secret?: string) {
    const expected = config().inboundSecret;
    if (expected && secret !== expected) throw Errors.unauthenticated('Secret d’intégration invalide');
  }

  private async userByPhone(raw: string): Promise<AuthUser | null> {
    const u = await this.ds.getRepository(User).findOne({ where: { phone: normalisePhone(raw) } });
    return u ? { id: u.id, phone: u.phone, platform_roles: u.platform_roles } : null;
  }

  private async openReminders(user: AuthUser, onlyDue: boolean) {
    const ids = await this.access.farmIds(user);
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT id, short_code, disease, subject_ref, due_date::text AS due_date FROM reminders
        WHERE farm_id = ANY($1) AND status IN ('a_venir','envoye') AND deleted_at IS NULL ${onlyDue ? `AND due_date <= $2::date` : `AND $2::text IS NOT NULL`}
        ORDER BY due_date LIMIT 5`,
      [ids, todayIn()],
    ) as Promise<Array<{ id: string; short_code: string; disease: string; subject_ref: string; due_date: string }>>;
  }

  private async confirmByCode(user: AuthUser, code: string, via: string) {
    const ids = await this.access.farmIds(user);
    const rows: Array<{ id: string; disease: string; subject_ref: string }> = ids.length
      ? await this.ds.query(
          `SELECT id, disease, subject_ref FROM reminders WHERE farm_id = ANY($1) AND short_code = $2 AND status IN ('a_venir','envoye') AND deleted_at IS NULL LIMIT 1`,
          [ids, code],
        )
      : [];
    if (!rows.length) return null;
    await this.health.confirmReminder(user, rows[0].id, {}, via);
    return rows[0];
  }

  @Public()
  @SkipThrottle()
  @ApiHeader({ name: 'X-Inbound-Secret', required: false })
  @Post('inbound/sms')
  @HttpCode(200)
  async sms(@Headers('x-inbound-secret') secret: string | undefined, @Body() dto: InboundSmsDto) {
    this.checkSecret(secret);
    const user = await this.userByPhone(dto.from);
    const m = /^\s*(OK|FAIT|DONE)\s+([A-Z0-9]{3,8})\s*$/i.exec(dto.text);
    let reply: string;
    let reminderId: string | null = null;
    if (!user) reply = 'RecallFarm: numéro inconnu. Téléchargez l’application ou contactez votre coopérative.';
    else if (!m) reply = 'RecallFarm: message non compris. Répondez OK suivi du code reçu (ex. OK 4821).';
    else {
      const r = await this.confirmByCode(user, m[2].toUpperCase(), 'sms');
      if (!r) reply = `RecallFarm: code ${m[2]} introuvable ou déjà confirmé.`;
      else {
        reminderId = r.id;
        const resolved = await this.params.resolveBase();
        reply = `RecallFarm: merci, ${this.params.label(resolved, r.disease)} pour ${r.subject_ref} confirmé.`;
      }
    }
    await this.messaging.send({ channel: 'sms', phone: normalisePhone(dto.from), text: reply, template_code: 'reponse_sms', user_id: user?.id ?? null, reminder_id: reminderId });
    return { handled: !!reminderId, reminder_id: reminderId, reply };
  }

  @Public()
  @SkipThrottle()
  @ApiHeader({ name: 'X-Inbound-Secret', required: false })
  @Post('inbound/ussd')
  @HttpCode(200)
  async ussd(@Headers('x-inbound-secret') secret: string | undefined, @Body() dto: InboundUssdDto) {
    this.checkSecret(secret);
    const user = await this.userByPhone(dto.phone);
    if (!user) return { response: 'END Numéro inconnu de RecallFarm.' };
    const resolved = await this.params.resolveBase();
    const menu = Object.values(resolved.objects).find((o) => o.kind === 'ussd_menu') as { items?: string[] } | undefined;
    const items = menu?.items ?? ['rappels_du_jour', 'confirmer_rappel', 'declarer_mortalite'];
    const parts = dto.text ? dto.text.split('*') : [];
    if (!parts.length) {
      return { response: `CON RecallFarm\n${items.map((it, i) => `${i + 1}. ${this.params.label(resolved, it)}`).join('\n')}` };
    }
    const choice = items[Number(parts[0]) - 1];
    if (choice === 'rappels_du_jour') {
      const list = await this.openReminders(user, true);
      if (!list.length) return { response: 'END Aucun rappel pour aujourd’hui.' };
      return { response: `END ${list.map((r) => `${this.params.label(resolved, r.disease)} ${r.subject_ref} (code ${r.short_code})`).join('\n')}` };
    }
    if (choice === 'confirmer_rappel') {
      if (parts.length < 2) return { response: 'CON Entrez le code du rappel :' };
      const r = await this.confirmByCode(user, parts[1].trim().toUpperCase(), 'ussd');
      return { response: r ? `END Merci, rappel ${this.params.label(resolved, r.disease)} confirmé.` : 'END Code introuvable ou déjà confirmé.' };
    }
    if (choice === 'declarer_mortalite') {
      const ids = await this.access.farmIds(user);
      const batches: Array<{ id: string; name: string; farm_id: string }> = ids.length
        ? await this.ds.query(`SELECT id, name, farm_id FROM batches WHERE farm_id = ANY($1) AND deleted_at IS NULL AND status = 'en_cours' ORDER BY name LIMIT 8`, [ids])
        : [];
      if (!batches.length) return { response: 'END Aucun lot en cours.' };
      if (parts.length < 2) return { response: `CON Quel lot ?\n${batches.map((b, i) => `${i + 1}. ${b.name}`).join('\n')}` };
      const b = batches[Number(parts[1]) - 1];
      if (!b) return { response: 'END Choix invalide.' };
      if (parts.length < 3) return { response: `CON Nombre de morts aujourd’hui (${b.name}) :` };
      const n = Number(parts[2]);
      if (!Number.isInteger(n) || n < 0) return { response: 'END Nombre invalide.' };
      const today = todayIn();
      const existing = await this.journal.findBySubjectDate('batch', b.id, today);
      const res = await this.journal.save(
        user,
        b.farm_id,
        { id: existing?.id ?? randomUUID(), subject_type: 'batch', subject_id: b.id, log_date: today, mortality: (existing?.mortality ?? 0) + n, ...(existing?.eggs !== undefined && existing?.eggs !== null ? { eggs: existing.eggs } : {}) },
        { mode: 'upsert', deviceId: `ussd:${dto.session_id}` },
      ).catch((e) => ({ error: e }));
      if ('error' in res) return { response: 'END Saisie impossible, complétez le journal dans l’application.' };
      return { response: `END ${n} mort(s) enregistré(s) pour ${b.name}.${res.alerts.length ? ' Alerte transmise.' : ''}` };
    }
    return { response: 'END Choix invalide.' };
  }

  /** Outbound journal: platform admins see everything, organisation managers see their members. */
  @ApiBearerAuth()
  @Get('admin/messages')
  async messages(@CurrentUser() user: AuthUser, @Query() q: MessagesQuery) {
    const limit = q.limit ?? 50;
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [];
    const where: string[] = [];
    if (!hasPlatformRole(user, 'support', 'ops')) {
      if (!q.organisation_id) throw Errors.forbidden('organisation_id requis');
      await this.access.assertOrgManager(user, q.organisation_id);
    }
    if (q.organisation_id) {
      params.push(q.organisation_id);
      where.push(`(o.organisation_id = $${params.length} OR o.recipient_user_id IN (SELECT user_id FROM memberships WHERE organisation_id = $${params.length}))`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`o.status = $${params.length}`);
    }
    if (q.channel) {
      params.push(q.channel);
      where.push(`o.channel = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`o.queued_at >= $${params.length}::timestamptz`);
    }
    params.push(offset, limit + 1);
    const rows = await this.ds.query(
      `SELECT o.id, o.reminder_id, o.alert_event_id, o.recipient_user_id, o.recipient_phone, o.channel, o.template_code, o.lang,
              CASE WHEN o.template_code = 'otp_sms' THEN NULL ELSE o.body END AS body, o.status, o.plan_offset, o.provider_ref, o.cost_minor, o.currency,
              o.queued_at, o.sent_at, o.delivered_at, o.error_code
         FROM outbound_messages o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.queued_at DESC OFFSET $${params.length - 1} LIMIT $${params.length}`,
      params,
    );
    return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null };
  }
}
