import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';

const INTERVAL_MS = 10 * 60_000;

/**
 * Claim escalation sweep (docs/ODEME.md, "Eksik ürün bildirimi"): every ten
 * minutes, claims nobody decided within CLAIM_DECISION_HOURS move to the
 * platform console for restaurants whose claim_escalation module is on.
 * Off in tests and with ORDER_WATCHDOG=off, like the acceptance watchdog.
 */
@Injectable()
export class ClaimsWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimsWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly claims: ClaimsService,
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

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.claims.escalateDue(now);
    } catch (error) {
      this.logger.error(`claim escalation failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
