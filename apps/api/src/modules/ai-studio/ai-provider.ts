/** One drafting request as the provider sees it: instructions, the request text and how much to write. */
export interface AiProviderRequest {
  system: string;
  prompt: string;
  /** How many drafts to ask for. */
  drafts: number;
  maxOutputTokens: number;
}

export interface AiProviderDraft {
  /** Empty when the draft has no subject. */
  subject: string;
  body: string;
}

export interface AiProviderResult {
  drafts: AiProviderDraft[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The model declined to write this (a policy refusal); the caller reports it, it is not a failure to retry. */
export class AiRefusedError extends Error {
  constructor(readonly usage: { model: string; inputTokens: number; outputTokens: number }) {
    super('The model declined the request');
  }
}

/** A text generation service behind the AI studio (docs/YAPAY_ZEKA.md); MOCK for development and tests. */
export interface AiProvider {
  readonly name: 'MOCK' | 'ANTHROPIC';
  draft(request: AiProviderRequest): Promise<AiProviderResult>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
