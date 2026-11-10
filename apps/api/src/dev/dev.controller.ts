import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { Public } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { NotificationsScheduler } from '../notifications/notifications.scheduler';

export class OutboxQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

/** Development helpers — only mounted when NODE_ENV !== 'production'. */
@ApiTags('dev')
@Public()
@SkipThrottle()
@Controller('dev')
export class DevController {
  constructor(
    private readonly ds: DataSource,
    private readonly billing: BillingService,
    private readonly scheduler: NotificationsScheduler,
  ) {}

  private guard() {
    if (!config().devEndpoints) throw Errors.notFound('Route');
  }

  /** Messages captured by the SMS / WhatsApp simulators (newest first). */
  @Get('outbox')
  async outbox(@Query() q: OutboxQuery) {
    this.guard();
    const rows = await this.ds.query(
      `SELECT id, recipient_phone AS "to", channel, template_code, body AS text, status, error_code, reminder_id, queued_at
         FROM outbound_messages WHERE channel IN ('sms','whatsapp') AND ($1::text IS NULL OR recipient_phone = $1)
        ORDER BY queued_at DESC LIMIT $2`,
      [q.phone ?? null, q.limit ?? 50],
    );
    return { data: rows, next_cursor: null };
  }

  @Post('payments/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    return this.billing.applyResult({ payment_id: id, status: 'confirme' });
  }

  @Post('payments/:id/fail')
  @HttpCode(200)
  fail(@Param('id', ParseUUIDPipe) id: string) {
    this.guard();
    return this.billing.applyResult({ payment_id: id, status: 'echoue' });
  }

  /** Runs the notification scheduler once (handy for demos). */
  @Post('scheduler/run')
  @HttpCode(200)
  run() {
    this.guard();
    return this.scheduler.runOnce();
  }
}
