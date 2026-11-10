import { Body, Controller, Get, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, hasPlatformRole, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { decodeCursor, encodeCursor, PageQuery } from '../common/pagination';
import { config } from '../config';
import { InboundService } from './inbound.service';

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
    private readonly access: AccessService,
    private readonly inbound: InboundService,
  ) {}

  private checkSecret(secret?: string) {
    const expected = config().inboundSecret;
    if (expected && secret !== expected) throw Errors.unauthenticated('Secret d’intégration invalide');
  }

  @Public()
  @SkipThrottle()
  @ApiHeader({ name: 'X-Inbound-Secret', required: false })
  @Post('inbound/sms')
  @HttpCode(200)
  async sms(@Headers('x-inbound-secret') secret: string | undefined, @Body() dto: InboundSmsDto) {
    this.checkSecret(secret);
    return this.inbound.handleSms(dto.from, dto.text);
  }

  @Public()
  @SkipThrottle()
  @ApiHeader({ name: 'X-Inbound-Secret', required: false })
  @Post('inbound/ussd')
  @HttpCode(200)
  async ussd(@Headers('x-inbound-secret') secret: string | undefined, @Body() dto: InboundUssdDto) {
    this.checkSecret(secret);
    return this.inbound.handleUssd(dto.session_id, dto.phone, dto.text);
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
