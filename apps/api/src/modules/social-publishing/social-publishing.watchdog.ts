import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPublishingService } from './social-publishing.service';

const INTERVAL_MS = 60_000;

/**
 * Publishes scheduled posts when their time comes and retries failed
 * accounts (docs/SOSYAL_YAYIN.md). Each run leases its post, so a second
 * instance never publishes one twice. Off in tests.
 */
@Injectable()
export class SocialPublishingWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialPublishingWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly posts: SocialPublishingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('ORDER_WATCHDOG') === 'off') return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.posts.sweep(new Date());
    } catch (error) {
      this.logger.error(`social publish sweep failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
