import { DataSource } from 'typeorm';
import { PaymentOpsService } from '../billing/payment-ops.service';
import { PaymentsScheduler } from '../billing/payments.scheduler';
import { KvService } from '../common/kv.service';
import { reloadConfig } from '../config';
import { ussdOptions, UssdScreen } from '../connectors/ussd';
import { InboundService } from './inbound.service';
import { UssdSessionService } from './ussd-session.service';

/** In-memory stand-in for Redis (the "redis" backend of KvService). */
function fakeKv(backend: 'redis' | 'memory') {
  const store = new Map<string, string>();
  const kv = {
    backend,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
  };
  return { kv: kv as unknown as KvService, store, raw: kv };
}

describe('UssdSessionService (M5)', () => {
  const screens: Record<string, UssdScreen> = {
    '': { text: 'RecallFarm\n1. Rappels du jour\n2. Confirmer un rappel\n3. Declarer une mortalite', end: false },
    '2': { text: 'Entrez le code du rappel :', end: false },
    '2|4821': { text: 'Merci, rappel confirme.', end: true },
  };
  const inbound = { ussdScreen: jest.fn(async (_s: string, _p: string, parts: string[]) => screens[parts.join('|')] ?? { text: 'Choix invalide.', end: true }) };

  it('keeps the state in Redis when configured, and pages long screens', async () => {
    const { kv, store } = fakeKv('redis');
    const ds = { query: jest.fn() } as unknown as DataSource;
    const svc = new UssdSessionService(ds, kv, inbound as unknown as InboundService);
    expect(svc.backend).toBe('redis');
    const o = { ...ussdOptions(), text_mode: 'last' as const, max_chars: 60 };
    const p1 = await svc.hop('agg', 's1', '+237690000001', '', o);
    expect(p1.end).toBe(false);
    expect(p1.text.endsWith('0. Suite')).toBe(true);
    const p2 = await svc.hop('agg', 's1', '+237690000001', '0', o);
    expect(p2.text).toContain('Declarer');
    expect((await svc.hop('agg', 's1', '+237690000001', '2', o)).text).toBe('Entrez le code du rappel :');
    expect(await svc.hop('agg', 's1', '+237690000001', '4821', o)).toEqual({ text: 'Merci, rappel confirme.', end: true });
    expect([...store.keys()]).toEqual(['ussd:agg:s1:+237690000001']);
    expect(await svc.purge()).toBe(0);
    expect((ds.query as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('ignores a corrupted state and starts again', async () => {
    const { kv, store } = fakeKv('redis');
    const svc = new UssdSessionService({ query: jest.fn() } as unknown as DataSource, kv, inbound as unknown as InboundService);
    store.set('ussd:agg:s2:+237690000001', JSON.stringify({ inputs: 'x' }));
    expect(await svc.load('ussd:agg:s2:+237690000001')).toBeNull();
    expect(await svc.load('ussd:agg:absent')).toBeNull();
  });

  it('purges expired rows of the table on schedule, and logs a failure without stopping', async () => {
    const { kv } = fakeKv('memory');
    const query = jest.fn().mockResolvedValueOnce([[], 3]).mockRejectedValueOnce(new Error('db down'));
    const svc = new UssdSessionService({ query } as unknown as DataSource, kv, inbound as unknown as InboundService);
    expect(svc.backend).toBe('postgres');
    process.env.SCHEDULER_ENABLED = 'true';
    reloadConfig();
    await svc.purgeTick();
    await expect(svc.purgeTick()).resolves.toBeUndefined();
    expect(query.mock.calls[0][0]).toContain('DELETE FROM ussd_sessions WHERE expires_at <= now()');
    process.env.SCHEDULER_ENABLED = 'false';
    reloadConfig();
    await svc.purgeTick();
    expect(query).toHaveBeenCalledTimes(2);
    delete process.env.SCHEDULER_ENABLED;
    reloadConfig();
  });
});

describe('PaymentsScheduler (M6)', () => {
  afterEach(() => {
    delete process.env.SCHEDULER_ENABLED;
    reloadConfig();
  });

  it('runs the status queries and the daily reconciliation under a lock, only when the scheduler is enabled', async () => {
    const { kv, raw } = fakeKv('memory');
    const ops = {
      pollPending: jest.fn().mockResolvedValueOnce({ checked: 2 }).mockResolvedValueOnce({ checked: 0 }).mockRejectedValueOnce(new Error('db')),
      hasReport: jest.fn().mockResolvedValue(false),
      reconcile: jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('agregateur')),
    };
    const s = new PaymentsScheduler(kv, ops as unknown as PaymentOpsService);
    process.env.SCHEDULER_ENABLED = 'false';
    reloadConfig();
    await s.statusTick();
    expect(await s.reconciliationTick()).toBeNull();
    expect(ops.pollPending).not.toHaveBeenCalled();
    process.env.SCHEDULER_ENABLED = 'true';
    reloadConfig();
    await s.statusTick();
    await s.statusTick();
    await expect(s.statusTick()).resolves.toBeUndefined();
    expect(ops.pollPending).toHaveBeenCalledTimes(3);
    expect(raw.withLock.mock.calls[0][0]).toBe('scheduler:payments-status');
    // 12:00 UTC = 13:00 in Douala: yesterday is reconciled.
    expect(await s.reconciliationTick(new Date('2026-11-10T12:00:00Z'))).toBe('2026-11-09');
    expect(ops.reconcile).toHaveBeenCalledWith('2026-11-09');
    expect(await s.reconciliationTick(new Date('2026-11-10T12:00:00Z'))).toBeNull();
  });
});
