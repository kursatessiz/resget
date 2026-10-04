import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JourneysService } from './journeys.service';

const MINUTE_MS = 60_000;

/** Drives the automated flows once a minute inside the API process (docs/AKISLAR.md). Off in tests and with CAMPAIGN_RUNNER=off. */
@Injectable()
export class JourneysRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JourneysRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly journeys: JourneysService,
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
      return await this.journeys.runPass(now);
    } catch (error) {
      this.logger.error(`flow pass failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
