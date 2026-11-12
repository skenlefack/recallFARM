import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiHeader, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { BillingService } from './billing.service';
import { BILLING_EXTRA_MODELS, CheckoutConflictView, CheckoutResultView, ErrorView, PaymentView, PlansView } from './billing.views';

export class CheckoutDto {
  @ApiPropertyOptional({
    description: 'UUID v4 cree par le client (recommande) : un nouvel envoi avec le meme id renvoie le meme paiement, sans second prelevement',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;
  @ApiProperty({ enum: ['user', 'organisation'] }) @IsIn(['user', 'organisation']) account_type: 'user' | 'organisation';
  @ApiProperty() @IsUUID() account_id: string;
  @ApiProperty({ example: 'pro' }) @IsString() plan: string;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) @IsIn(['monthly', 'yearly']) period: 'monthly' | 'yearly';
  @ApiProperty({ example: 'orange_money', description: 'Code d’un moyen de paiement du pack pays (GET /plans → payment_methods)' })
  @Matches(/^[a-z0-9_]{2,30}$/)
  method: string;
  @ApiProperty({ example: '+237690000001' }) @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
}

export class WebhookDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() payment_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() provider_ref?: string;
  @ApiProperty({ example: 'confirme' }) @IsString() status: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() fees_minor?: number;
}

export class PlansQuery {
  @ApiPropertyOptional({ example: 'CM' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
}

export class CurrentSubQuery {
  @ApiPropertyOptional({ enum: ['user', 'organisation'] }) @IsOptional() @IsIn(['user', 'organisation']) account_type?: 'user' | 'organisation';
  @ApiPropertyOptional() @IsOptional() @IsUUID() account_id?: string;
}

@ApiExtraModels(...BILLING_EXTRA_MODELS)
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @ApiOkResponse({ type: PlansView })
  @ApiUnprocessableEntityResponse({ type: ErrorView, description: 'PAY-CURRENCY : aucune devise parametree pour ce pays (pack pays)' })
  @Get('plans')
  plans(@Query() q: PlansQuery) {
    return this.billing.plans(q.country ?? 'CM');
  }

  @ApiBearerAuth()
  @ApiHeader({ name: 'idempotency-key', required: false, description: 'Alternative a `id` (1 a 100 caracteres) : meme cle, meme paiement' })
  @ApiCreatedResponse({ type: CheckoutResultView, description: 'Paiement lance, ou rejeu (replayed: true) du meme id / de la meme Idempotency-Key' })
  @ApiConflictResponse({
    type: CheckoutConflictView,
    description:
      'PAY-OPEN (EF-ABO-01) : un paiement du meme payeur pour la meme formule est encore ouvert (initie, en_attente ou a_verifier) ; details.payment_id et details.status le designent, le client le suit au lieu de payer une seconde fois. PAY-IDEMPOTENCY : le meme id sert deja a une autre demande.',
  })
  @ApiUnprocessableEntityResponse({ type: ErrorView, description: 'Champs invalides, PAY-INIT (refus du fournisseur) ou PAY-PENDING (issue inconnue, details.payment_id a suivre)' })
  @Post('subscriptions/checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto, @Headers('idempotency-key') key?: string) {
    if (key !== undefined && !/^[\x21-\x7e]{1,100}$/.test(key)) throw Errors.validation({ 'Idempotency-Key': '1 a 100 caracteres visibles' });
    return this.billing.checkout(user, { ...dto, ...(key ? { idempotency_key: key } : {}) });
  }

  @ApiBearerAuth()
  @Get('subscriptions/current')
  current(@CurrentUser() user: AuthUser, @Query() q: CurrentSubQuery) {
    return this.billing.current(user, q.account_type, q.account_id);
  }

  @ApiBearerAuth()
  @ApiOkResponse({ type: PaymentView })
  @Get('payments/:id')
  payment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getPayment(user, id);
  }

  /** Aggregator webhook: HMAC-SHA256 of the raw body (hex) in X-Signature. */
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('payments/webhook')
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-signature') signature: string | undefined, @Body() dto: WebhookDto) {
    // With connectors, results arrive only on /connectors/:name/payment, tied to the connector (m13).
    if (config().paymentProvider === 'connector') throw Errors.notFound('Route');
    if (!this.billing.verifySignature(req.rawBody, signature)) throw Errors.unauthenticated('Signature invalide');
    return this.billing.applyResult(dto);
  }
}
