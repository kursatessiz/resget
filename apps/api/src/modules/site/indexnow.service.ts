import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 10_000;
/** IndexNow accepts up to 10,000 addresses per request; changes here are a handful. */
const MAX_URLS = 100;

/**
 * Tells search engines a public page changed (docs/SEO.md). Only while
 * page_engine is on for the platform; NONE does nothing, MOCK records what
 * would be sent, LIVE posts to the shared IndexNow endpoint. A ping never
 * blocks or fails the change that caused it.
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);
  /** MOCK: every batch that would have been sent, newest last. */
  readonly submitted: string[][] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly features: FeatureFlagsService,
  ) {}

  /** Fire and forget: the caller carries on whatever happens here. */
  notify(paths: string[]): void {
    void this.submit(paths).catch((err: unknown) =>
      this.logger.warn(`IndexNow ping failed: ${err instanceof Error ? err.message : 'unknown error'}`),
    );
  }

  /** Sends the site paths as absolute addresses; resolves to the number sent. */
  async submit(paths: string[]): Promise<number> {
    const provider = this.config.get<string>('INDEXNOW_PROVIDER') ?? 'NONE';
    if (provider === 'NONE' || paths.length === 0) return 0;
    const platform = await this.prisma.restaurant.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!platform || !(await this.features.isEnabled('page_engine', platform.id))) return 0;
    const origin = new URL(this.config.getOrThrow<string>('PUBLIC_APP_URL'));
    const urls = [...new Set(paths)].slice(0, MAX_URLS).map((path) => new URL(path, origin).toString());
    if (provider === 'MOCK') {
      this.submitted.push(urls);
      return urls.length;
    }
    const key = this.config.getOrThrow<string>('INDEXNOW_KEY');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: origin.host,
        key,
        keyLocation: new URL(`/indexnow/${key}.txt`, origin).toString(),
        urlList: urls,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 and 202 are both success; 422 means the addresses do not match the host or key.
    if (!res.ok) throw new Error(`IndexNow answered ${res.status}`);
    return urls.length;
  }
}

/** Global so pages, posts and district launches can all ping. */
@Global()
@Module({ providers: [IndexNowService], exports: [IndexNowService] })
export class IndexNowModule {}
