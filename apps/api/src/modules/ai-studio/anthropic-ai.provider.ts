import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { AiRefusedError } from './ai-provider';
import type { AiProvider, AiProviderRequest, AiProviderResult } from './ai-provider';

const DraftsSchema = z.object({
  drafts: z.array(z.object({ subject: z.string(), body: z.string() })),
});

/**
 * Claude through the official SDK: structured output so drafts come back as
 * JSON, low effort (short marketing copy), and the server-side refusal
 * fallback so a declined request is retried on another model inside the
 * same call. Only the system prompt and the redacted request leave here.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'ANTHROPIC' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    /** Tests hand in a fetch that answers without the network. */
    fetchImpl?: typeof fetch,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async draft(request: AiProviderRequest): Promise<AiProviderResult> {
    // create, not parse: a refusal must be recognised (and its tokens counted) before any JSON is read.
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: request.maxOutputTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: request.system,
      output_config: { effort: 'low', format: betaZodOutputFormat(DraftsSchema) },
      messages: [{ role: 'user', content: request.prompt }],
    });
    const usage = {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    if (response.stop_reason === 'refusal') throw new AiRefusedError(usage);
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    const parsed = DraftsSchema.safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`Unusable draft output (stop reason ${response.stop_reason ?? 'none'})`);
    return { drafts: parsed.data.drafts, ...usage };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
