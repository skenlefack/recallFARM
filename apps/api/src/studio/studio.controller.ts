import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { StudioService } from './studio.service';

export class CreateDraftDto {
  @ApiPropertyOptional({ example: '1.0.1' }) @IsOptional() @Matches(/^\d+\.\d+\.\d+$/) version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) changelog?: string;
}

export class PatchVersionDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() content: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) changelog?: string;
}

export class ReviewDto {
  @ApiProperty({ enum: ['approuve', 'refuse', 'commentaire'] }) @IsIn(['approuve', 'refuse', 'commentaire']) decision: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) comments?: string;
}

export class PublishDto {
  @ApiPropertyOptional({ example: 10, description: 'Progressive rollout percentage (RG-PAR-07); omit or 100 for everyone' })
  @IsOptional() @IsInt() @Min(1) @Max(100) rollout_pct?: number;
}

export class RollbackDto {
  @ApiProperty({ example: '1.0.0' }) @Matches(/^\d+\.\d+\.\d+$/) to_version: string;
  @ApiProperty() @IsString() @MaxLength(1000) reason: string;
}

export class SimulateProtocolDto {
  @ApiProperty() @IsUUID() version_id: string;
  @ApiProperty({ example: 'volaille_chair_cm' }) @IsString() protocol_code: string;
  @ApiProperty({ example: '2026-11-01' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) birth_or_start_date: string;
}

@ApiTags('studio')
@ApiBearerAuth()
@Controller('studio')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get('packs')
  async packs(@CurrentUser() u: AuthUser) {
    return { data: await this.studio.listPacks(u), next_cursor: null };
  }

  @Get('packs/:code/versions')
  async versions(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return { data: await this.studio.versions(u, code), next_cursor: null };
  }

  @Post('packs/:code/versions')
  createDraft(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: CreateDraftDto) {
    return this.studio.createDraft(u, code, dto);
  }

  @Post('packs/:code/rollback')
  @HttpCode(200)
  rollback(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: RollbackDto) {
    return this.studio.rollback(u, code, dto);
  }

  @Get('versions/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.get(u, id);
  }

  @Patch('versions/:id')
  patch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchVersionDto) {
    return this.studio.patch(u, id, dto);
  }

  @Post('versions/:id/validate')
  @HttpCode(200)
  validate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.validate(u, id);
  }

  @Post('versions/:id/test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.test(u, id);
  }

  @Post('versions/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.submit(u, id);
  }

  @Post('versions/:id/reviews')
  review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.studio.review(u, id, dto);
  }

  @Post('versions/:id/publish')
  @HttpCode(200)
  publish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    return this.studio.publish(u, id, dto);
  }

  @Get('versions/:id/diff')
  diff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.diff(u, id);
  }

  @Post('simulate-protocol')
  @HttpCode(200)
  simulate(@CurrentUser() u: AuthUser, @Body() dto: SimulateProtocolDto) {
    return this.studio.simulateProtocol(u, dto);
  }
}
