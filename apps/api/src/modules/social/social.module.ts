import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicRateLimitGuard } from '../storefront/public-rate-limit.guard';
import { LiveMetaGraph, META_GRAPH, MockMetaGraph } from './meta-graph';
import type { MetaGraph } from './meta-graph';
import { OAuthCallbackController, SocialController } from './social.controller';
import { SocialService } from './social.service';

/** Integration hub (docs/ENTEGRASYON_MERKEZI.md); global so Lead Ads and publishing reach the connected accounts. */
@Global()
@Module({
  controllers: [SocialController, OAuthCallbackController],
  providers: [
    SocialService,
    PublicRateLimitGuard,
    {
      provide: META_GRAPH,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MetaGraph | null => {
        const provider = config.get<string>('META_PROVIDER') ?? 'NONE';
        if (provider === 'MOCK') return new MockMetaGraph();
        if (provider === 'LIVE') {
          return new LiveMetaGraph(
            config.getOrThrow<string>('META_APP_ID'),
            config.getOrThrow<string>('META_APP_SECRET'),
            config.get<string>('META_GRAPH_VERSION') ?? 'v21.0',
          );
        }
        return null;
      },
    },
  ],
  exports: [SocialService, META_GRAPH],
})
export class SocialModule {}
