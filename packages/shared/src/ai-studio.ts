import { z } from 'zod';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_EMAIL_BODY_MAX, CAMPAIGN_SUBJECT_MAX } from './campaigns';
import { LocaleCodeSchema } from './i18n/locales';

/**
 * AI studio (docs/YAPAY_ZEKA.md, module ai_studio). It only drafts: the
 * text comes back to the screen, a person edits it and saves or sends it
 * through the ordinary flow; nothing is sent or saved by the model. No
 * personal data goes to the model: the request carries tenant data (the
 * restaurant's name, a menu item) and the user's brief, from which phone
 * numbers, email addresses and card-like numbers are removed first. Usage
 * runs against a monthly token budget of its own, separate from message
 * credits.
 */

export const AI_DRAFT_KINDS = ['CAMPAIGN_MESSAGE', 'MENU_DESCRIPTION'] as const;
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number];

export const AI_TONES = ['FRIENDLY', 'FORMAL', 'PLAYFUL'] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_CAMPAIGN_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
export type AiCampaignChannel = (typeof AI_CAMPAIGN_CHANNELS)[number];

export const AI_MAX_VARIANTS = 3;
export const MENU_DESCRIPTION_MAX = 500;

/** Longest body a draft may have on each channel: the campaign rules, so a draft always fits the form. */
export const AI_BODY_LIMITS: Readonly<Record<AiCampaignChannel, number>> = {
  SMS: CAMPAIGN_BODY_MAX,
  WHATSAPP: CAMPAIGN_BODY_MAX,
  EMAIL: CAMPAIGN_EMAIL_BODY_MAX,
};

export const CampaignDraftRequestSchema = z
  .object({
    /** What the message should achieve, in the user's words. */
    brief: z.string().trim().min(5).max(500),
    channel: z.enum(AI_CAMPAIGN_CHANNELS),
    tone: z.enum(AI_TONES).default('FRIENDLY'),
    /** The language the draft is written in. */
    locale: LocaleCodeSchema,
    variants: z.number().int().min(1).max(AI_MAX_VARIANTS).default(2),
  })
  .strict();
export type CampaignDraftRequest = z.infer<typeof CampaignDraftRequestSchema>;

export const MenuDescriptionRequestSchema = z
  .object({
    itemName: z.string().trim().min(1).max(120),
    /** Ingredients, portion, how it is made: whatever the restaurant wants mentioned. */
    notes: z.string().trim().max(300).default(''),
    tone: z.enum(AI_TONES).default('FRIENDLY'),
    locale: LocaleCodeSchema,
  })
  .strict();
export type MenuDescriptionRequest = z.infer<typeof MenuDescriptionRequestSchema>;

export interface AiDraftDTO {
  /** Null except on an email campaign. */
  subject: string | null;
  body: string;
}

export interface AiBudgetDTO {
  monthlyTokenLimit: number;
  usedThisMonth: number;
  remaining: number;
  /** First moment of the current budget month, UTC. */
  periodStart: string;
}

export interface AiDraftResultDTO {
  kind: AiDraftKind;
  drafts: AiDraftDTO[];
  /** How many pieces of personal data were removed from the brief before it reached the model. */
  redactions: number;
  budget: AiBudgetDTO;
}

export const UpdateAiBudgetSchema = z.object({ monthlyTokenLimit: z.number().int().min(0).max(100_000_000) }).strict();
export type UpdateAiBudgetInput = z.infer<typeof UpdateAiBudgetSchema>;

// -- Personal data redaction ---------------------------------------------------------------

/** What stands in for removed personal data in the text the model sees. */
export const REDACTION_MARK = '[REDACTED]';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Runs of digits with optional spaces, dots, dashes, brackets or a leading plus: phones, cards, IBAN tails. */
const LONG_NUMBER = /\+?\d[\d\s().-]{8,}\d/g;
/** IBAN: two letters, two check digits, then 10 to 30 letters or digits, spaces allowed. */
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/g;

/**
 * Removes contact and payment identifiers from free text before it leaves
 * for the model. Names are not detected: the screen asks for a brief, not
 * for customer details, and says so.
 */
export function redactPersonalData(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const replace = (input: string, pattern: RegExp, minDigits = 0) =>
    input.replace(pattern, (match) => {
      if (minDigits > 0 && match.replace(/\D/g, '').length < minDigits) return match;
      redactions += 1;
      return REDACTION_MARK;
    });
  let out = replace(text, EMAIL);
  out = replace(out, IBAN);
  out = replace(out, LONG_NUMBER, 10);
  return { text: out, redactions };
}

/** The first moment of the UTC month that contains `now`. */
export function aiBudgetPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export { CAMPAIGN_SUBJECT_MAX as AI_SUBJECT_MAX };
