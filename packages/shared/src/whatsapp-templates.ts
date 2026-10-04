import { BASE_LOCALE } from './i18n';
import type { MessageParams, Translate } from './i18n/translator';
import type { MessageTemplateKey } from './messaging';

/**
 * WhatsApp message templates (docs/MESAJLASMA.md, "WhatsApp şablonları").
 * Outside the 24-hour service window the WhatsApp Business Platform only
 * delivers business-initiated messages through templates approved in the
 * business's WhatsApp account, so every order, invoice and campaign message
 * goes out as a template. Each entry names the template and lists the
 * message params in the order of the template's {{1}}, {{2}}... variables;
 * the text itself is registered in Meta Business Manager per language and
 * mirrors `messaging.template.<key>`. A key without an entry is one of the
 * SMS-only platform messages (SMS_ONLY_TEMPLATE_KEYS: the OTP code and the
 * consent confirmation link).
 */

/** Computed variable: reason, refund note and free note joined, since Meta refuses an empty or adjacent variable. */
export const WHATSAPP_DETAILS_PARAM = 'details';

/** Meta refuses a parameter longer than this. */
export const WHATSAPP_PARAM_MAX_CHARS = 1024;

export interface WhatsAppTemplateSpec {
  /** The template's name in the WhatsApp account. */
  name: string;
  /** Meta's template category; marketing templates follow the commercial-message rules. */
  category: 'UTILITY' | 'MARKETING';
  /** Message params in variable order; "details" is computed (WHATSAPP_DETAILS_PARAM). */
  params: readonly string[];
  /** Message key shown in place of empty details. */
  detailsFallbackKey?: string;
}

export const WHATSAPP_TEMPLATES: Partial<Record<MessageTemplateKey, WhatsAppTemplateSpec>> = {
  'staff.invite': { name: 'resget_staff_invite', category: 'UTILITY', params: ['restaurant', 'role', 'hours', 'url'] },
  'order.accepted': {
    name: 'resget_order_accepted',
    category: 'UTILITY',
    params: ['restaurant', 'code', 'minutes', 'url'],
  },
  'order.readyForPickup': {
    name: 'resget_order_ready_for_pickup',
    category: 'UTILITY',
    params: ['restaurant', 'code'],
  },
  'order.outForDelivery': { name: 'resget_order_out_for_delivery', category: 'UTILITY', params: ['restaurant', 'url'] },
  'order.rejected': {
    name: 'resget_order_rejected',
    category: 'UTILITY',
    params: ['restaurant', 'code', WHATSAPP_DETAILS_PARAM],
    detailsFallbackKey: 'messaging.whatsapp.details.order',
  },
  'order.cancelled': {
    name: 'resget_order_cancelled',
    category: 'UTILITY',
    params: ['restaurant', 'code', WHATSAPP_DETAILS_PARAM],
    detailsFallbackKey: 'messaging.whatsapp.details.order',
  },
  'order.refunded': { name: 'resget_order_refunded', category: 'UTILITY', params: ['restaurant', 'code'] },
  'order.partiallyRefunded': {
    name: 'resget_order_partially_refunded',
    category: 'UTILITY',
    params: ['restaurant', 'code', 'amount'],
  },
  'order.claimDeclined': {
    name: 'resget_order_claim_declined',
    category: 'UTILITY',
    params: ['restaurant', 'code', WHATSAPP_DETAILS_PARAM],
    detailsFallbackKey: 'messaging.whatsapp.details.order',
  },
  'order.acceptOverdue': {
    name: 'resget_order_accept_overdue',
    category: 'UTILITY',
    params: ['restaurant', 'code', 'minutes'],
  },
  'invoice.issued': {
    name: 'resget_invoice_issued',
    category: 'UTILITY',
    params: ['restaurant', 'period', 'amount', 'due'],
  },
  'invoice.overdue': {
    name: 'resget_invoice_overdue',
    category: 'UTILITY',
    params: ['restaurant', 'period', 'amount'],
  },
  'listing.approved': {
    name: 'resget_listing_approved',
    category: 'UTILITY',
    params: ['restaurant', WHATSAPP_DETAILS_PARAM],
    detailsFallbackKey: 'messaging.whatsapp.details.listing',
  },
  'listing.declined': {
    name: 'resget_listing_declined',
    category: 'UTILITY',
    params: ['restaurant', WHATSAPP_DETAILS_PARAM],
    detailsFallbackKey: 'messaging.whatsapp.details.listing',
  },
  'campaign.body': { name: 'resget_campaign', category: 'MARKETING', params: ['restaurant', 'body', 'url'] },
};

/** What a provider sends for a template message. */
export interface WhatsAppTemplateMessage {
  name: string;
  /** The template language registered in the account: the base language of the recipient's locale. */
  language: string;
  params: string[];
}

/** Meta registers a template per language; regional variants share the base language here. */
export function whatsappLanguageFor(locale: string): string {
  const base = locale.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return base.length > 0 ? base : BASE_LOCALE;
}

/** One line, no tabs or runs of spaces, within Meta's length limit. */
function cleanParam(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, WHATSAPP_PARAM_MAX_CHARS);
}

/** The template message for a message key, or null when the key goes out as plain text. */
export function whatsappTemplateFor(
  key: MessageTemplateKey,
  params: MessageParams | undefined,
  locale: string,
  t: Translate,
): WhatsAppTemplateMessage | null {
  const spec = WHATSAPP_TEMPLATES[key];
  if (!spec) return null;
  const values = params ?? {};
  const read = (name: string) => cleanParam(String(values[name] ?? ''));
  return {
    name: spec.name,
    language: whatsappLanguageFor(locale),
    params: spec.params.map((name) => {
      if (name !== WHATSAPP_DETAILS_PARAM) return read(name) || '-';
      const details = cleanParam([read('reason'), read('refund'), read('note')].join(' '));
      return details || (spec.detailsFallbackKey ? cleanParam(t(spec.detailsFallbackKey)) : '-');
    }),
  };
}
