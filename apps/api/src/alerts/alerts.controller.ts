import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { PageQuery, paginate } from '../common/pagination';
import { AlertsService } from './alerts.service';

export class AlertsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisation_id?: string;
  @ApiPropertyOptional({ description: 'ouverte|escaladee|acquittee|resolue|close|open' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: ['info', 'attention', 'critique'] }) @IsOptional() @IsIn(['info', 'attention', 'critique']) severity?: string;
}

export class ResolveAlertDto {
  @ApiPropertyOptional({ enum: ['chaleur', 'panne_eau', 'panne_electrique', 'capteur_defectueux', 'intrusion', 'maladie', 'fausse_alerte', 'autre'] })
  @IsOptional() @IsIn(['chaleur', 'panne_eau', 'panne_electrique', 'capteur_defectueux', 'intrusion', 'maladie', 'fausse_alerte', 'autre']) cause?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) action?: string;
}

export class TelemetryDto {
  @ApiProperty() @IsUUID() device_id: string;
  @ApiProperty({ example: 'temperature' }) @IsString() @MaxLength(40) metric: string;
  @ApiProperty({ example: 31.4 }) @IsNumber() value: number;
  @ApiPropertyOptional({ example: '2026-10-27T13:06:00Z' }) @IsOptional() @IsISO8601() ts?: string;
}

@ApiTags('alerts')
@Controller()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @ApiBearerAuth()
  @Get('alerts')
  list(@CurrentUser() u: AuthUser, @Query() q: AlertsQuery) {
    return paginate(q, (o, t) => this.alerts.list(u, q, o, t), (a) => this.alerts.serialize(a));
  }

  @ApiBearerAuth()
  @Post('alerts/:id/ack')
  @HttpCode(200)
  async ack(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.serialize(await this.alerts.ack(u, id));
  }

  @ApiBearerAuth()
  @Post('alerts/:id/resolve')
  @HttpCode(200)
  async resolve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveAlertDto) {
    return this.alerts.serialize(await this.alerts.resolve(u, id, dto));
  }

  @ApiBearerAuth()
  @Get('farms/:farmId/live')
  live(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return this.alerts.live(u, farmId);
  }

  /** HTTP fallback ingestion (MQTT in production), authenticated by the device key. */
  @Public()
  @ApiHeader({ name: 'X-Device-Key', required: true })
  @Post('ingest/telemetry')
  @HttpCode(202)
  ingest(@Headers('x-device-key') key: string | undefined, @Body() dto: TelemetryDto) {
    return this.alerts.ingest(key, dto);
  }
}
