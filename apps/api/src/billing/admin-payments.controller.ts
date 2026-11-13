import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, hasPlatformRole } from '../common/auth';
import { Errors } from '../common/errors';
import { AdminPaymentListView, AdminPaymentView, BILLING_EXTRA_MODELS, ErrorView, PAYMENT_STATUSES, PaymentCheckView, PaymentRefundView, ReconciliationListView, ReconciliationReportView } from './billing.views';
import { PaymentOpsService } from './payment-ops.service';

const STATUSES = PAYMENT_STATUSES;

export class AdminPaymentsQuery {
  @ApiPropertyOptional({ enum: STATUSES, description: '"a_verifier" : paiements dont le fournisseur n’a pas donne l’issue' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'true : seulement les paiements a revoir (needs_review)' })
  @IsOptional()
  @IsIn(['true', 'false'])
  needs_review?: 'true' | 'false';
  @ApiPropertyOptional({ minimum: 1, maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class RefundDto {
  @ApiProperty({ example: 'Double paiement constate par le support', minLength: 5, maxLength: 300 }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
}

export class ResolveDto {
  @ApiProperty({ enum: ['confirme', 'echoue'], description: 'confirme : active l’abonnement ; echoue : libere le payeur (PAY-OPEN)' })
  @IsIn(['confirme', 'echoue'])
  outcome: 'confirme' | 'echoue';
  @ApiProperty({ example: 'Releve Orange Money du 12/11 : debit constate', minLength: 5, maxLength: 300 }) @IsString() @MinLength(5) @MaxLength(300) reason: string;
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
 * Reading: platform roles ops and support; refunds, operator decisions and manual runs: platform administrators.
 */
@ApiExtraModels(...BILLING_EXTRA_MODELS)
@ApiTags('billing')
@ApiBearerAuth()
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly ops: PaymentOpsService) {}

  @Get()
  @ApiOperation({ summary: 'Paiements (filtre par statut, ex. a_verifier)' })
  @ApiOkResponse({ type: AdminPaymentListView })
  list(@CurrentUser() user: AuthUser, @Query() q: AdminPaymentsQuery) {
    if (!hasPlatformRole(user, 'ops', 'support')) throw Errors.forbidden();
    return this.ops.list(q.status, q.limit, q.needs_review === undefined ? undefined : q.needs_review === 'true');
  }

  @Get('reconciliations')
  @ApiOperation({ summary: 'Rapports de rapprochement quotidien fournisseur ↔ base' })
  @ApiOkResponse({ type: ReconciliationListView })
  reports(@CurrentUser() user: AuthUser, @Query() q: ReconciliationsQuery) {
    if (!hasPlatformRole(user, 'ops', 'support')) throw Errors.forbidden();
    return this.ops.reports(q.day, q.limit);
  }

  @Post('reconciliations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Relance le rapprochement d’un jour (remplace le rapport existant)' })
  @ApiOkResponse({ type: ReconciliationReportView })
  reconcile(@CurrentUser() user: AuthUser, @Body() dto: ReconcileDto) {
    if (!hasPlatformRole(user)) throw Errors.forbidden();
    return this.ops.reconcile(dto.day);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d’un paiement avec son journal d’evenements (date, statut, source)' })
  @ApiOkResponse({ type: AdminPaymentView })
  @ApiParam({ name: 'id', format: 'uuid' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!hasPlatformRole(user, 'ops', 'support')) throw Errors.forbidden();
    return this.ops.get(id);
  }

  @Post(':id/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Interroge tout de suite le fournisseur sur un paiement en attente ou a verifier' })
  @ApiOkResponse({ type: PaymentCheckView })
  @ApiParam({ name: 'id', format: 'uuid' })
  check(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!hasPlatformRole(user, 'ops')) throw Errors.forbidden();
    return this.ops.checkNow(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tranche un paiement « a_verifier » sans issue du fournisseur (administrateur plateforme ; journalise dans audit_log)' })
  @ApiOkResponse({ type: AdminPaymentView })
  @ApiForbiddenResponse({ type: ErrorView, description: 'Reserve a platform_admin (ops et support : 403)' })
  @ApiConflictResponse({ type: ErrorView, description: 'PAY-RESOLVE-STATUS : le paiement n’est pas (ou plus) « a_verifier » ; details.status = statut actuel' })
  @ApiParam({ name: 'id', format: 'uuid' })
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto) {
    if (!user.platform_roles.includes('platform_admin')) throw Errors.forbidden();
    const reason = dto.reason.trim();
    if (reason.length < 5) throw Errors.validation({ reason: 'au moins 5 caracteres hors espaces' });
    return this.ops.resolve(user, id, dto.outcome, reason);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rembourse un paiement confirme (journalise ; une relance ne rembourse jamais deux fois)' })
  @ApiOkResponse({ type: PaymentRefundView })
  @ApiParam({ name: 'id', format: 'uuid' })
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    if (!hasPlatformRole(user)) throw Errors.forbidden();
    return this.ops.refund(user, id, dto.reason);
  }
}
