import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';

const INTERVAL_MS = 30_000;
/** Old sent and failed deliveries are purged at most this often; the retention period is days, an hour is enough. */
const PURGE_INTERVAL_MS = 3_600_000;

/**
 * Drains due webhook deliveries every half minute inside the API process and purges deliveries past their retention
 * period (docs/API_ERISIMI.md). Off in tests, where tick() is called directly.
 */
@Injectable()
export class WebhooksRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPurgeAt: number | null = null;

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('WEBHOOK_RUNNER') === 'off') return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      if (this.lastPurgeAt === null || now.getTime() - this.lastPurgeAt >= PURGE_INTERVAL_MS) {
        this.lastPurgeAt = now.getTime();
        await this.webhooks.purgeExpired(now);
      }
      return await this.webhooks.runPass(now);
    } catch (error) {
      this.logger.error(`webhook pass failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
