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
    return { inputs: s.inputs.map(String), raw: s.raw, pages: s.pages.map(String), page: s.page, end: !!s.end };
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
   * Handles one hop of a session: reconstructs the inputs (cumulative or last-input mode), turns the
   * page on "Suite", replays the last screen on an identical retry (an action is never run twice),
   * and pages screens longer than `max_chars`. The state is kept until expiry, closed sessions included.
   */
  async hop(scope: string, sessionId: string, phone: string, text: string, o: UssdOptions): Promise<UssdScreen> {
    const key = `ussd:${scope}:${sessionId}:${phone}`;
    const step = readHop(text, await this.load(key), o);
    let next: UssdState;
    if (step.kind === 'evaluate') {
      const screen = await this.inbound.ussdScreen(sessionId, phone, step.inputs);
      next = { inputs: step.inputs, raw: step.raw, pages: paginate(screen.text, o), page: 0, end: screen.end };
    } else next = step.state;
    await this.save(key, next, o.session_ttl_s);
    return currentPage(next);
  }
}
