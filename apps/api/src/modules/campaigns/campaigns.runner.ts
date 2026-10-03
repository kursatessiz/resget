import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignsService } from './campaigns.service';

const MINUTE_MS = 60_000;

/** Drives the campaign queue once a minute inside the API process (docs/KAMPANYALAR.md). Off in tests. */
@Injectable()
export class CampaignsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly campaigns: CampaignsService,
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
      return await this.campaigns.runPass(now);
    } catch (error) {
      this.logger.error(`campaign pass failed: ${error instanceof Error ? error.message : 'error'}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
