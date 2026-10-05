import type { AiProvider, AiProviderRequest, AiProviderResult } from './ai-provider';

/**
 * Fixed drafts for development and tests: no network, no cost. It keeps the
 * requests it saw so tests can check what would have left for the model.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'MOCK' as const;
  readonly seen: AiProviderRequest[] = [];

  async draft(request: AiProviderRequest): Promise<AiProviderResult> {
    this.seen.push(request);
    const drafts = Array.from({ length: request.drafts }, (_, i) => ({
      subject: request.prompt.includes('Channel: EMAIL') ? `Taslak konu ${i + 1}` : '',
      body: `Taslak ${i + 1}: bu metin deneme amaçlı üretildi.`,
    }));
    return {
      drafts,
      model: 'mock',
      inputTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
      outputTokens: drafts.reduce((n, d) => n + Math.ceil((d.subject.length + d.body.length) / 4), 0),
    };
  }
}
