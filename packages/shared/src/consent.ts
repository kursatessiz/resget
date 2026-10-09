import { z } from 'zod';
import { REGISTRY_CHANNELS } from './campaigns';
import type { RegistryChannel } from './campaigns';

/**
 * Commercial message consent, per channel (docs/RIZA.md). Every decision is
 * a row in the contact's consent history (append-only); the latest row of a
 * channel is its state. Whether a commercial message may go out is decided
 * here, purely, from that state, the recipient's region, the tenant's
 * policy and whether the contact is a business: the send path never names a
 * country. Opting out always wins.
 */

export const CONSENT_CHANNELS = REGISTRY_CHANNELS;
export type ConsentChannel = RegistryChannel;
export const ConsentChannelSchema = z.enum(CONSENT_CHANNELS);

/**
 * CONSENT: the person said yes (checkbox, form). TR_MERCHANT_EXEMPTION:
 * Turkish law lets commercial messages reach merchants and tradespeople
 * without prior consent (they can always refuse, and the address is
 * registered with IYS as a merchant); used only for business contacts, in
 * Turkey, on registry channels, when the platform owner turned it on.
 */
export const LEGAL_BASES = ['CONSENT', 'TR_MERCHANT_EXEMPTION'] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/** Where a decision came from; shown on the contact card. */
export const CONSENT_SOURCES = [
  'LEGACY',
  'ORDER_CHECKBOX',
  'SITE_FORM',
  'CONFIRMATION_LINK',
  'OPT_OUT_LINK',
  'STAFF_OPT_OUT',
  'MERCHANT_EXEMPTION',
  'ACCOUNT_DELETED',
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** The channels a customer can tick at checkout; e-mail and calls come with their own modules. */
export const CHECKOUT_CONSENT_CHANNELS = ['SMS', 'WHATSAPP'] as const satisfies readonly ConsentChannel[];
export type CheckoutConsentChannel = (typeof CHECKOUT_CONSENT_CHANNELS)[number];
/** The boxes ticked at checkout (consent v2); an empty list changes nothing, refusing is the opt-out link. */
export const MarketingChannelsSchema = z.array(z.enum(CHECKOUT_CONSENT_CHANNELS)).max(CHECKOUT_CONSENT_CHANNELS.length);
/** The single legacy checkbox read "by SMS or WhatsApp": it stands for both. */
export const LEGACY_CHECKBOX_CHANNELS: readonly ConsentChannel[] = CHECKOUT_CONSENT_CHANNELS;

/** The merchant exemption is registered with IYS, so it only covers the channels IYS keeps. */
export const MERCHANT_EXEMPTION_CHANNELS: readonly ConsentChannel[] = ['SMS', 'CALL', 'EMAIL'];

// -- Regions ---------------------------------------------------------------------------

export const CONSENT_REGIONS = ['EU_UK', 'TR', 'NANP', 'OTHER'] as const;
export type ConsentRegion = (typeof CONSENT_REGIONS)[number];

const EU_UK_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]); // prettier-ignore

export function consentRegionOf(countryCode: string | null | undefined): ConsentRegion {
  const code = countryCode?.toUpperCase();
  if (!code) return 'OTHER';
  if (code === 'TR') return 'TR';
  if (code === 'US' || code === 'CA') return 'NANP';
  return EU_UK_COUNTRIES.has(code) ? 'EU_UK' : 'OTHER';
}

/** Calling codes of the countries a region rule depends on; longest prefix wins. */
const CALLING_CODES: Readonly<Record<string, string>> = {
  '90': 'TR', '1': 'US', '44': 'GB', '41': 'CH', '49': 'DE', '33': 'FR', '39': 'IT', '34': 'ES', '31': 'NL',
  '32': 'BE', '43': 'AT', '45': 'DK', '46': 'SE', '47': 'NO', '48': 'PL', '30': 'GR', '36': 'HU', '40': 'RO',
  '351': 'PT', '352': 'LU', '353': 'IE', '354': 'IS', '356': 'MT', '357': 'CY', '358': 'FI', '359': 'BG',
  '370': 'LT', '371': 'LV', '372': 'EE', '385': 'HR', '386': 'SI', '420': 'CZ', '421': 'SK', '423': 'LI',
}; // prettier-ignore

/** The country of an E.164 number for the region rules, or null when the code is not one they depend on. */
export function countryOfPhone(e164: string): string | null {
  const digits = e164.replace(/^\+/, '');
  for (const length of [3, 2, 1]) {
    const country = CALLING_CODES[digits.slice(0, length)];
    if (country) return country;
  }
  return null;
}

// -- Policy ----------------------------------------------------------------------------

/** A tenant's commercial message policy; caps count campaign messages actually sent. */
export interface ConsentPolicy {
  dailyCap: number;
  weeklyCap: number;
  /**
   * Regions where even a verified number's new consent counts only after the
   * confirmation link; an unverified number always waits (docs/RIZA.md).
   */
  doubleOptInRegions: readonly ConsentRegion[];
  /** Platform owner's switch: business contacts in Turkey may get commercial messages on IYS channels. */
  merchantExemption: boolean;
}

export const DEFAULT_CONSENT_POLICY: ConsentPolicy = {
  dailyCap: 1,
  weeklyCap: 3,
  doubleOptInRegions: [],
  merchantExemption: false,
};

export const DAILY_CAP_MAX = 3;
export const WEEKLY_CAP_MAX = 10;

/** What a restaurant may set itself; stricter than the default is always fine. */
export const UpdateConsentLimitsSchema = z
  .object({
    dailyCap: z.number().int().min(1).max(DAILY_CAP_MAX),
    weeklyCap: z.number().int().min(1).max(WEEKLY_CAP_MAX),
  })
  .strict()
  .refine((v) => v.dailyCap <= v.weeklyCap, { message: 'Daily cap above weekly cap', path: ['dailyCap'] });
export type UpdateConsentLimitsInput = z.infer<typeof UpdateConsentLimitsSchema>;

/** What only the platform owner sets for a tenant. */
export const UpdateConsentPolicySchema = z
  .object({
    doubleOptInRegions: z.array(z.enum(CONSENT_REGIONS)).max(CONSENT_REGIONS.length),
    merchantExemption: z.boolean(),
  })
  .strict();
export type UpdateConsentPolicyInput = z.infer<typeof UpdateConsentPolicySchema>;

// -- Decision --------------------------------------------------------------------------

/** The latest decision on one channel. */
export interface ConsentState {
  granted: boolean;
  legalBasis: LegalBasis;
  confirmationRequestedAt: Date | null;
  confirmedAt: Date | null;
}

export type IneligibleReason = 'OPTED_OUT' | 'NO_CONSENT' | 'CONSENT_UNCONFIRMED' | 'EXEMPTION_DISABLED';

export type Eligibility = { eligible: true; basis: LegalBasis } | { eligible: false; reason: IneligibleReason };

export interface EligibilityInput {
  channel: ConsentChannel;
  region: ConsentRegion;
  state: ConsentState | null;
  isBusiness: boolean;
  policy: ConsentPolicy;
}

function exemptionApplies(input: EligibilityInput): boolean {
  return (
    input.isBusiness &&
    input.region === 'TR' &&
    input.policy.merchantExemption &&
    MERCHANT_EXEMPTION_CHANNELS.includes(input.channel)
  );
}

/**
 * Whether a commercial message may go to this contact on this channel.
 * A refusal always wins; a consent waiting for its confirmation link does
 * not count; without any decision only the merchant exemption can apply.
 */
export function evaluateCommercialEligibility(input: EligibilityInput): Eligibility {
  const { state } = input;
  if (state && !state.granted) return { eligible: false, reason: 'OPTED_OUT' };
  if (state?.legalBasis === 'CONSENT') {
    if (state.confirmationRequestedAt && !state.confirmedAt) return { eligible: false, reason: 'CONSENT_UNCONFIRMED' };
    return { eligible: true, basis: 'CONSENT' };
  }
  if (state?.legalBasis === 'TR_MERCHANT_EXEMPTION' && !exemptionApplies(input))
    return { eligible: false, reason: 'EXEMPTION_DISABLED' };
  if (exemptionApplies(input)) return { eligible: true, basis: 'TR_MERCHANT_EXEMPTION' };
  return { eligible: false, reason: 'NO_CONSENT' };
}

/** The channels a contact can be reached on right now; stored on the contact for audience queries. */
export function effectiveConsentChannels(
  states: Partial<Record<ConsentChannel, ConsentState>>,
  context: Omit<EligibilityInput, 'channel' | 'state'>,
): ConsentChannel[] {
  return CONSENT_CHANNELS.filter(
    (channel) => evaluateCommercialEligibility({ ...context, channel, state: states[channel] ?? null }).eligible,
  );
}

/**
 * Whether a fresh consent waits for its confirmation link (owner's decision,
 * docs/RIZA.md): a number nobody proved always does, in every region and
 * whether or not consent v2 is on; a number proved with a sign-in code does
 * only where the platform owner asked for it, and only with consent v2 on.
 */
export function needsDoubleOptIn(input: {
  region: ConsentRegion;
  policy: ConsentPolicy;
  phoneVerified: boolean;
  moduleEnabled: boolean;
}): boolean {
  if (!input.phoneVerified) return true;
  return input.moduleEnabled && input.policy.doubleOptInRegions.includes(input.region);
}

/** Whether another campaign message would exceed the tenant's caps for this contact. */
export function frequencyCapReached(sentLastDay: number, sentLastWeek: number, policy: ConsentPolicy): boolean {
  return sentLastDay >= policy.dailyCap || sentLastWeek >= policy.weeklyCap;
}

/** Confirmation links live a week and are single use. */
export const CONSENT_CONFIRMATION_DAYS = 7;
export const ConsentTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// -- Contact card ----------------------------------------------------------------------

export interface ConsentEntryDTO {
  channel: ConsentChannel;
  granted: boolean;
  legalBasis: LegalBasis;
  source: ConsentSource;
  note: string | null;
  formVersion: string | null;
  confirmationRequestedAt: string | null;
  confirmedAt: string | null;
  registrySyncedAt: string | null;
  createdAt: string;
}

export interface ContactConsentDTO {
  /** The consent v2 module is on: per-channel view, double opt-in, caps. */
  enabled: boolean;
  region: ConsentRegion;
  isBusiness: boolean;
  /** Channels a campaign can reach now. */
  effective: ConsentChannel[];
  /** Latest decision per channel. */
  current: ConsentEntryDTO[];
  /** Full history, newest first. */
  history: ConsentEntryDTO[];
}

/** Staff never grant consent; they record the customer's refusal, with a note on how it came. */
export const RecordOptOutSchema = z
  .object({
    channels: z.array(ConsentChannelSchema).min(1).max(CONSENT_CHANNELS.length),
    note: z.string().trim().min(3).max(500),
  })
  .strict();
export type RecordOptOutInput = z.infer<typeof RecordOptOutSchema>;

export const SetBusinessSchema = z.object({ isBusiness: z.boolean() }).strict();
export type SetBusinessInput = z.infer<typeof SetBusinessSchema>;

export interface ConsentSettingsDTO {
  enabled: boolean;
  policy: ConsentPolicy;
}

export type ConsentConfirmResultDTO = { status: 'CONFIRMED'; restaurantName: string } | { status: 'INVALID' };
