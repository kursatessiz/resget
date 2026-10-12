import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Fixed-window counters shared by the public rate limit guard and the API
 * key limit. Counts in Redis when it is configured so every API instance
 * shares the window; otherwise in process memory.
 */
@Injectable()
export class RateLimiterService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  /** Increments the counter for the key and returns the new count within the window. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, windowSeconds);
        return count;
      } catch {
        // Redis unavailable: fall through to the in-memory window rather than refusing every request.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (this.memory.size > 10_000) this.sweep(now);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  /** The current count in the window without counting a hit; 0 when the key has no live window. */
  async count(key: string): Promise<number> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        return Number((await client.get(key)) ?? 0);
      } catch {
        // Redis unavailable: read the in-memory window instead.
      }
    }
    const entry = this.memory.get(key);
    return entry && entry.resetAt > Date.now() ? entry.count : 0;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
  }
}
