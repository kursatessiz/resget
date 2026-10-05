import { z } from 'zod';

/**
 * Ordering links (docs/SIPARIS_BAGLANTILARI.md, module ordering_links): one
 * link to the restaurant's own ordering page per outside channel, to paste in
 * the Instagram profile, the WhatsApp Business greeting, the Google Business
 * Profile order link or the Facebook page button. The link carries the
 * channel in the `via` parameter; the page sends it with the order and the
 * order keeps it as its source, so the restaurant sees how many orders each
 * channel brings without any cookie or visitor tracking. The UTM tags on the
 * same link feed the separate attribution module (docs/ATIF.md) when it is on
 * and the visitor allowed measurement.
 *
 * The channels are a fixed catalogue because each needs its own placement
 * instructions; their names come from the i18n catalogue.
 */

export const ORDER_SOURCES = ['INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'GOOGLE', 'TIKTOK'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const OrderSourceSchema = z.enum(ORDER_SOURCES);

/** The query parameter that carries the channel on an ordering link. */
export const ORDER_SOURCE_PARAM = 'via';

/** How many days the panel counts orders per channel over. */
export const ORDERING_LINKS_WINDOW_DAYS = 30;

const UTM_MEDIUM: Record<OrderSource, string> = {
  INSTAGRAM: 'social',
  FACEBOOK: 'social',
  TIKTOK: 'social',
  WHATSAPP: 'messaging',
  GOOGLE: 'business_profile',
};

/** The channel a page was opened from, or null for a missing or unknown value. */
export function orderSourceFromParam(value: string | null | undefined): OrderSource | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return (ORDER_SOURCES as readonly string[]).includes(upper) ? (upper as OrderSource) : null;
}

/** The link for one channel: the ordering page with the channel and its UTM tags. */
export function orderingLink(baseUrl: string, source: OrderSource): string {
  const name = source.toLowerCase();
  const query = [
    [ORDER_SOURCE_PARAM, name],
    ['utm_source', name],
    ['utm_medium', UTM_MEDIUM[source]],
    ['utm_campaign', 'ordering_link'],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

export interface OrderingLinkDTO {
  source: OrderSource;
  url: string;
  /** Orders placed through this link in the window, cancelled and rejected ones left out. */
  orders: number;
  /** What those orders charged the customers, in the restaurant's currency. */
  revenueMinor: number;
}

export interface OrderingLinksDTO {
  /** The ordering page the links point to: the verified custom domain, else the platform address. */
  baseUrl: string;
  currency: string;
  windowDays: number;
  links: OrderingLinkDTO[];
  /** Orders on the ordering page in the same window that came without a channel. */
  otherOrders: number;
}
