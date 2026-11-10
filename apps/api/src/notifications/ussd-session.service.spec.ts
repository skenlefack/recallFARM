import { DataSource } from 'typeorm';
import { PaymentOpsService } from '../billing/payment-ops.service';
import { PaymentsScheduler } from '../billing/payments.scheduler';
import { KvService } from '../common/kv.service';
import { reloadConfig } from '../config';
import { ussdOptions, UssdScreen } from '../connectors/ussd';
import { InboundService } from './inbound.service';
import { USSD_ALREADY_RECEIVED, USSD_BUSY, UssdSessionService } from './ussd-session.service';

/** In-memory stand-in for Redis (the "redis" backend of KvService). */
function fakeKv(backend: 'redis' | 'memory') {
  const store = new Map<string, string>();
  const held = new Set<string>();
  const kv = {
    backend,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    // Same contract as KvService.withLock: undefined when the lock is held elsewhere.
    withLock: jest.fn(async (k: string, _t: number, fn: () => Promise<unknown>) => {
      if (held.has(k)) return undefined;
      held.add(k);
      try {
        return await fn();
      } finally {
        held.delete(k);
      }
    }),
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

  it('runs the closing action once for concurrent identical hops, and replays it after the end (B1)', async () => {
    const { kv } = fakeKv('redis');
    let release: () => void = () => undefined;
    let gate = new Promise<void>((ok) => (release = ok));
    const acting = {
      ussdScreen: jest.fn(async (_s: string, _p: string, parts: string[]) => {
        if (parts.length < 3) return { text: `etape ${parts.length}`, end: false };
        await gate; // the action takes time: the aggregator retries meanwhile
        return { text: '5 mort(s) enregistre(s).', end: true };
      }),
    };
    const svc = new UssdSessionService({ query: jest.fn() } as unknown as DataSource, kv, acting as unknown as InboundService);
    for (const mode of ['last', 'cumulative'] as const) {
      acting.ussdScreen.mockClear();
      gate = new Promise<void>((ok) => (release = ok));
      const o = { ...ussdOptions(), text_mode: mode };
      const sid = `s-${mode}`;
      const inputs = mode === 'last' ? ['', '3', '1', '5'] : ['', '3', '3*1', '3*1*5'];
      for (const t of inputs.slice(0, 3)) await svc.hop('agg', sid, '+237690000001', t, o);
      const last = inputs[3];
      const both = Promise.all([svc.hop('agg', sid, '+237690000001', last, o), svc.hop('agg', sid, '+237690000001', last, o)]);
      await new Promise((ok) => setTimeout(ok, 120));
      release();
      const [a, b] = await both;
      expect(a).toEqual({ text: '5 mort(s) enregistre(s).', end: true });
      expect(b).toEqual(a);
      // Retry after the end: same closing screen, no new action.
      expect(await svc.hop('agg', sid, '+237690000001', last, o)).toEqual(a);
      expect(acting.ussdScreen.mock.calls.filter((c) => c[2].length === 3)).toHaveLength(1);
    }
  });

  it('never runs again a step interrupted between the action and the save', async () => {
    const { kv, store } = fakeKv('redis');
    const svc = new UssdSessionService({ query: jest.fn() } as unknown as DataSource, kv, inbound as unknown as InboundService);
    const key = 'ussd:agg:s9:+237690000001';
    store.set(key, JSON.stringify({ inputs: ['2'], raw: '2', pages: ['Entrez le code du rappel :'], page: 0, end: false, pending: ['2', '4821'] }));
    inbound.ussdScreen.mockClear();
    const r = await svc.hop('agg', 's9', '+237690000001', '4821', { ...ussdOptions(), text_mode: 'last' });
    expect(r).toEqual({ text: USSD_ALREADY_RECEIVED, end: true });
    expect(inbound.ussdScreen).not.toHaveBeenCalled();
  });

  it('answers "busy" without acting when the session lock cannot be taken', async () => {
    const { kv, raw } = fakeKv('redis');
    raw.withLock.mockResolvedValue(undefined);
    const svc = new UssdSessionService({ query: jest.fn() } as unknown as DataSource, kv, inbound as unknown as InboundService);
    inbound.ussdScreen.mockClear();
    const exclusive = (svc as unknown as { exclusive: (k: string, fn: () => Promise<unknown>, w: number) => Promise<unknown> }).exclusive.bind(svc);
    expect(await exclusive('k', async () => 1, 100)).toBeUndefined();
    expect(inbound.ussdScreen).not.toHaveBeenCalled();
    expect(USSD_BUSY).toMatch(/reessayez/);
  });

  it('serialises a session with a PostgreSQL advisory lock without Redis, and rolls back on error', async () => {
    const { kv } = fakeKv('memory');
    const qr = {
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(async () => void (qr.isTransactionActive = true)),
      query: jest.fn(),
      commitTransaction: jest.fn(async () => void (qr.isTransactionActive = false)),
      rollbackTransaction: jest.fn(async () => void (qr.isTransactionActive = false)),
      release: jest.fn(),
    };
    const rows = new Map<string, unknown>();
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT state')) return rows.has(params[0] as string) ? [{ state: rows.get(params[0] as string) }] : [];
      if (sql.includes('INSERT INTO ussd_sessions')) rows.set(params[0] as string, JSON.parse(params[1] as string));
      return [];
    });
    const ds = { query, createQueryRunner: () => qr } as unknown as DataSource;
    const svc = new UssdSessionService(ds, kv, inbound as unknown as InboundService);
    expect((await svc.hop('agg', 'p1', '+237690000001', '', ussdOptions())).text).toMatch(/^RecallFarm/);
    expect(qr.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(await svc.current('agg', 'p1', '+237690000001')).toMatchObject({ end: false });
    expect(await svc.current('agg', 'absent', '+237690000001')).toBeNull();
    const failing = new UssdSessionService(ds, kv, { ussdScreen: jest.fn().mockRejectedValue(new Error('db')) } as unknown as InboundService);
    await expect(failing.hop('agg', 'p2', '+237690000001', '', ussdOptions())).rejects.toThrow('db');
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalledTimes(4);
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
