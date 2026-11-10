import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { BillingService } from './billing.service';

export class CheckoutDto {
  @ApiProperty({ enum: ['user', 'organisation'] }) @IsIn(['user', 'organisation']) account_type: 'user' | 'organisation';
  @ApiProperty() @IsUUID() account_id: string;
  @ApiProperty({ example: 'pro' }) @IsString() plan: string;
  @ApiProperty({ enum: ['monthly', 'yearly'] }) @IsIn(['monthly', 'yearly']) period: 'monthly' | 'yearly';
  @ApiProperty({ enum: ['orange_money', 'mtn_momo'] }) @IsIn(['orange_money', 'mtn_momo']) method: string;
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

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('plans')
  plans(@Query() q: PlansQuery) {
    return this.billing.plans(q.country ?? 'CM');
  }

  @ApiBearerAuth()
  @Post('subscriptions/checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.billing.checkout(user, dto);
  }

  @ApiBearerAuth()
  @Get('subscriptions/current')
  current(@CurrentUser() user: AuthUser, @Query() q: CurrentSubQuery) {
    return this.billing.current(user, q.account_type, q.account_id);
  }

  @ApiBearerAuth()
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
    if (!this.billing.verifySignature(req.rawBody, signature)) throw Errors.unauthenticated('Signature invalide');
    return this.billing.applyResult(dto);
  }
}
