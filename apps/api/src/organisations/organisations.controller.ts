import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { decodeCursor, encodeCursor, PageQuery } from '../common/pagination';
import { OrganisationsService } from './organisations.service';

export class DashboardQuery {
  @ApiPropertyOptional({ example: '2026-W44' }) @IsOptional() @Matches(/^\d{4}-W\d{2}$/) week?: string;
  @ApiPropertyOptional({ example: 'volaille' }) @IsOptional() @IsString() speculation?: string;
  @ApiPropertyOptional({ example: 'newcastle' }) @IsOptional() @IsString() disease?: string;
}

export class OrgFarmsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class OrgRemindersQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'ouvert|en_retard|aujourdhui|a_venir|envoye|confirme|annule' }) @IsOptional() @IsString() status?: string;
}

export class AddMemberDto {
  @ApiProperty({ example: '+237690000123' }) @IsString() phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiProperty({ enum: ['proprietaire', 'membre', 'agent', 'veterinaire', 'admin', 'prestataire'] }) @IsString() role: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) farmer_scope?: string[];
}

export class PatchMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) farmer_scope?: string[];
  @ApiPropertyOptional({ enum: ['invite', 'actif', 'retire'] }) @IsOptional() @IsIn(['invite', 'actif', 'retire']) status?: string;
}

async function page<T>(q: PageQuery, fetch: (offset: number, take: number) => Promise<T[]>) {
  const limit = q.limit ?? 50;
  const offset = decodeCursor(q.cursor);
  const rows = await fetch(offset, limit + 1);
  return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null };
}

@ApiTags('organisations')
@ApiBearerAuth()
@Controller()
export class OrganisationsController {
  constructor(private readonly orgs: OrganisationsService) {}

  @Get('organisations/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.get(u, id);
  }

  @Get('organisations/:id/members')
  members(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return page(q, (o, t) => this.orgs.members(u, id, o, t));
  }

  @Post('organisations/:id/members')
  addMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.orgs.addMember(u, id, dto);
  }

  @Patch('members/:id')
  patchMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchMemberDto) {
    return this.orgs.patchMember(u, id, dto);
  }

  @Delete('members/:id')
  @HttpCode(204)
  async removeMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.orgs.removeMember(u, id);
  }

  @Get('organisations/:id/dashboard')
  dashboard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: DashboardQuery) {
    return this.orgs.dashboard(u, id, q.week, q.speculation, q.disease);
  }

  @Get('organisations/:id/farms')
  farms(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: OrgFarmsQuery) {
    return page(q, (o, t) => this.orgs.farms(u, id, q.q, o, t));
  }

  @Get('organisations/:id/reminders')
  reminders(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: OrgRemindersQuery) {
    return page(q, (o, t) => this.orgs.reminders(u, id, q.status, o, t));
  }
}
