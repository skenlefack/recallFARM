import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser } from '../common/auth';
import { Errors } from '../common/errors';
import { MatingCheck } from '../database/entities';
import { coancestry, Pedigree, pedigreeComplete, verdict } from './genealogy';

export class MatingCheckDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: 'chien' }) @IsString() species: string;
  @ApiPropertyOptional({ enum: ['dog', 'animal'] }) @IsOptional() @IsIn(['dog', 'animal']) sire_type?: 'dog' | 'animal';
  @ApiProperty() @IsUUID() sire_id: string;
  @ApiPropertyOptional({ enum: ['dog', 'animal'] }) @IsOptional() @IsIn(['dog', 'animal']) dam_type?: 'dog' | 'animal';
  @ApiProperty() @IsUUID() dam_id: string;
  @ApiPropertyOptional({ default: 4 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) generations?: number;
  @ApiPropertyOptional({ default: 0.0625 }) @IsOptional() @IsNumber() @Min(0) @Max(1) threshold?: number;
}

export class PedigreeQuery {
  @ApiPropertyOptional({ default: 3 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8) generations?: number;
}

@ApiTags('genealogy')
@ApiBearerAuth()
@Controller()
export class GenealogyController {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
  ) {}

  private async loadPedigree(table: 'dogs' | 'animals', roots: string[], generations: number): Promise<Pedigree> {
    const ped: Pedigree = new Map();
    let frontier = roots;
    for (let g = 0; g <= generations && frontier.length; g++) {
      const label = table === 'dogs' ? 'name' : `coalesce(name, tag)`;
      const rows: Array<{ id: string; name: string | null; sire_id: string | null; dam_id: string | null }> = await this.ds.query(
        `SELECT id, ${label} AS name, sire_id, dam_id FROM ${table} WHERE id = ANY($1)`,
        [frontier],
      );
      rows.forEach((r) => ped.set(r.id, r));
      frontier = [...new Set(rows.flatMap((r) => [r.sire_id, r.dam_id]).filter((x): x is string => !!x && !ped.has(x)))];
    }
    return ped;
  }

  /** POST /mating-checks — expected F of the offspring (Wright), verdict ok | attention | a_eviter. */
  @Post('mating-checks')
  @HttpCode(200)
  async check(@CurrentUser() user: AuthUser, @Body() dto: MatingCheckDto) {
    const table = dto.species === 'chien' || dto.sire_type === 'dog' ? 'dogs' : 'animals';
    const generations = dto.generations ?? 4;
    const threshold = dto.threshold ?? 0.0625;
    const rows: Array<{ id: string; farm_id: string; sex: string }> = await this.ds.query(`SELECT id, farm_id, sex FROM ${table} WHERE id = ANY($1) AND deleted_at IS NULL`, [
      [dto.sire_id, dto.dam_id],
    ]);
    const sire = rows.find((r) => r.id === dto.sire_id);
    const dam = rows.find((r) => r.id === dto.dam_id);
    if (!sire || !dam) throw Errors.notFound('Reproducteur');
    await this.access.farm(user, sire.farm_id);
    if (dam.farm_id !== sire.farm_id) await this.access.farm(user, dam.farm_id);
    const fields: Record<string, string> = {};
    if (sire.sex !== 'M') fields.sire_id = 'le père doit être un mâle';
    if (dam.sex !== 'F') fields.dam_id = 'la mère doit être une femelle';
    if (Object.keys(fields).length) throw Errors.validation(fields);
    const ped = await this.loadPedigree(table, [dto.sire_id, dto.dam_id], generations);
    const r = coancestry(ped, dto.sire_id, dto.dam_id, generations);
    const complete = pedigreeComplete(ped, dto.sire_id, generations - 1) && pedigreeComplete(ped, dto.dam_id, generations - 1);
    const coef = Math.round(r.coef * 1e6) / 1e6;
    const result = {
      id: dto.id ?? randomUUID(),
      species: dto.species,
      sire_id: dto.sire_id,
      dam_id: dto.dam_id,
      expected_coef: coef,
      expected_coef_pct: Math.round(coef * 10000) / 100,
      verdict: verdict(coef, threshold),
      complete,
      generations_used: generations,
      common_ancestors: r.common,
      threshold,
    };
    await this.ds.getRepository(MatingCheck).save({
      id: result.id, farm_id: sire.farm_id, species: dto.species, sire_type: table === 'dogs' ? 'dog' : 'animal', sire_id: dto.sire_id,
      dam_type: table === 'dogs' ? 'dog' : 'animal', dam_id: dto.dam_id, expected_coef: coef, complete, generations_used: generations,
      threshold, verdict: complete ? result.verdict : `minore_${result.verdict}`, common_ancestors: r.common, checked_by: user.id,
    });
    return result;
  }

  @Get('farms/:farmId/mating-checks')
  async list(@CurrentUser() user: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string) {
    await this.access.farm(user, farmId);
    return { data: await this.ds.getRepository(MatingCheck).find({ where: { farm_id: farmId }, order: { checked_at: 'DESC' }, take: 100 }), next_cursor: null };
  }

  @Get('dogs/:id/pedigree')
  async dogPedigree(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PedigreeQuery) {
    const rows: Array<{ farm_id: string }> = await this.ds.query(`SELECT farm_id FROM dogs WHERE id = $1`, [id]);
    if (!rows.length) throw Errors.notFound('Chien');
    await this.access.farm(user, rows[0].farm_id);
    const g = q.generations ?? 3;
    const ped = await this.loadPedigree('dogs', [id], g);
    const tree = (nid: string | null, depth: number): unknown => {
      if (!nid) return null;
      const n = ped.get(nid);
      if (!n) return { id: nid, name: null, unknown: true };
      return depth >= g ? { id: n.id, name: n.name } : { id: n.id, name: n.name, sire: tree(n.sire_id, depth + 1), dam: tree(n.dam_id, depth + 1) };
    };
    return { tree: tree(id, 0), complete: pedigreeComplete(ped, id, g), inconsistencies: [] };
  }
}
