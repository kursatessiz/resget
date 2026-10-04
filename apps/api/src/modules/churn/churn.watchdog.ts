import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChurnService } from './churn.service';

const FIRST_RUN_MS = 5 * 60_000;
const INTERVAL_MS = 6 * 3_600_000;

/**
 * Moves stored customer churn classes along as quiet days pass
 * (docs/KAYIP_RISKI.md), so segments see current classes. The sweep is
 * idempotent, a second instance running it costs queries only. Off in tests.
 */
@Injectable()
export class ChurnSweepWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChurnSweepWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly churn: ChurnService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('ORDER_WATCHDOG') === 'off') return;
    this.firstRun = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.firstRun.unref();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.churn.sweep(new Date());
    } catch (error) {
      this.logger.error(`churn sweep failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
