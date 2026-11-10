import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/**
 * Redis-backed ThrottlerStorage.
 * When no Redis URL is provided, falls back to the default in-memory behaviour
 * by delegating to the built-in ThrottlerStorageService.
 */
@Injectable()
export class ThrottlerRedisStorage implements ThrottlerStorage, OnApplicationShutdown {
  private redis: Redis | null;

  constructor(redisUrl: string) {
    this.redis = redisUrl
      ? new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: true })
      : null;
  }

  get backend(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  /**
   * Atomically increments a hit counter in Redis.
   * Uses MULTI/EXEC to set an expiry on first write and retrieve the current count + TTL.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      // Fallback in-memory (single-node dev/test): mimics the contract.
      return this.memIncrement(key, ttl, limit, blockDuration);
    }

    const blockKey = `${key}:blocked`;

    // Check if currently blocked.
    const blocked = await this.redis.get(blockKey);
    if (blocked) {
      const blockTtl = await this.redis.pttl(blockKey);
      return { totalHits: limit + 1, timeToExpire: 0, isBlocked: true, timeToBlockExpire: Math.max(blockTtl, 0) };
    }

    const results = await this.redis.multi().incr(key).pttl(key).exec();
    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let pttl = Number(results?.[1]?.[1] ?? -1);
    // ttl parameter from @nestjs/throttler v6 is in milliseconds.
    if (pttl < 0) {
      await this.redis.pexpire(key, ttl);
      pttl = ttl;
    }

    if (totalHits > limit && blockDuration > 0) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      return { totalHits, timeToExpire: pttl, isBlocked: true, timeToBlockExpire: blockDuration };
    }

    return { totalHits, timeToExpire: Math.max(pttl, 0), isBlocked: false, timeToBlockExpire: 0 };
  }

  // ---- in-memory fallback (single instance, same as NestJS default) ----
  private mem = new Map<string, { count: number; exp: number; blockedUntil?: number }>();

  private memIncrement(key: string, ttl: number, limit: number, blockDuration: number): ThrottlerStorageRecord {
    const now = Date.now();
    let entry = this.mem.get(key);
    if (!entry || entry.exp < now) {
      entry = { count: 0, exp: now + ttl };
      this.mem.set(key, entry);
    }
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { totalHits: entry.count, timeToExpire: entry.exp - now, isBlocked: true, timeToBlockExpire: entry.blockedUntil - now };
    }
    entry.count++;
    if (entry.count > limit && blockDuration > 0) {
      entry.blockedUntil = now + blockDuration;
      return { totalHits: entry.count, timeToExpire: entry.exp - now, isBlocked: true, timeToBlockExpire: blockDuration };
    }
    return { totalHits: entry.count, timeToExpire: entry.exp - now, isBlocked: false, timeToBlockExpire: 0 };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) this.redis.disconnect();
  }
}
