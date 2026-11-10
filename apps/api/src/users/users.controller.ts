import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { config } from '../config';
import { AuthService } from './auth.service';
import { DATA_REGISTRY } from './data-registry';
import { CONSENT_SCOPES, UsersService } from './users.service';

export class OtpRequestDto {
  @ApiProperty({ example: '+237690000001' }) @IsString() @MaxLength(20) phone: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+237690000001' }) @IsString() @MaxLength(20) phone: string;
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code: string;
  @ApiPropertyOptional({ description: 'Offline provisional account to attach' }) @IsOptional() @IsUUID() provisional_user_id?: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() refresh_token: string;
}

export class PatchMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en'] }) @IsOptional() @IsIn(['fr', 'en', 'wo', 'bm', 'dyu', 'ff', 'mos', 'ln', 'sw', 'sg', 'ewo', 'mg']) language?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) default_currency?: string;
}

export class ConsentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ enum: CONSENT_SCOPES }) @IsIn(CONSENT_SCOPES) scope: string;
  @ApiProperty() @IsBoolean() granted: boolean;
  @ApiProperty({ example: '2026-10' }) @IsString() @MaxLength(40) text_version: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisation_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional({ enum: ['app', 'ussd', 'agent'] }) @IsOptional() @IsIn(['app', 'ussd', 'agent']) channel?: string;
}

export class DeleteMeDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) otp_code?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: () => Math.max(10, Math.floor(config().throttleLimit / 30)), ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  request(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: () => Math.max(20, Math.floor(config().throttleLimit / 15)), ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.provisional_user_id);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refresh_token);
  }
}

@ApiTags('rgpd')
@Controller()
export class DataRegistryController {
  @Public()
  @Get('data-registry')
  registry() {
    return { data: DATA_REGISTRY };
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.users.me(u.id);
  }

  @Get('export')
  fullExport(@CurrentUser() u: AuthUser) {
    return this.users.fullExport(u.id);
  }

  @Patch()
  patch(@CurrentUser() u: AuthUser, @Body() dto: PatchMeDto) {
    return this.users.patch(u, dto);
  }

  @Get('consents')
  async consents(@CurrentUser() u: AuthUser) {
    return { data: await this.users.consents(u), next_cursor: null };
  }

  @Post('consents')
  addConsent(@CurrentUser() u: AuthUser, @Body() dto: ConsentDto) {
    return this.users.addConsent(u, dto);
  }

  @Post('export')
  @HttpCode(202)
  exportData(@CurrentUser() u: AuthUser) {
    return this.users.requestExport(u);
  }

  @Get('requests/:id')
  request(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.request(u, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.cancelRequest(u, id);
  }

  @Delete()
  @HttpCode(202)
  remove(@CurrentUser() u: AuthUser, @Body() _dto: DeleteMeDto) {
    return this.users.requestDeletion(u);
  }

  @Post('delete/cancel')
  @HttpCode(200)
  cancelDeletion(@CurrentUser() u: AuthUser) {
    return this.users.cancelDeletion(u);
  }
}
