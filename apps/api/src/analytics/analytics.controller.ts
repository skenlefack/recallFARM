import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser, PlatformRoles } from '../common/auth';
import { AnalyticsService } from './analytics.service';
import { AggregationService } from './aggregation.service';

class EventDto {
  @ApiProperty() @IsString() @MaxLength(60) name: string;
  @ApiProperty() @IsString() ts: string;
  @ApiPropertyOptional() @IsOptional() props?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() device_id_hash?: string;
}

class IngestDto {
  @ApiProperty({ type: [EventDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => EventDto) events: EventDto[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
}

class DashboardQueryDto {
  @ApiProperty() @IsString() from: string;
  @ApiProperty() @IsString() to: string;
}

@ApiTags('analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiBearerAuth()
  @Post('events')
  @HttpCode(200)
  ingest(@CurrentUser() u: AuthUser, @Body() dto: IngestDto) {
    return this.analytics.ingest(u.id, dto.farm_id, dto.events);
  }
}

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('v1/admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly aggregation: AggregationService) {}

  @PlatformRoles('platform_admin', 'epidemiologiste')
  @Get('dashboard')
  dashboard(@Query() q: DashboardQueryDto) {
    return this.aggregation.dashboard(q.from, q.to);
  }
}
