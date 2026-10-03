import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { BillingService } from './billing.service';

const HOUR_MS = 3_600_000;

/**
 * Runs the billing job once per UTC day from inside the API process. A Redis
 * lock keyed by the date keeps a second instance from running it twice; with
 * no Redis (development) a per-process marker does. The job itself is
 * idempotent, so a duplicate run would cost queries, not money. Disabled in
 * tests and with BILLING_SCHEDULER=off (the CLI `dist/cli/billing.js` then
 * runs it from cron).
 */
@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private lastRunDate: string | null = null;
  private running = false;

  constructor(
    private readonly billing: BillingService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('BILLING_SCHEDULER') === 'off')
      return;
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
    this.timer.unref();
    this.firstRun = setTimeout(() => void this.tick(), 2 * 60_000);
    this.firstRun.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    const date = now.toISOString().slice(0, 10);
    if (!(await this.acquire(date))) return;
    this.running = true;
    try {
      const report = await this.billing.runDaily(now);
      this.logger.log(`billing run ${date}: ${JSON.stringify(report)}`);
    } catch (error) {
      this.logger.error(`billing run ${date} failed: ${error instanceof Error ? error.message : 'error'}`);
    } finally {
      this.running = false;
    }
  }

  private async acquire(date: string): Promise<boolean> {
    const client = this.redis.getClient();
    if (client) {
      try {
        if (client.status === 'wait') await client.connect();
        return (await client.set(`billing:run:${date}`, '1', 'EX', 36 * 3600, 'NX')) === 'OK';
      } catch (error) {
        this.logger.warn(
          `billing lock unavailable, using the process marker: ${error instanceof Error ? error.message : 'error'}`,
        );
      }
    }
    if (this.lastRunDate === date) return false;
    this.lastRunDate = date;
    return true;
  }
}
