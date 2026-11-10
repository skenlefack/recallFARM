import { Body, Controller, Get, HttpCode, Ip, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { KvService } from '../common/kv.service';
import { normalisePhone } from '../common/text';
import { FeatureFlag, Lead, User } from '../database/entities';

export class AnalyticsEventDto {
  @ApiProperty({ example: 'reminder_confirmed' }) @Matches(/^[a-z0-9_.]{2,60}$/) name: string;
  @ApiProperty() @IsISO8601() ts: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() props?: Record<string, unknown>;
}

export class AnalyticsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) device_id_hash?: string;
  @ApiProperty({ type: [AnalyticsEventDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AnalyticsEventDto) events: AnalyticsEventDto[];
}

export class LeadDto {
  @ApiProperty({ example: '+237690001234' }) @IsString() @MaxLength(20) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiProperty({ example: 'site_public' }) @IsString() @MaxLength(60) source: string;
}

@ApiTags('misc')
@Controller()
export class MiscController {
  constructor(
    private readonly ds: DataSource,
    private readonly kv: KvService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return { status: 'ok', service: 'recallfarm-api', time: new Date().toISOString() };
  }

  @Public()
  @SkipThrottle()
  @Get('ready')
  async ready() {
    let db = 'ok';
    try {
      await this.ds.query('SELECT 1');
    } catch {
      db = 'down';
    }
    const redis = await this.kv.ping();
    const ok = db === 'ok' && redis !== 'down';
    if (!ok) throw new ServiceUnavailableException(`not ready (db=${db}, redis=${redis})`);
    return { status: 'ready', db, redis };
  }

  /** Product analytics (EF-ANA): refused when the user opted out. */
  @ApiBearerAuth()
  @Post('analytics/events')
  @HttpCode(202)
  async analytics(@CurrentUser() user: AuthUser, @Body() dto: AnalyticsDto) {
    const u = await this.ds.getRepository(User).findOne({ where: { id: user.id } });
    if (u?.analytics_opt_out) throw Errors.forbidden('Analytique désactivée par l’utilisateur');
    for (const e of dto.events) {
      await this.ds.query(`INSERT INTO analytics_events (user_id, device_id_hash, name, ts, props) VALUES ($1,$2,$3,$4,$5)`, [
        user.id, dto.device_id_hash ?? null, e.name, e.ts, JSON.stringify(e.props ?? {}),
      ]);
    }
    return { accepted: dto.events.length };
  }

  @ApiBearerAuth()
  @Get('feature-flags')
  async flags(@CurrentUser() user: AuthUser) {
    const u = (await this.ds.getRepository(User).findOne({ where: { id: user.id } }))!;
    const ent = await this.entitlements.forUser(user.id, false);
    const flags = await this.ds.getRepository(FeatureFlag).find();
    const bucket = parseInt(createHash('sha256').update(user.id).digest('hex').slice(0, 8), 16) % 100;
    const out: Record<string, boolean> = {};
    for (const f of flags) {
      const r = f.rules ?? {};
      out[f.key] =
        f.enabled &&
        (!r.countries || r.countries.includes(u.country)) &&
        (!r.plans || r.plans.includes(ent.plan)) &&
        (r.percent === undefined || bucket < r.percent);
    }
    return { flags: out };
  }

  /** "Être rappelé" form of the public site. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  @HttpCode(201)
  async lead(@Body() dto: LeadDto, @Ip() ip: string) {
    const phone = normalisePhone(dto.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw Errors.validation({ phone: 'format E.164 attendu' });
    const l = await this.ds.getRepository(Lead).save({ phone, name: dto.name ?? null, source: dto.source, ip_hash: createHash('sha256').update(ip ?? '').digest('hex').slice(0, 16) });
    return { id: l.id, received: true };
  }
}
