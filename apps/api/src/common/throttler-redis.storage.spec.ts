import { ThrottlerRedisStorage } from './throttler-redis.storage';

describe('ThrottlerRedisStorage (in-memory fallback)', () => {
  let storage: ThrottlerRedisStorage;

  beforeEach(() => {
    // Empty URL => in-memory fallback (no real Redis needed for unit tests)
    storage = new ThrottlerRedisStorage('');
  });

  afterEach(async () => {
    await storage.onApplicationShutdown();
  });

  it('should report memory backend when no Redis URL', () => {
    expect(storage.backend).toBe('memory');
  });

  it('should increment and respect the limit', async () => {
    const ttl = 60_000;
    const limit = 3;
    const r1 = await storage.increment('test-key', ttl, limit, 0, 'default');
    expect(r1.totalHits).toBe(1);
    expect(r1.isBlocked).toBe(false);

    await storage.increment('test-key', ttl, limit, 0, 'default');
    await storage.increment('test-key', ttl, limit, 0, 'default');
    const r4 = await storage.increment('test-key', ttl, limit, 0, 'default');
    expect(r4.totalHits).toBe(4);
    // Over limit but no blockDuration => not blocked
    expect(r4.isBlocked).toBe(false);
  });

  it('should block when blockDuration is set and limit exceeded', async () => {
    const ttl = 60_000;
    const limit = 2;
    const blockDuration = 30_000;

    await storage.increment('block-key', ttl, limit, blockDuration, 'default');
    await storage.increment('block-key', ttl, limit, blockDuration, 'default');
    const r3 = await storage.increment('block-key', ttl, limit, blockDuration, 'default');
    expect(r3.totalHits).toBe(3);
    expect(r3.isBlocked).toBe(true);
    expect(r3.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('should reset counter after TTL window expires', async () => {
    const ttl = 50; // 50ms window
    const limit = 1;

    const r1 = await storage.increment('expire-key', ttl, limit, 0, 'default');
    expect(r1.totalHits).toBe(1);

    // Wait for the window to expire
    await new Promise((r) => setTimeout(r, 60));
    const r2 = await storage.increment('expire-key', ttl, limit, 0, 'default');
    expect(r2.totalHits).toBe(1); // reset
  });
});
