import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, hasPlatformRole } from '../common/auth';
import { Errors } from '../common/errors';
import { PaymentOpsService } from './payment-ops.service';

const STATUSES = ['initie', 'en_attente', 'a_verifier', 'confirme', 'echoue', 'remboursement_en_cours', 'rembourse'];

export class AdminPaymentsQuery {
  @ApiPropertyOptional({ enum: STATUSES, description: '"a_verifier" : paiements dont le fournisseur n’a pas donne l’issue' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class RefundDto {
  @ApiProperty({ example: 'Double paiement constate par le support', minLength: 5, maxLength: 300 }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class ReconcileDto {
  @ApiProperty({ example: '2026-11-09', description: 'Jour metier (fuseau du pays)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) day: string;
}

export class ReconciliationsQuery {
  @ApiPropertyOptional({ example: '2026-11-09' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 366 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) limit?: number;
}

/**
 * Payment administration (M6, P1.2): payments to check, refunds, daily reconciliation.
 * Reading: platform roles ops and support; refunds and manual runs: platform administrators.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly ops: PaymentOpsService) {}

  @Get()
  @ApiOperation({ summary: 'Paiements (filtre par statut, ex. a_verifier)' })
  list(@CurrentUser() user: AuthUser, @Query() q: AdminPaymentsQuery) {
    if (!hasPlatformRole(user, 'ops', 'support')) throw Errors.forbidden();
    return this.ops.list(q.status, q.limit);
  }

  @Get('reconciliations')
  @ApiOperation({ summary: 'Rapports de rapprochement quotidien fournisseur ↔ base' })
  reports(@CurrentUser() user: AuthUser, @Query() q: ReconciliationsQuery) {
    if (!hasPlatformRole(user, 'ops', 'support')) throw Errors.forbidden();
    return this.ops.reports(q.day, q.limit);
  }

  @Post('reconciliations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Relance le rapprochement d’un jour (remplace le rapport existant)' })
  reconcile(@CurrentUser() user: AuthUser, @Body() dto: ReconcileDto) {
    if (!hasPlatformRole(user)) throw Errors.forbidden();
    return this.ops.reconcile(dto.day);
  }

  @Post(':id/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Interroge tout de suite le fournisseur sur un paiement en attente ou a verifier' })
  check(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!hasPlatformRole(user, 'ops')) throw Errors.forbidden();
    return this.ops.checkNow(id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rembourse un paiement confirme (journalise ; une relance ne rembourse jamais deux fois)' })
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    if (!hasPlatformRole(user)) throw Errors.forbidden();
    return this.ops.refund(user, id, dto.reason);
  }
}
