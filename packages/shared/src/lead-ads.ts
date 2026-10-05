import { z } from 'zod';
import { normalizePhone } from './phone';

/**
 * Lead Ads (docs/LEAD_ADS.md, module lead_ads). A person fills a lead form
 * on a Facebook or Instagram ad; Meta calls the signed webhook with the
 * lead's id only, the API fetches the answers with the page's token and
 * turns them into a CRM contact. The answers go to the contact and its
 * activity; the lead row keeps ids and status only. No marketing consent is
 * granted from a lead form: Meta's form disclaimer is not the tenant's
 * consent record (docs/RIZA.md).
 */

export const META_LEAD_STATUSES = ['RECEIVED', 'IMPORTED', 'SKIPPED', 'FAILED'] as const;
export type MetaLeadStatus = (typeof META_LEAD_STATUSES)[number];

/** The `source` written on a contact made from a lead form. */
export const LEAD_ADS_SOURCE = 'meta_lead_ad';

/** Imports tried before a lead counts as failed; a person can retry it from the screen after that. */
export const LEAD_IMPORT_MAX_ATTEMPTS = 5;

/** Minutes until the next try after the given number of failed ones: 2, 4, 8, 16. */
export function leadRetryDelayMinutes(attempts: number): number {
  return 2 ** Math.min(Math.max(attempts, 1), 10);
}

export const LEAD_ADS_PAGE_SIZE = 50;

/** One answer of a lead form as Meta's Graph API returns it. */
export interface MetaLeadField {
  name: string;
  values: string[];
}

export interface MappedLead {
  fullName: string | null;
  /** E.164; null when the form had no phone or it is not a valid number. */
  phone: string | null;
  email: string | null;
  city: string | null;
  company: string | null;
  /** Every other answer (custom questions), in form order, as name and value. */
  answers: Array<[string, string]>;
}

const NAME_KEYS = new Set(['full_name', 'name']);
const PHONE_KEYS = new Set(['phone_number', 'phone']);
const EMAIL_KEYS = new Set(['email', 'work_email']);
const CITY_KEYS = new Set(['city']);
const COMPANY_KEYS = new Set(['company_name', 'company']);
const MAX_ANSWERS = 30;
const MAX_VALUE = 300;

const EMAIL = z.string().email().max(200);

/**
 * Meta's standard field names to contact fields. The phone is read with the
 * tenant's country as the default, so a local format still resolves; an
 * invalid one leaves the phone empty, and a lead without a phone cannot
 * become a contact (users are identified by phone).
 */
export function mapLeadFields(fields: readonly MetaLeadField[], countryCode: string): MappedLead {
  const out: MappedLead = { fullName: null, phone: null, email: null, city: null, company: null, answers: [] };
  let first: string | null = null;
  let last: string | null = null;
  for (const field of fields) {
    const key = field.name.trim().toLowerCase();
    const value = (field.values ?? [])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(', ')
      .slice(0, MAX_VALUE);
    if (!value) continue;
    if (NAME_KEYS.has(key)) out.fullName ??= value.slice(0, 120);
    else if (key === 'first_name') first = value;
    else if (key === 'last_name') last = value;
    else if (PHONE_KEYS.has(key)) out.phone ??= normalizePhone(value, countryCode);
    else if (EMAIL_KEYS.has(key))
      out.email ??= EMAIL.safeParse(value.toLowerCase()).success ? value.toLowerCase() : null;
    else if (CITY_KEYS.has(key)) out.city ??= value.slice(0, 80);
    else if (COMPANY_KEYS.has(key)) out.company ??= value.slice(0, 120);
    else if (out.answers.length < MAX_ANSWERS) out.answers.push([field.name.trim().slice(0, 100), value]);
  }
  if (!out.fullName && (first || last)) out.fullName = [first, last].filter(Boolean).join(' ').slice(0, 120);
  return out;
}

// -- Webhook ------------------------------------------------------------------------------------

/** Meta's page webhook as far as Lead Ads reads it; everything else in the delivery is ignored. */
export const MetaPageWebhookSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string().max(64),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.record(z.unknown()).optional(),
            }),
          )
          .max(100)
          .default([]),
      }),
    )
    .max(100)
    .default([]),
});
export type MetaPageWebhook = z.infer<typeof MetaPageWebhookSchema>;

const IdValue = z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(64));

export const MetaLeadgenValueSchema = z.object({
  leadgen_id: IdValue,
  page_id: IdValue,
  form_id: IdValue.optional(),
  ad_id: IdValue.optional(),
});

export interface LeadgenNotice {
  leadgenId: string;
  pageId: string;
  formId: string | null;
  adId: string | null;
}

/** The leadgen notices in a page webhook delivery; malformed changes are skipped. */
export function leadgenNotices(payload: MetaPageWebhook): LeadgenNotice[] {
  if (payload.object !== 'page') return [];
  const out: LeadgenNotice[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      const value = MetaLeadgenValueSchema.safeParse(change.value);
      if (!value.success) continue;
      out.push({
        leadgenId: value.data.leadgen_id,
        pageId: value.data.page_id,
        formId: value.data.form_id ?? null,
        adId: value.data.ad_id ?? null,
      });
    }
  }
  return out;
}

// -- Screens ------------------------------------------------------------------------------------

export const UpdateLeadAdsPageSchema = z.object({ enabled: z.boolean() }).strict();
export type UpdateLeadAdsPageInput = z.infer<typeof UpdateLeadAdsPageSchema>;

export const LeadAdsQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();
export type LeadAdsQuery = z.infer<typeof LeadAdsQuerySchema>;

export interface MetaLeadDTO {
  id: string;
  leadgenId: string;
  /** The connected page the lead came from; null after the page was disconnected. */
  pageName: string | null;
  formId: string | null;
  adId: string | null;
  status: MetaLeadStatus;
  attempts: number;
  /** Machine code of the last failure or skip, such as NO_PHONE; translated as leadAds.reason.<code>. */
  reason: string | null;
  receivedAt: string;
  importedAt: string | null;
  /** The CRM contact the lead became. */
  customerId: string | null;
  contactName: string | null;
}

export interface MetaLeadPageDTO {
  items: MetaLeadDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** Why a lead was skipped or failed. */
export const LEAD_REASONS = ['NO_PHONE', 'PAGE_UNAVAILABLE', 'GRAPH_ERROR', 'MODULE_OFF'] as const;
export type LeadReason = (typeof LEAD_REASONS)[number];
