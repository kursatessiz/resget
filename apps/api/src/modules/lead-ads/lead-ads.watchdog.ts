import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadAdsService } from './lead-ads.service';

const INTERVAL_MS = 2 * 60_000;

/**
 * Retries Lead Ads imports whose Graph read failed (docs/LEAD_ADS.md). Each
 * import leases its lead, so a second instance running the sweep never
 * imports one twice. Off in tests.
 */
@Injectable()
export class LeadAdsWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadAdsWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly leads: LeadAdsService,
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
      return await this.leads.sweep(new Date());
    } catch (error) {
      this.logger.error(`lead sweep failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
