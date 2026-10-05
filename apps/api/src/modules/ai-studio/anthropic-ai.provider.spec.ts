import { AiRefusedError } from './ai-provider';
import { AnthropicAiProvider } from './anthropic-ai.provider';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers with the given Messages API response. */
function fakeFetch(reply: Record<string, unknown>, captured: Captured[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const message = (text: string, stopReason: string) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 45 },
});

const request = { system: 'rules', prompt: 'Task: write 2 drafts', drafts: 2, maxOutputTokens: 4000 };

describe('Anthropic AI provider', () => {
  it('asks for structured drafts at low effort with the default refusal fallback', async () => {
    const captured: Captured[] = [];
    const drafts = {
      drafts: [
        { subject: '', body: 'Bir' },
        { subject: '', body: 'Iki' },
      ],
    };
    const provider = new AnthropicAiProvider(
      'test-key',
      'claude-opus-5-5',
      fakeFetch(message(JSON.stringify(drafts), 'end_turn'), captured),
    );
    const result = await provider.draft(request);

    expect(result).toEqual({ drafts: drafts.drafts, model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 45 });
    expect(captured).toHaveLength(1);
    const sent = captured[0];
    expect(sent.url).toContain('/v1/messages');
    expect(sent.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(sent.headers.get('x-api-key')).toBe('test-key');
    expect(sent.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      fallbacks: 'default',
      system: 'rules',
      messages: [{ role: 'user', content: 'Task: write 2 drafts' }],
    });
    const outputConfig = sent.body.output_config as { effort: string; format: { type: string } };
    expect(outputConfig.effort).toBe('low');
    expect(outputConfig.format.type).toBe('json_schema');
  });

  it('reports a refusal with the tokens it cost', async () => {
    const provider = new AnthropicAiProvider('test-key', 'claude-opus-5-5', fakeFetch(message('', 'refusal'), []));
    await expect(provider.draft(request)).rejects.toBeInstanceOf(AiRefusedError);
    await provider.draft(request).catch((error: AiRefusedError) => {
      expect(error.usage).toEqual({ model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 45 });
    });
  });
});
