import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { KvService } from '../common/kv.service';
import { config } from '../config';
import { currentPage, paginate, readHop, UssdOptions, UssdScreen, UssdState } from '../connectors/ussd';
import { InboundService } from './inbound.service';

/**
 * USSD session state kept on our side (M5): Redis when REDIS_URL is set, otherwise the
 * ussd_sessions table (several API instances share it). Entries expire after `session_ttl_s`.
 */
@Injectable()
export class UssdSessionService {
  private readonly logger = new Logger('UssdSessions');

  constructor(
    private readonly ds: DataSource,
    private readonly kv: KvService,
    private readonly inbound: InboundService,
  ) {}

  get backend(): 'redis' | 'postgres' {
    return this.kv.backend === 'redis' ? 'redis' : 'postgres';
  }

  private parse(raw: unknown): UssdState | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Partial<UssdState>;
    if (!Array.isArray(s.inputs) || !Array.isArray(s.pages) || typeof s.page !== 'number' || typeof s.raw !== 'string') return null;
    return {
      inputs: s.inputs.map(String),
      raw: s.raw,
      pages: s.pages.map(String),
      page: s.page,
      end: !!s.end,
      ...(Array.isArray(s.pending) ? { pending: s.pending.map(String) } : {}),
    };
  }

  async load(key: string): Promise<UssdState | null> {
    if (this.backend === 'redis') {
      const v = await this.kv.get(key);
      return v ? this.parse(JSON.parse(v)) : null;
    }
    const rows: Array<{ state: unknown }> = await this.ds.query(`SELECT state FROM ussd_sessions WHERE id = $1 AND expires_at > now()`, [key]);
    return rows[0] ? this.parse(rows[0].state) : null;
  }

  async save(key: string, state: UssdState, ttlS: number): Promise<void> {
    if (this.backend === 'redis') return this.kv.set(key, JSON.stringify(state), ttlS * 1000);
    await this.ds.query(
      `INSERT INTO ussd_sessions (id, state, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(state), ttlS],
    );
  }

  /** Removes expired sessions from the table (Redis expires them itself). Returns the rows removed. */
  async purge(): Promise<number> {
    if (this.backend === 'redis') return 0;
    const res: [unknown[], number] = await this.ds.query(`DELETE FROM ussd_sessions WHERE expires_at <= now()`);
    return res[1] ?? 0;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'ussd-sessions-purge' })
  async purgeTick(): Promise<void> {
    if (!config().schedulerEnabled) return;
    try {
      await this.purge();
    } catch (e) {
      this.logger.warn(`purge des sessions USSD impossible : ${(e as Error).message}`);
    }
  }

  /**
   * Runs `fn` alone for this session key: concurrent hops of one session (aggregator retry after its
   * timeout, frequent in 2G) are serialised. PostgreSQL: transaction-scoped advisory lock. Redis:
   * SET NX lock, waited for at most `waitMs`. Returns undefined when the Redis lock cannot be taken.
   */
  private async exclusive<T>(key: string, fn: () => Promise<T>, waitMs = 10_000): Promise<T | undefined> {
    if (this.backend === 'postgres') {
      const qr = this.ds.createQueryRunner();
      await qr.connect();
      try {
        await qr.startTransaction();
        await qr.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
        const out = await fn();
        await qr.commitTransaction();
        return out;
      } catch (e) {
        if (qr.isTransactionActive) await qr.rollbackTransaction();
        throw e;
      } finally {
        await qr.release();
      }
    }
    const deadline = Date.now() + waitMs;
    for (;;) {
      const r = await this.kv.withLock(`ussd:${key}`, 30_000, async () => ({ value: await fn() }));
      if (r) return r.value;
      if (Date.now() > deadline) return undefined;
      await new Promise((ok) => setTimeout(ok, 50));
    }
  }

  /**
   * Handles one hop of a session, alone for its session (lock): reconstructs the inputs (cumulative or
   * last-input mode), turns the page on "Suite", replays the stored screen on an identical retry or after
   * the closing screen, and pages screens longer than `max_chars`. The inputs being evaluated are stored
   * first: if the process stops between the action and the save, the retry does not run the action again (B1).
   */
  async hop(scope: string, sessionId: string, phone: string, text: string, o: UssdOptions): Promise<UssdScreen> {
    const key = `ussd:${scope}:${sessionId}:${phone}`;
    const out = await this.exclusive(key, async () => {
      const state = await this.load(key);
      const step = readHop(text, state, o);
      let next: UssdState;
      if (step.kind !== 'evaluate') next = step.state;
      else if (state?.pending && state.pending.join('\u0001') === step.inputs.join('\u0001')) {
        // Same step interrupted before: outcome unknown, never run twice.
        next = { inputs: step.inputs, raw: step.raw, pages: [USSD_ALREADY_RECEIVED], page: 0, end: true };
      } else {
        const before: UssdState = state ?? { inputs: [], raw: '', pages: [], page: 0, end: false };
        await this.save(key, { ...before, pending: step.inputs }, o.session_ttl_s);
        const screen = await this.inbound.ussdScreen(sessionId, phone, step.inputs);
        // GSM-7 has no typographic apostrophe: one would switch the screen to UCS-2 (fewer characters, m9).
        const text = screen.text.replace(/[\u2018\u2019]/g, "'");
        next = { inputs: step.inputs, raw: step.raw, pages: paginate(text, o), page: 0, end: screen.end };
      }
      await this.save(key, next, o.session_ttl_s);
      return currentPage(next);
    });
    // Lock held too long by another hop of the same session: answer without acting.
    return out ?? { text: USSD_BUSY, end: true };
  }

  /** Screen currently stored for a session (used to answer a replayed signed call), or null. */
  async current(scope: string, sessionId: string, phone: string): Promise<UssdScreen | null> {
    const key = `ussd:${scope}:${sessionId}:${phone}`;
    const state = (await this.exclusive(key, () => this.load(key))) ?? null;
    return state ? currentPage(state) : null;
  }
}

export const USSD_ALREADY_RECEIVED = "Saisie deja recue. Verifiez dans l'application.";
export const USSD_BUSY = 'Demande en cours, reessayez dans un instant.';
