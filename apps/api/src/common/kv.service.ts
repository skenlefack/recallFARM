import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

/**
 * Small key-value facade used for distributed locks and rate limits.
 * Uses Redis when REDIS_URL is set, otherwise an in-process memory fallback (single instance only).
 */
@Injectable()
export class KvService implements OnModuleDestroy {
  private readonly logger = new Logger('Kv');
  private redis: Redis | null = null;
  private readonly mem = new Map<string, { v: string; exp: number }>();

  constructor() {
    const url = config().redisUrl;
    if (url && !config().openapiExport) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: true });
      this.redis.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
    }
  }

  get backend(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  private memGet(key: string): string | null {
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return e.v;
  }

  /** SET key value NX PX ttl — returns true when acquired. */
  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.redis) return (await this.redis.set(key, value, 'PX', ttlMs, 'NX')) === 'OK';
    if (this.memGet(key) !== null) return false;
    this.mem.set(key, { v: value, exp: Date.now() + ttlMs });
    return true;
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    return this.memGet(key);
  }

  /** SET key value PX ttl (overwrites). */
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.redis) await this.redis.set(key, value, 'PX', ttlMs);
    else this.mem.set(key, { v: value, exp: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    if (this.redis) await this.redis.del(key);
    else this.mem.delete(key);
  }

  /** Fixed-window counter. Returns the count after increment and the remaining window in ms. */
  async hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    if (this.redis) {
      const res = await this.redis.multi().incr(key).pttl(key).exec();
      const count = Number(res?.[0]?.[1] ?? 1);
      let ttl = Number(res?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await this.redis.pexpire(key, windowMs);
        ttl = windowMs;
      }
      return { count, ttlMs: ttl };
    }
    const now = Date.now();
    const e = this.mem.get(key);
    if (!e || e.exp < now) {
      this.mem.set(key, { v: '1', exp: now + windowMs });
      return { count: 1, ttlMs: windowMs };
    }
    const count = Number(e.v) + 1;
    e.v = String(count);
    return { count, ttlMs: e.exp - now };
  }

  /** Lock helper: runs fn only if the lock was acquired. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = `${process.pid}-${Math.random()}`;
    if (!(await this.setNx(`lock:${key}`, token, ttlMs))) return undefined;
    try {
      return await fn();
    } finally {
      await this.del(`lock:${key}`);
    }
  }

  async ping(): Promise<'ok' | 'down' | 'disabled'> {
    if (!this.redis) return 'disabled';
    try {
      return (await this.redis.ping()) === 'PONG' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) this.redis.disconnect();
  }
}
