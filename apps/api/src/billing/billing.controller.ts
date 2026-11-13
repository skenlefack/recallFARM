import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiHeader, ApiOkResponse, ApiParam, ApiProperty, ApiTooManyRequestsResponse, ApiPropertyOptional, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { BillingService } from './billing.service';
import { BILLING_EXTRA_MODELS, CheckoutConflictView, CheckoutResultView, CurrentSubscriptionView, ErrorView, PaymentView, PlansView } from './billing.views';

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
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Apres une reponse 409 PAY-RECENT : details.payment_id recu, pour confirmer payer encore en connaissance de ce paiement (meme checkout, meme id). Accepte seulement s’il designe le paiement confirme le plus recent du payeur dans la fenetre (sinon nouveau 409 PAY-RECENT) ; ignore s’il n’y a pas de paiement recent. Note dans le journal et audit_log',
  })
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { message: 'details.payment_id du 409 PAY-RECENT (UUID)' })
  confirm_repeat?: string;
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
      'PAY-RECENT : un paiement d’abonnement du meme payeur a ete confirme il y a moins de PAYMENT_RECENT_GUARD_MIN minutes ; details.payment_id, details.plan, details.paid_at ; pour payer encore, renvoyer le meme checkout avec confirm_repeat = details.payment_id. PAY-OPEN (EF-ABO-01) : un paiement d’abonnement du meme payeur est encore ouvert (initie, en_attente ou a_verifier), quelle que soit la formule ; details.payment_id, details.status et details.plan le designent, le client le suit au lieu de payer une seconde fois. PAY-IDEMPOTENCY : le meme id sert deja a une autre demande. PAY-RETRY : le paiement ouvert vient de changer d’etat, ou un autre checkout du meme payeur est en cours (attente du verrou > 5 s) : reessayer.',
  })
  @ApiUnprocessableEntityResponse({ type: ErrorView, description: 'Champs invalides (dont id et Idempotency-Key qui ne designent pas le meme paiement), PAY-INIT (refus du fournisseur) ou PAY-PENDING (issue inconnue, details.payment_id a suivre)' })
  @ApiTooManyRequestsResponse({ type: ErrorView, description: 'RATE_LIMITED : trop de demandes de paiement (CHECKOUT_THROTTLE_LIMIT par minute, 10 par defaut) ; details.retry_after_s' })
  // A payment prompt per request: its own limit, much lower than the general one.
  @Throttle({ default: { limit: () => config().checkoutThrottleLimit, ttl: () => 60_000 } })
  @Post('subscriptions/checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto, @Headers('idempotency-key') key?: string) {
    if (key !== undefined && !/^[\x21-\x7e]{1,100}$/.test(key)) throw Errors.validation({ 'Idempotency-Key': '1 a 100 caracteres visibles' });
    return this.billing.checkout(user, { ...dto, ...(key ? { idempotency_key: key } : {}) });
  }

  @ApiBearerAuth()
  @ApiOkResponse({ type: CurrentSubscriptionView })
  @Get('subscriptions/current')
  current(@CurrentUser() user: AuthUser, @Query() q: CurrentSubQuery) {
    return this.billing.current(user, q.account_type, q.account_id);
  }

  @ApiBearerAuth()
  @ApiOkResponse({ type: PaymentView })
  @ApiParam({ name: 'id', format: 'uuid' })
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
