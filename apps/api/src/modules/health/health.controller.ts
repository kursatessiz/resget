import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type ComponentStatus = 'ok' | 'error' | 'not_configured';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Public; only coarse status is returned. Error details stay in the logs. The deploy smoke test calls this. */
  @Get(['health', 'api/health'])
  async check(@Res() res: Response): Promise<void> {
    const dbStart = Date.now();
    let database: ComponentStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      database = 'error';
      this.logger.error(`Database health check failed: ${(err as Error).message}`);
    }
    const dbLatencyMs = Date.now() - dbStart;

    let redis: ComponentStatus = 'not_configured';
    if (this.redis.isConfigured) {
      redis = (await this.redis.ping()) ? 'ok' : 'error';
      if (redis === 'error') this.logger.error('Redis health check failed');
    }

    const isHealthy = database === 'ok' && redis !== 'error';
    res.status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: isHealthy ? 'ok' : 'degraded',
      release: this.config.get<string>('APP_RELEASE', 'dev'),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: { status: database, latencyMs: dbLatencyMs },
      redis: { status: redis },
    });
  }
}
