import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsentService } from './consent.service';

const INTERVAL_MS = 10 * 60_000;

/** Retries consent decisions that have not reached the regional registry yet (docs/RIZA.md). Off in tests. */
@Injectable()
export class ConsentSyncWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsentSyncWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly consent: ConsentService,
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
      return await this.consent.syncPending();
    } catch (error) {
      this.logger.error(`consent registry sync failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
