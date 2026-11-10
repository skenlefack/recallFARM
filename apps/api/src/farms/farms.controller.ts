import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { PageQuery, paginate } from '../common/pagination';
import { FarmInput, FarmsService } from './farms.service';

export class FarmCommonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locality?: string;
  @ApiPropertyOptional({ example: 'XAF' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gps_lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gps_lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() area_ha?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() manager_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisation_id?: string;
}

export class FarmPatchDto extends FarmCommonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ example: ['volaille', 'chien'] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) speculations?: string[];
  @ApiPropertyOptional({ example: 'CM' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
}

export class FarmDto extends FarmCommonDto {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiProperty({ example: ['volaille'] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) speculations: string[];
  @ApiProperty({ example: 'CM' }) @Matches(/^[A-Z]{2}$/) country: string;
}

export class FarmsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisation_id?: string;
}

export class FarmSettingsDto {
  @ApiPropertyOptional({ description: 'Overrides keyed by "<kind>:<code>", e.g. {"alert_rule:mortalite_journaliere":{"params":{"seuil_mortalite_jour_pct":2}}}' })
  @IsOptional() @IsObject() overrides?: Record<string, Record<string, unknown>>;
  @ApiPropertyOptional() @IsOptional() @IsObject() targets?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) dashboard_kpis?: string[];
  @ApiPropertyOptional({ example: { phone: '+237690000111', name: 'Joseph' } }) @IsOptional() @IsObject() oncall_default?: Record<string, unknown>;
}

@ApiTags('farms')
@ApiBearerAuth()
@Controller('farms')
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: FarmsQuery) {
    return paginate(q, (o, t) => this.farms.list(user, q, o, t), (f) => this.farms.serialize(f));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: FarmDto) {
    return this.farms.serialize(await this.farms.upsert(user, dto as FarmInput));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.serialize(await this.farms.get(user, id));
  }

  @Patch(':id')
  async patch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FarmPatchDto) {
    return this.farms.serialize(await this.farms.patch(user, id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.farms.remove(user, id);
  }

  @Get(':id/settings')
  settings(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.farms.settings(user, id);
  }

  @Put(':id/settings')
  putSettings(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FarmSettingsDto) {
    return this.farms.putSettings(user, id, dto);
  }
}
