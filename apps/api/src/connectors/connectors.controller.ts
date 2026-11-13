import { Body, Controller, Get, HttpCode, Inject, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, hasPlatformRole, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { KvService } from '../common/kv.service';
import { BillingService } from '../billing/billing.service';
import { InboundService } from '../notifications/inbound.service';
import { MessagingService } from '../notifications/messaging.service';
import { ConnectorMessageProvider } from '../notifications/providers';
import { UssdSessionService } from '../notifications/ussd-session.service';
import { CONNECTOR_REGISTRY, ConnectorRegistry } from './connector-registry';
import { ConnectorSummaryListView } from './connector.views';
import { inspectInbound } from './connector-http';
import { ConnectorSpec } from './connector.types';
import { getPath, getString, toE164 } from './template';
import { renderUssdResponse, ussdOptions } from './ussd';

export class ConnectorTestSmsDto {
  @ApiProperty({ example: '+237690000001' }) @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
}

type InboundReq = Request & { rawBody?: Buffer };

/** Outcome of the inbound check: the connector, and the anti-replay claim when the call is signed with a time. */
interface Authorised {
  spec: ConnectorSpec;
  replay: { key: string; ttlMs: number } | null;
}

/** Value supplied by the caller, made safe for one log line (m10): no control characters, 40 characters at most. */
export function logSafe(v: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

/**
 * Callbacks of the declarative aggregators (ADR-002). Each connector gets its own URLs:
 * /v1/connectors/:name/{sms,dlr,ussd,payment}. Payload mapping and authentication come
 * from the connector file. SMS and delivery reports are also accepted as GET with query
 * parameters (common with HTTP gateways, m15); JSON and form bodies are read, text/plain is not.
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
    private readonly sessions: UssdSessionService,
    private readonly kv: KvService,
  ) {}

  /**
   * Finds the connector and checks the caller (shared secret or HMAC, constant time). An unknown
   * connector gets the same 401 as a wrong secret, so names cannot be enumerated (m9). With a signing
   * time, the signature is claimed: a second identical call is a duplicate, answered without being
   * processed again (see `once`). A call outside the time window stays refused (401).
   */
  private async authorise(name: string, req: InboundReq): Promise<Authorised> {
    const refused = Errors.unauthenticated('Authentification du connecteur invalide');
    const found = this.registry.get(name);
    if (!found) {
      this.logger.warn(`appel entrant refuse : connecteur inconnu "${logSafe(name)}"`);
      throw refused;
    }
    const check = inspectInbound(found.spec.inbound_auth, { headers: req.headers, query: req.query as Record<string, unknown>, rawBody: req.rawBody });
    if (!check.ok) {
      this.logger.warn(`${name}: appel entrant refuse (${check.reason})`);
      throw refused;
    }
    if (!check.replay_key) return { spec: found.spec, replay: null };
    return { spec: found.spec, replay: { key: `replay:${name}:${check.replay_key}`, ttlMs: check.replay_ttl_ms ?? 600_000 } };
  }

  /**
   * Anti-replay without losing a legitimate retry (M2): a duplicate gets `duplicateAnswer` (the usual
   * acknowledgement); the claim is released when processing fails, so the aggregator's retry is processed.
   */
  private async once<T>(auth: Authorised, process: () => Promise<T>, duplicateAnswer: () => Promise<T>): Promise<T> {
    // The signature is claimed only here, after validation: a refused call (422) leaves no claim.
    if (auth.replay && !(await this.kv.setNx(auth.replay.key, 'pending', auth.replay.ttlMs))) {
      this.logger.warn(`appel signe deja recu (rejeu) : reponse sans nouveau traitement`);
      return duplicateAnswer();
    }
    try {
      const out = await process();
      if (auth.replay) await this.kv.set(auth.replay.key, 'done', auth.replay.ttlMs);
      return out;
    } catch (e) {
      if (auth.replay) await this.kv.del(auth.replay.key);
      throw e;
    }
  }

  /** Body of a POST, or the query parameters of a GET. */
  private payload(req: InboundReq, body: unknown): unknown {
    return req.method === 'GET' ? req.query : body;
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
  @Get('connectors/:name/sms')
  @ApiOperation({ summary: 'SMS entrant en GET (parametres d’URL), pour les passerelles qui n’envoient pas de corps' })
  inboundSmsGet(@Param('name') name: string, @Req() req: InboundReq) {
    return this.inboundSms(name, req, {});
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/sms')
  @ApiOperation({ summary: 'SMS entrant envoye par un agregateur (format decrit par le connecteur)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async inboundSms(@Param('name') name: string, @Req() req: InboundReq, @Body() rawBody: Record<string, unknown>) {
    const auth = await this.authorise(name, req);
    const spec = auth.spec;
    const body = this.payload(req, rawBody);
    if (!spec.sms?.inbound) throw Errors.notFound('Reception SMS');
    const from = this.phone(body, spec.sms.inbound.from, 'from', spec);
    const text = getString(body, spec.sms.inbound.text) ?? '';
    return this.once<Record<string, unknown>>(
      auth,
      () => this.inbound.handleSms(from, text),
      async () => ({ handled: false, duplicate: true }),
    );
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Get('connectors/:name/dlr')
  @ApiOperation({ summary: 'Accuse de reception en GET (parametres d’URL)' })
  @ApiQuery({ name: 'channel', required: false, enum: ['sms', 'whatsapp'] })
  dlrGet(@Param('name') name: string, @Req() req: InboundReq, @Query('channel') channel?: string) {
    return this.dlr(name, req, {}, channel);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/dlr')
  @ApiOperation({ summary: 'Accuse de reception d’un SMS ou d’un message WhatsApp (?channel=whatsapp)' })
  @ApiQuery({ name: 'channel', required: false, enum: ['sms', 'whatsapp'] })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async dlr(@Param('name') name: string, @Req() req: InboundReq, @Body() rawBody: Record<string, unknown>, @Query('channel') channel?: string) {
    const auth = await this.authorise(name, req);
    const spec = auth.spec;
    const body = this.payload(req, rawBody);
    // Each channel has its own format and its own messages (m5).
    const ch = channel === 'whatsapp' ? 'whatsapp' : 'sms';
    const dlr = spec[ch]?.dlr;
    if (!dlr) throw Errors.notFound('Accuses de reception');
    const ref = this.field(body, dlr.ref, 'ref');
    const raw = getString(body, dlr.status) ?? '';
    const status = Object.hasOwn(dlr.status_map, raw) ? dlr.status_map[raw] : undefined;
    if (!status) return { received: true, applied: false };
    return this.once<Record<string, unknown>>(
      auth,
      async () => ({ received: true, applied: (await this.messaging.applyDeliveryReport(name, ch, ref, status, getString(body, dlr.error))) > 0 }),
      async () => ({ received: true, applied: false, duplicate: true }),
    );
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/ussd')
  @ApiOperation({ summary: 'Etape de session USSD (menu du pack pays, saisie cumulee ou derniere saisie, ecrans pagines)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async ussd(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const auth = await this.authorise(name, req);
    const spec = auth.spec;
    if (!spec.ussd) throw Errors.notFound('USSD');
    const m = spec.ussd.inbound;
    const sessionId = this.field(body, m.session_id, 'session_id');
    if (sessionId.length > 100) throw Errors.validation({ session_id: '100 caracteres au plus' });
    const phone = this.phone(body, m.phone, 'phone', spec);
    const text = (getString(body, m.text) ?? '').slice(0, 200);
    const options = ussdOptions(spec.ussd);
    const hop = () => this.sessions.hop(name, sessionId, phone, text, options);
    // A replayed signed hop gets the screen stored for the session, without a new step.
    const screen = await this.once(auth, hop, async () => (await this.sessions.current(name, sessionId, phone)) ?? hop());
    const out = renderUssdResponse(spec.ussd.response, screen, sessionId);
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.type(out.contentType);
    return out.body;
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('connectors/:name/payment')
  @ApiOperation({ summary: 'Resultat asynchrone d’un paiement mobile money' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async payment(@Param('name') name: string, @Req() req: InboundReq, @Body() body: Record<string, unknown>) {
    const auth = await this.authorise(name, req);
    const w = auth.spec.payment?.webhook;
    if (!w) throw Errors.notFound('Paiement');
    const ack = w.ack ?? { received: true };
    const raw = getString(body, w.status) ?? '';
    const status = Object.hasOwn(w.status_map, raw) ? w.status_map[raw] : undefined;
    if (!status || status === 'en_attente') {
      if (!status) this.logger.warn(`${name}: statut de paiement non reconnu "${logSafe(raw)}" (ignore)`);
      return ack;
    }
    const paymentId = getString(body, w.payment_id);
    const ref = getString(body, w.ref);
    if (!paymentId && !ref) throw Errors.validation({ reference: 'reference du paiement absente' });
    const fees = Number(getPath(body, w.fees_minor));
    const amount = w.amount_minor ? Number(getPath(body, w.amount_minor)) : undefined;
    const apply = () => this.billing.applyResult(
      {
        ...(paymentId && /^[0-9a-f-]{36}$/i.test(paymentId) ? { payment_id: paymentId } : { provider_ref: ref ?? paymentId }),
        status,
        ...(Number.isInteger(fees) && w.fees_minor ? { fees_minor: fees } : {}),
      },
      {
        source: 'webhook',
        connector: name,
        body,
        ...(amount !== undefined ? { amount_minor: Number.isInteger(amount) ? amount : NaN } : {}),
        ...(w.currency ? { currency: getString(body, w.currency) ?? '' } : {}),
      },
    );
    // Already processed (or being processed): same acknowledgement, no second application.
    await this.once<unknown>(auth, apply, async () => null);
    return ack;
  }

  /** Configured connectors, without secrets nor URLs (platform admins and ops). */
  @ApiBearerAuth()
  @ApiOkResponse({ type: ConnectorSummaryListView })
  @Get('admin/connectors')
  list(@CurrentUser() user: AuthUser) {
    if (!hasPlatformRole(user, 'ops')) throw Errors.forbidden();
    // Payment events refused because another connector sent them (since start-up, BillingService).
    const foreign = this.billing.foreignEventCounts();
    return { data: this.registry.summary().map((c) => ({ ...c, foreign_payment_events: foreign[c.name] ?? 0 })) };
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
    const m = await this.messaging.sendWith(provider, { channel: ch, phone: dto.phone, text, template_code: 'test_connecteur', user_id: user.id });
    return {
      connector: name,
      channel: ch,
      message_id: m.id,
      status: m.status,
      ...(m.provider_ref ? { provider_ref: m.provider_ref } : {}),
      ...(m.error_code ? { error_code: m.error_code } : {}),
      ...(m.cost_minor !== null && m.currency ? { cost_minor: Number(m.cost_minor), currency: m.currency } : {}),
    };
  }
}
