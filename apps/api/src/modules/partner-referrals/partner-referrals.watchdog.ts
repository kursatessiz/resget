import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerReferralsService } from './partner-referrals.service';

const INTERVAL_MS = 10 * 60_000;

/**
 * Settles partner referrals the order completion could not settle right away (the referrer's lock was busy, or
 * the process stopped between the order commit and the reward), docs/RESTORAN_TAVSIYE.md. Off in tests.
 */
@Injectable()
export class PartnerReferralsWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerReferralsWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly partnerReferrals: PartnerReferralsService,
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
      return await this.partnerReferrals.settlePending();
    } catch (error) {
      this.logger.error(`partner referral sweep failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
