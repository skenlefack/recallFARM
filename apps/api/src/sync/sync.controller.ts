import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { PULL_ENTITIES, SyncService } from './sync.service';

export class ChangeDto {
  @ApiProperty({ example: 'daily_logs' }) @IsString() entity: string;
  @ApiProperty({ enum: ['upsert', 'delete'] }) @IsIn(['upsert', 'delete']) op: 'upsert' | 'delete';
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(0) client_rev: number;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() data?: Record<string, unknown>;
}

export class PushDto {
  @ApiProperty({ example: 'android-7f3a' }) @IsString() @MaxLength(100) device_id: string;
  @ApiProperty({ type: [ChangeDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ChangeDto) changes: ChangeDto[];
}

export class PullQuery {
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) since?: number;
  @ApiPropertyOptional({ example: 'batches,dogs,daily_logs,reminders,params', description: `Comma-separated: ${PULL_ENTITIES.join(', ')}` })
  @IsOptional() @IsString() entities?: string;
  @ApiPropertyOptional({ default: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@CurrentUser() u: AuthUser, @Body() dto: PushDto) {
    return this.sync.push(u, dto.device_id, dto.changes);
  }

  @Get('pull')
  pull(@CurrentUser() u: AuthUser, @Query() q: PullQuery) {
    const entities = q.entities ? q.entities.split(',').map((s) => s.trim()).filter(Boolean) : [...PULL_ENTITIES];
    return this.sync.pull(u, q.since ?? 0, entities, q.limit ?? 500);
  }
}
