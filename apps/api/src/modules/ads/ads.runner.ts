import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdsService } from './ads.service';

const MINUTE_MS = 60_000;

/** Sends queued conversions and pulls spend once a minute (docs/REKLAM.md). Off in tests and with CAMPAIGN_RUNNER=off. */
@Injectable()
export class AdsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdsRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly ads: AdsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('CAMPAIGN_RUNNER') === 'off') return;
    this.timer = setInterval(() => void this.tick(), MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.ads.runPass(now);
    } catch (error) {
      this.logger.error(`ads pass failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
