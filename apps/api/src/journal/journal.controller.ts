import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { PageQuery, paginate } from '../common/pagination';
import { DailyLogInput, JournalService } from './journal.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Standard columns of 05 §6 (types checked by the resolved form) + attributes. */
export class DailyLogPatchDto {
  @ApiPropertyOptional() @IsOptional() present_count?: number;
  @ApiPropertyOptional() @IsOptional() mortality?: number;
  @ApiPropertyOptional() @IsOptional() culled?: number;
  @ApiPropertyOptional() @IsOptional() eggs?: number;
  @ApiPropertyOptional() @IsOptional() eggs_broken?: number;
  @ApiPropertyOptional() @IsOptional() milk_l?: number;
  @ApiPropertyOptional() @IsOptional() milk_sold_l?: number;
  @ApiPropertyOptional() @IsOptional() feed_kg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() feed_item_id?: string;
  @ApiPropertyOptional() @IsOptional() water_l?: number;
  @ApiPropertyOptional() @IsOptional() temperature_c?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) measured_fields?: string[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class DailyLogDto extends DailyLogPatchDto {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ enum: ['batch', 'animal', 'dog'] }) @IsIn(['batch', 'animal', 'dog']) subject_type: string;
  @ApiProperty() @IsUUID() subject_id: string;
  @ApiProperty({ example: '2026-10-27' }) @Matches(DATE) log_date: string;
}

export class DailyLogsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['batch', 'animal', 'dog']) subject_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subject_id?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) date_from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) date_to?: string;
}

@ApiTags('journal')
@ApiBearerAuth()
@Controller()
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get('farms/:farmId/daily-logs')
  list(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: DailyLogsQuery) {
    return paginate(q, (o, t) => this.journal.list(u, farmId, q, o, t), (l) => this.journal.serialize(l));
  }

  @Post('farms/:farmId/daily-logs')
  create(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: DailyLogDto) {
    return this.journal.save(u, farmId, dto as DailyLogInput, { mode: 'create' });
  }

  @Get('daily-logs/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.journal.serialize(await this.journal.get(u, id));
  }

  @Patch('daily-logs/:id')
  async patch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DailyLogPatchDto) {
    const l = await this.journal.get(u, id);
    return this.journal.save(u, l.farm_id, { ...dto, id, subject_type: l.subject_type, subject_id: l.subject_id, log_date: l.log_date } as DailyLogInput, { mode: 'upsert' });
  }
}
