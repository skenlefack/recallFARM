import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { PageQuery, paginate } from '../common/pagination';
import { AnimalInput, BatchInput, DogInput, LivestockService } from './livestock.service';

/** Types are checked by the resolved form (422 VALIDATION_ERROR with field paths); DTOs only whitelist. */
export class BatchPatchDto {
  @ApiPropertyOptional({ example: 'B03' }) @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) code?: string;
  @ApiPropertyOptional({ example: 'volaille' }) @IsOptional() @IsString() species?: string;
  @ApiPropertyOptional({ example: 'chair' }) @IsOptional() @IsString() production_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() strain?: string;
  @ApiPropertyOptional({ example: '2026-10-20' }) @IsOptional() start_date?: string;
  @ApiPropertyOptional({ example: 500 }) @IsOptional() initial_count?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() housing?: string;
  @ApiPropertyOptional({ enum: ['en_cours', 'vide_sanitaire', 'vendue', 'reformee', 'terminee'] })
  @IsOptional() @IsIn(['en_cours', 'vide_sanitaire', 'vendue', 'reformee', 'terminee']) status?: string;
  @ApiPropertyOptional({ description: 'Derived — ignored on write' }) @IsOptional() @IsInt() current_count?: number;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class BatchDto extends BatchPatchDto {
  @ApiProperty() @IsUUID() id: string;
}

export class DogPatchDto {
  @ApiPropertyOptional({ example: 'Rex' }) @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() breed?: string;
  @ApiPropertyOptional({ enum: ['M', 'F'] }) @IsOptional() @IsString() sex?: string;
  @ApiPropertyOptional() @IsOptional() birth_date?: string;
  @ApiPropertyOptional({ example: '120093000418271' }) @IsOptional() @IsString() chip_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() identification_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coat?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sire_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dam_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() photo_uri?: string;
  @ApiPropertyOptional({ description: 'Derived — ignored on write' }) @IsOptional() @IsString() rabies_status?: string;
  @ApiPropertyOptional({ description: 'Derived — ignored on write' }) @IsOptional() @IsString() rabies_valid_until?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class DogDto extends DogPatchDto {
  @ApiProperty() @IsUUID() id: string;
}

export class AnimalPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() species?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: ['M', 'F'] }) @IsOptional() @IsString() sex?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() breed?: string;
  @ApiPropertyOptional() @IsOptional() birth_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sire_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dam_id?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class AnimalDto extends AnimalPatchDto {
  @ApiProperty() @IsUUID() id: string;
}

@ApiTags('livestock')
@ApiBearerAuth()
@Controller()
export class LivestockController {
  constructor(private readonly svc: LivestockService) {}

  // Batches
  @Get('farms/:farmId/batches')
  listBatches(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    return paginate(q, (o, t) => this.svc.listBatches(u, farmId, o, t), (b) => this.svc.serializeBatch(b));
  }

  @Post('farms/:farmId/batches')
  async createBatch(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: BatchDto) {
    return this.svc.serializeBatch(await this.svc.upsertBatch(u, farmId, dto as BatchInput));
  }

  @Get('batches/:id')
  async getBatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.serializeBatch(await this.svc.getBatch(u, id));
  }

  @Patch('batches/:id')
  async patchBatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BatchPatchDto) {
    const b = await this.svc.getBatch(u, id);
    return this.svc.serializeBatch(await this.svc.upsertBatch(u, b.farm_id, { ...dto, id } as BatchInput, { partial: true }));
  }

  @Delete('batches/:id')
  @HttpCode(204)
  async deleteBatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.removeBatch(u, id);
  }

  // Dogs
  @Get('farms/:farmId/dogs')
  async listDogs(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    const page = await paginate(q, (o, t) => this.svc.listDogs(u, farmId, o, t));
    return { ...page, data: await this.svc.serializeDogs(page.data) };
  }

  @Post('farms/:farmId/dogs')
  async createDog(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: DogDto) {
    const d = await this.svc.upsertDog(u, farmId, dto as DogInput);
    return (await this.svc.serializeDogs([d]))[0];
  }

  @Get('dogs/:id')
  async getDog(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.svc.getDog(u, id);
    return { ...(await this.svc.serializeDogs([d]))[0], health_book: await this.svc.dogHealthBook(d.id) };
  }

  @Patch('dogs/:id')
  async patchDog(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DogPatchDto) {
    const d = await this.svc.getDog(u, id);
    const saved = await this.svc.upsertDog(u, d.farm_id, { ...dto, id } as DogInput, { partial: true });
    return (await this.svc.serializeDogs([saved]))[0];
  }

  @Delete('dogs/:id')
  @HttpCode(204)
  async deleteDog(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.removeDog(u, id);
  }

  // Animals (minimal)
  @Get('farms/:farmId/animals')
  listAnimals(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    return paginate(q, (o, t) => this.svc.listAnimals(u, farmId, o, t));
  }

  @Post('farms/:farmId/animals')
  createAnimal(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: AnimalDto) {
    return this.svc.upsertAnimal(u, farmId, dto as AnimalInput);
  }

  @Get('animals/:id')
  getAnimal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getAnimal(u, id);
  }

  @Patch('animals/:id')
  async patchAnimal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnimalPatchDto) {
    const a = await this.svc.getAnimal(u, id);
    return this.svc.upsertAnimal(u, a.farm_id, { ...dto, id } as AnimalInput);
  }

  @Delete('animals/:id')
  @HttpCode(204)
  async deleteAnimal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.removeAnimal(u, id);
  }
}
