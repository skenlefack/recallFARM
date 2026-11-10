import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { PageQuery, paginate } from '../common/pagination';
import { MoneyDto } from '../health/dto';
import { ExpenseInput, MovementInput, SaleInput, StockSalesService } from './stock-sales.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StockMovementDto {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ example: 'aliment_ponte' }) @IsString() item_id: string;
  @ApiProperty() @Matches(DATE) movement_date: string;
  @ApiProperty({ enum: ['entree', 'sortie', 'ajustement'] }) @IsIn(['entree', 'sortie', 'ajustement']) direction: 'entree' | 'sortie' | 'ajustement';
  @ApiProperty() @IsNumber() quantity: number;
  @ApiPropertyOptional({ type: MoneyDto }) @IsOptional() @ValidateNested() @Type(() => MoneyDto) unit_cost?: MoneyDto;
  @ApiPropertyOptional() @IsOptional() @IsString() supplier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lot_no?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) expiry_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['batch', 'dog', 'animal']) subject_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subject_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class SaleDto {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ example: 'oeufs_plateau' }) @IsString() product: string;
  @ApiPropertyOptional() @IsOptional() @IsString() species?: string;
  @ApiProperty({ example: 10 }) @IsNumber() quantity: number;
  @ApiProperty({ example: 'plateau' }) @IsString() unit: string;
  @ApiProperty({ type: MoneyDto }) @ValidateNested() @Type(() => MoneyDto) unit_price: MoneyDto;
  @ApiPropertyOptional() @IsOptional() @IsUUID() client_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() client_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() payment?: string;
  @ApiPropertyOptional({ enum: ['paye', 'partiel', 'a_credit'] }) @IsOptional() @IsString() payment_status?: string;
  @ApiProperty() @Matches(DATE) sale_date: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['batch', 'dog', 'animal']) subject_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subject_id?: string;
  @ApiPropertyOptional({ description: 'Derived — ignored on write', type: MoneyDto }) @IsOptional() @IsObject() amount?: MoneyDto;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class ExpenseDto {
  @ApiProperty() @IsUUID() id: string;
  @ApiProperty({ example: 'aliment' }) @IsString() category: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() quantity?: number;
  @ApiProperty({ type: MoneyDto }) @ValidateNested() @Type(() => MoneyDto) amount: MoneyDto;
  @ApiPropertyOptional() @IsOptional() @IsString() payment_method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplier?: string;
  @ApiProperty() @Matches(DATE) expense_date: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['batch', 'dog', 'animal']) subject_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subject_id?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

export class KpisQuery {
  @ApiPropertyOptional({ enum: ['7d', '30d'] }) @IsOptional() @IsIn(['7d', '30d']) period?: '7d' | '30d';
}

export class StockItemsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
}

@ApiTags('stock-sales')
@ApiBearerAuth()
@Controller()
export class StockSalesController {
  constructor(private readonly svc: StockSalesService) {}

  @Get('stock-items')
  async items(@CurrentUser() u: AuthUser, @Query() q: StockItemsQuery) {
    return { data: await this.svc.stockItems(u, q.farm_id), next_cursor: null };
  }

  @Get('farms/:farmId/stock-movements')
  movements(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    return paginate(q, (o, t) => this.svc.listMovements(u, farmId, o, t), (m) => this.svc.serializeMovement(m));
  }

  @Post('farms/:farmId/stock-movements')
  createMovement(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: StockMovementDto) {
    return this.svc.upsertMovement(u, farmId, dto as MovementInput);
  }

  @Get('farms/:farmId/stock-summary')
  async summary(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string) {
    return { data: await this.svc.summary(u, farmId), next_cursor: null };
  }

  @Get('farms/:farmId/sales')
  sales(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    return paginate(q, (o, t) => this.svc.listSales(u, farmId, o, t), (s) => this.svc.serializeSale(s));
  }

  @Post('farms/:farmId/sales')
  createSale(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: SaleDto) {
    const { amount: _derived, ...input } = dto;
    return this.svc.upsertSale(u, farmId, input as SaleInput);
  }

  @Get('farms/:farmId/expenses')
  expenses(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: PageQuery) {
    return paginate(q, (o, t) => this.svc.listExpenses(u, farmId, o, t), (e) => this.svc.serializeExpense(e));
  }

  @Post('farms/:farmId/expenses')
  createExpense(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: ExpenseDto) {
    return this.svc.upsertExpense(u, farmId, dto as ExpenseInput);
  }

  @Get('farms/:farmId/kpis')
  kpis(@CurrentUser() u: AuthUser, @Param('farmId', ParseUUIDPipe) farmId: string, @Query() q: KpisQuery) {
    return this.svc.kpis(u, farmId, q.period ?? '7d');
  }
}
