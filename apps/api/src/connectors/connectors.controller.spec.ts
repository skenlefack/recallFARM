import { createHmac } from 'crypto';
import type { Response } from 'express';
import { BillingService } from '../billing/billing.service';
import { KvService } from '../common/kv.service';
import { InboundService } from '../notifications/inbound.service';
import { MessagingService } from '../notifications/messaging.service';
import { UssdSessionService } from '../notifications/ussd-session.service';
import { ConnectorRegistry } from './connector-registry';
import { ConnectorsController } from './connectors.controller';

/** Anti-replay without losing a legitimate retry (M2, revue P1.1-P1.2-integrations). */
describe('ConnectorsController: signed calls and replays', () => {
  const registry = new ConnectorRegistry({
    connectors: {
      sig: {
        inbound_auth: { type: 'hmac_sha256', header: 'x-sig', secret: 'k', timestamp_header: 'x-ts', signed_payload: '{{timestamp}}.{{body}}' },
        sms: { send: { url: 'https://h.example/s' }, inbound: { from: 'from', text: 'text' }, dlr: { ref: 'id', status: 'st', status_map: { OK: 'delivre' } } },
        ussd: { inbound: { session_id: 'sid', phone: 'p', text: 't' }, response: { type: 'text' } },
        payment: {
          initiate: { url: 'https://h.example/c', result: { ref: 'id' } },
          webhook: { payment_id: 'ref', status: 'status', status_map: { OK: 'confirme' }, ack: { ok: 1 } },
        },
      },
    },
  });

  function signedReq(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'k').update(`${ts}.${raw}`).digest('hex');
    return { method: 'POST', headers: { 'x-ts': ts, 'x-sig': sig }, query: {}, rawBody: Buffer.from(raw) } as never;
  }

  function controller() {
    const billing = { applyResult: jest.fn().mockRejectedValueOnce(new Error('base indisponible')).mockResolvedValue({ status: 'confirme' }) };
    const messaging = { applyDeliveryReport: jest.fn().mockResolvedValue(1) };
    const inbound = { handleSms: jest.fn().mockResolvedValue({ handled: true }) };
    const sessions = { hop: jest.fn().mockResolvedValue({ text: 'Menu', end: false }), current: jest.fn().mockResolvedValue({ text: 'Menu', end: false }) };
    const c = new ConnectorsController(
      registry,
      inbound as unknown as InboundService,
      messaging as unknown as MessagingService,
      billing as unknown as BillingService,
      sessions as unknown as UssdSessionService,
      new KvService(),
    );
    return { c, billing, messaging, inbound, sessions };
  }

  it('a failed webhook releases its signature: the identical retry is processed; a later replay gets the ack only', async () => {
    const { c, billing } = controller();
    const body = { ref: '0b7c6f2e-1d2a-4c3b-9e8f-7a6b5c4d3e2f', status: 'OK' };
    const req = signedReq(body);
    await expect(c.payment('sig', req, body)).rejects.toThrow('base indisponible');
    expect(await c.payment('sig', req, body)).toEqual({ ok: 1 });
    expect(await c.payment('sig', req, body)).toEqual({ ok: 1 });
    expect(billing.applyResult).toHaveBeenCalledTimes(2);
  });

  it('replayed SMS, DLR and USSD calls are answered without a second processing', async () => {
    const { c, inbound, messaging, sessions } = controller();
    const sms = { from: '+237690000001', text: 'OK 1234' };
    const smsReq = signedReq(sms);
    expect(await c.inboundSms('sig', smsReq, sms)).toEqual({ handled: true });
    expect(await c.inboundSms('sig', smsReq, sms)).toEqual({ handled: false, duplicate: true });
    expect(inbound.handleSms).toHaveBeenCalledTimes(1);
    const dlr = { id: 'M1', st: 'OK' };
    const dlrReq = signedReq(dlr);
    expect(await c.dlr('sig', dlrReq, dlr)).toEqual({ received: true, applied: true });
    expect(await c.dlr('sig', dlrReq, dlr)).toEqual({ received: true, applied: false, duplicate: true });
    expect(messaging.applyDeliveryReport).toHaveBeenCalledTimes(1);
    const hop = { sid: 's', p: '+237690000001', t: '' };
    const hopReq = signedReq(hop);
    const res = { setHeader: jest.fn(), type: jest.fn() } as unknown as Response;
    expect(await c.ussd('sig', hopReq, hop, res)).toBe('CON Menu');
    expect(await c.ussd('sig', hopReq, hop, res)).toBe('CON Menu');
    expect(sessions.hop).toHaveBeenCalledTimes(1);
    expect(sessions.current).toHaveBeenCalledTimes(1);
  });

  it('a call refused by validation leaves no claim behind', async () => {
    const { c, inbound } = controller();
    const bad = { text: 'OK 1234' };
    const req = signedReq(bad);
    await expect(c.inboundSms('sig', req, bad)).rejects.toMatchObject({ status: 422 });
    await expect(c.inboundSms('sig', req, bad)).rejects.toMatchObject({ status: 422 });
    expect(inbound.handleSms).not.toHaveBeenCalled();
  });
});
