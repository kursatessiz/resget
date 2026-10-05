import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicAiProvider } from './anthropic-ai.provider';
import { AI_PROVIDER } from './ai-provider';
import type { AiProvider } from './ai-provider';
import { AdminAiBudgetsController, AiStudioController } from './ai-studio.controller';
import { AiStudioService } from './ai-studio.service';
import { MockAiProvider } from './mock-ai.provider';

/** AI studio (docs/YAPAY_ZEKA.md); AI_PROVIDER picks the adapter, NONE leaves it unconfigured. */
@Module({
  controllers: [AiStudioController, AdminAiBudgetsController],
  providers: [
    AiStudioService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AiProvider | null => {
        const provider = config.get<string>('AI_PROVIDER') ?? 'NONE';
        if (provider === 'MOCK') return new MockAiProvider();
        if (provider === 'ANTHROPIC') {
          return new AnthropicAiProvider(
            config.getOrThrow<string>('ANTHROPIC_API_KEY'),
            config.get<string>('AI_MODEL') ?? 'claude-opus-5-5',
          );
        }
        return null;
      },
    },
  ],
})
export class AiStudioModule {}
