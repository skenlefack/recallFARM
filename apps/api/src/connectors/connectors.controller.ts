import { Body, Controller, Get, HttpCode, Inject, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, hasPlatformRole, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { BillingService } from '../billing/billing.service';
import { InboundService } from '../notifications/inbound.service';
import { MessagingService } from '../notifications/messaging.service';
import { ConnectorMessageProvider } from '../notifications/providers';
import { CONNECTOR_REGISTRY, ConnectorRegistry } from './connector-registry';
import { verifyInbound } from './connector-http';
import { ConnectorSpec } from './connector.types';
import { getPath, getString, render, toE164 } from './template';

export class ConnectorTestSmsDto {
  @ApiProperty({ example: '+237690000001' }) @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
}

type InboundReq = Request & { rawBody?: Buffer };

/**
 * Callbacks of the declarative aggregators (ADR-002). Each connector gets its own URLs:
 * /v1/connectors/:name/{sms,dlr,ussd,payment}. Payload mapping and authentication come
 * from the connector file.
 */
@ApiTags('connectors')
@Controller()
export class ConnectorsController {
  private readonly logger = new Logger('Connectors');

  constructor(
    @Inject(CONNECTOR_REGISTRY) private readonly registry: ConnectorRegistry,
    private readonly inbound: InboundService,
    private readonly messaging: MessagingService,
    private readonly billing: BillingService,
  ) {}

  /** Finds the connector and checks the caller (shared secret or HMAC). */
  private authorise(name: string, req: InboundReq): ConnectorSpec {
    const found = this.registry.get(name);
    if (!found) throw Errors.notFound('Connecteur');
    if (!verifyInbound(found.spec.inbound_auth, { headers: req.headers, query: req.query as Record<string, unknown>, rawBody: req.rawBody })) {
      this.logger.warn(`${name}: appel entrant refuse (authentification)`);
      throw Errors.unauthenticated('Authentification du connecteur invalide');
    }
    return found.spec;
  }

  private field(body: unknown, path: string, label: string): string {
    const v = getString(body, path);
    if (v === undefined || v === '') throw Errors.validation({ [label]: `champ ${path} absent` });
    return v;
  }

  /** Inbound number normalised to E.164 and validated (no paid reply to a malformed number). */
  private phone(body: unknown, path: string, label: string, spec: ConnectorSpec): string {
    const e164 = toE164(this.field(body, path, label), spec.national_prefix);
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw Errors.validation({ [label]: 'numero invalide' });
    return e164;
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/sms')
  @ApiOperation({ summary: 'SMS entrant envoye par un agregateur (format decrit par le connecteur)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async inboundSms(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>) {
    const spec = this.authorise(name, req);
    if (!spec.sms?.inbound) throw Errors.notFound('Reception SMS');
    const from = this.phone(body, spec.sms.inbound.from, 'from', spec);
    const text = getString(body, spec.sms.inbound.text) ?? '';
    return this.inbound.handleSms(from, text);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/dlr')
  @ApiOperation({ summary: 'Accuse de reception d’un SMS (DLR)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async dlr(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>) {
    const spec = this.authorise(name, req);
    const dlr = spec.sms?.dlr ?? spec.whatsapp?.dlr;
    if (!dlr) throw Errors.notFound('Accuses de reception');
    const ref = this.field(body, dlr.ref, 'ref');
    const raw = getString(body, dlr.status) ?? '';
    const status = Object.hasOwn(dlr.status_map, raw) ? dlr.status_map[raw] : undefined;
    if (!status) return { received: true, applied: false };
    const updated = await this.messaging.applyDeliveryReport(ref, status, getString(body, dlr.error));
    return { received: true, applied: updated > 0 };
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/ussd')
  @ApiOperation({ summary: 'Etape de session USSD (menu du pack pays)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async ussd(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const spec = this.authorise(name, req);
    if (!spec.ussd) throw Errors.notFound('USSD');
    const m = spec.ussd.inbound;
    const sessionId = this.field(body, m.session_id, 'session_id');
    const phone = this.phone(body, m.phone, 'phone', spec);
    const text = getString(body, m.text) ?? '';
    const { response } = await this.inbound.handleUssd(sessionId, phone, text);
    if (spec.ussd.response.type === 'text') {
      res.type('text/plain');
      return response;
    }
    const cont = response.startsWith('CON ');
    return render(spec.ussd.response.body, { message: response.replace(/^(CON|END) /, ''), continue: cont, session_id: sessionId });
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/payment')
  @ApiOperation({ summary: 'Resultat asynchrone d’un paiement mobile money' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async payment(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>) {
    const spec = this.authorise(name, req);
    const w = spec.payment?.webhook;
    if (!w) throw Errors.notFound('Paiement');
    const ack = w.ack ?? { received: true };
    const raw = getString(body, w.status) ?? '';
    const status = Object.hasOwn(w.status_map, raw) ? w.status_map[raw] : undefined;
    if (!status || status === 'en_attente') {
      if (!status) this.logger.warn(`${name}: statut de paiement non reconnu "${raw}" (ignore)`);
      return ack;
    }
    const paymentId = getString(body, w.payment_id);
    const ref = getString(body, w.ref);
    if (!paymentId && !ref) throw Errors.validation({ reference: 'reference du paiement absente' });
    const fees = Number(getPath(body, w.fees_minor));
    const amount = w.amount_minor ? Number(getPath(body, w.amount_minor)) : undefined;
    await this.billing.applyResult(
      {
        ...(paymentId && /^[0-9a-f-]{36}$/i.test(paymentId) ? { payment_id: paymentId } : { provider_ref: ref ?? paymentId }),
        status,
        ...(Number.isInteger(fees) && w.fees_minor ? { fees_minor: fees } : {}),
      },
      {
        connector: name,
        body,
        ...(amount !== undefined ? { amount_minor: Number.isInteger(amount) ? amount : NaN } : {}),
        ...(w.currency ? { currency: getString(body, w.currency) ?? '' } : {}),
      },
    );
    return ack;
  }

  /** Configured connectors, without secrets nor URLs (platform admins and ops). */
  @ApiBearerAuth()
  @Get('admin/connectors')
  list(@CurrentUser() user: AuthUser) {
    if (!hasPlatformRole(user, 'ops')) throw Errors.forbidden();
    return { data: this.registry.summary() };
  }

  /** Sends a test SMS through one connector, to check a new aggregator before routing traffic to it. */
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('admin/connectors/:name/test-sms')
  async testSms(@CurrentUser() user: AuthUser, @Param('name') name: string, @Body() dto: ConnectorTestSmsDto, @Query('channel') channel?: string) {
    if (!hasPlatformRole(user)) throw Errors.forbidden();
    const found = this.registry.get(name);
    const ch = channel === 'whatsapp' ? 'whatsapp' : 'sms';
    const spec = found?.spec[ch];
    if (!found || !spec) throw Errors.notFound('Connecteur');
    const provider = new ConnectorMessageProvider(found.client, spec);
    const text = 'RecallFarm : message de test du connecteur. Aucune action requise.';
    const res = await provider.send(dto.phone, text);
    await this.messaging.record(
      { channel: ch, phone: dto.phone, text, template_code: 'test_connecteur', user_id: user.id },
      res.status,
      { provider_ref: res.provider_ref ?? null, error_code: res.error_code ?? null, sent_at: res.status === 'envoye' ? new Date() : null, cost_minor: res.cost_minor ?? null, currency: res.currency ?? null },
    );
    return { connector: name, channel: ch, ...res };
  }
}
