import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosService } from './pos.service';

const MINUTE_MS = 60_000;

/** Retries POS pushes that failed, once a minute with backoff per order (docs/POS_ENTEGRASYONU.md). Off in tests. */
@Injectable()
export class PosWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly pos: PosService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('ORDER_WATCHDOG') === 'off') return;
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
      return await this.pos.retryDue(now);
    } catch (error) {
      this.logger.error(`POS retry failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
