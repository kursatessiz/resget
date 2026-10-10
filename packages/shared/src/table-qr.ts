import { z } from 'zod';
import { QrScanOutcome } from './enums';

/**
 * Table QR (docs/MASA_QR.md): the sticker on the table is the acquisition
 * channel. A scan opens the restaurant's menu as a web page at /m/<token>,
 * with no app install; from there the guest can order to the table, and the
 * same page offers delivery from this restaurant next time and a one-tap
 * phone registration. Every scan is a funnel event keyed by an anonymous
 * session so the conversion of the channel is measurable per restaurant.
 */

/** URL-safe token printed in the QR: 16 random bytes, base64url, 22 characters. */
export const TABLE_QR_TOKEN_BYTES = 16;
export const TableQrTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,32}$/, 'invalid table token');
export type TableQrToken = z.infer<typeof TableQrTokenSchema>;

export function tableQrPath(token: TableQrToken): string {
  return `/m/${token}`;
}

export function tableQrUrl(publicAppUrl: string, token: TableQrToken): string {
  return `${stripTrailingSlashes(publicAppUrl)}${tableQrPath(token)}`;
}

export const QrScanSessionSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export interface QrScanEventLike {
  sessionId: string;
  /** String form so Prisma rows pass without a cast. */
  outcome: `${QrScanOutcome}`;
}

export interface QrFunnel {
  sessions: number;
  viewedMenu: number;
  startedOrder: number;
  placedOrder: number;
  registered: number;
  /** placedOrder / viewedMenu, 0 when nothing was viewed. */
  viewToOrderRate: number;
  /** registered / viewedMenu. */
  viewToRegisterRate: number;
}

/** The widest from/to range the owner funnel accepts; the read stays bounded however many events exist. */
export const QR_FUNNEL_MAX_SPAN_DAYS = 92;

/** Distinct sessions per step, as an aggregate query returns them (no per-event rows). */
export interface QrFunnelCounts {
  /** Sessions with any event. */
  sessions: number;
  /** Sessions with a STARTED_ORDER or PLACED_ORDER event. */
  startedOrder: number;
  placedOrder: number;
  registered: number;
}

/**
 * The same funnel as computeQrFunnel() from per-step session counts: every session with an event counts as having
 * viewed the menu, and a placed order implies a started one.
 */
export function qrFunnelFromCounts(counts: QrFunnelCounts): QrFunnel {
  const viewedMenu = counts.sessions;
  return {
    sessions: counts.sessions,
    viewedMenu,
    startedOrder: counts.startedOrder,
    placedOrder: counts.placedOrder,
    registered: counts.registered,
    viewToOrderRate: viewedMenu === 0 ? 0 : counts.placedOrder / viewedMenu,
    viewToRegisterRate: viewedMenu === 0 ? 0 : counts.registered / viewedMenu,
  };
}

const STAGE_ORDER: readonly `${QrScanOutcome}`[] = [
  QrScanOutcome.VIEWED_MENU,
  QrScanOutcome.STARTED_ORDER,
  QrScanOutcome.PLACED_ORDER,
  QrScanOutcome.REGISTERED,
];

/**
 * Counts sessions, not events: a guest who refreshes the menu five times is
 * one viewer. A later stage implies the earlier ones, so a session that
 * placed an order counts as having viewed and started even if the earlier
 * events were lost.
 */
export function computeQrFunnel(events: readonly QrScanEventLike[]): QrFunnel {
  const furthest = new Map<string, number>();
  for (const event of events) {
    const stage = STAGE_ORDER.indexOf(event.outcome);
    if (stage < 0) continue;
    const current = furthest.get(event.sessionId) ?? -1;
    if (stage > current) furthest.set(event.sessionId, stage);
  }
  // REGISTERED is reached from any stage; it is tracked separately from the order path.
  let registered = 0;
  const registeredSessions = new Set(
    events.filter((e) => e.outcome === QrScanOutcome.REGISTERED).map((e) => e.sessionId),
  );
  registered = registeredSessions.size;
  let viewedMenu = 0;
  let startedOrder = 0;
  let placedOrder = 0;
  for (const [sessionId, stage] of furthest) {
    const orderStage = stage === 3 ? orderStageOf(events, sessionId) : stage;
    if (orderStage >= 0) viewedMenu += 1;
    if (orderStage >= 1) startedOrder += 1;
    if (orderStage >= 2) placedOrder += 1;
  }
  return {
    sessions: furthest.size,
    viewedMenu,
    startedOrder,
    placedOrder,
    registered,
    viewToOrderRate: viewedMenu === 0 ? 0 : placedOrder / viewedMenu,
    viewToRegisterRate: viewedMenu === 0 ? 0 : registered / viewedMenu,
  };
}

function orderStageOf(events: readonly QrScanEventLike[], sessionId: string): number {
  let stage = 0;
  for (const event of events) {
    if (event.sessionId !== sessionId) continue;
    const index = STAGE_ORDER.indexOf(event.outcome);
    if (index >= 0 && index < 3 && index > stage) stage = index;
  }
  return stage;
}

// -- Panel management ------------------------------------------------------------------

import { UuidSchema, stripTrailingSlashes } from './validators';

export const TableLabelSchema = z.string().trim().min(1).max(20);
export const CreateTableSchema = z.object({ branchId: UuidSchema, label: TableLabelSchema }).strict();
export type CreateTableInput = z.infer<typeof CreateTableSchema>;

export const UpdateTableSchema = z
  .object({ label: TableLabelSchema.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'empty update' });
export type UpdateTableInput = z.infer<typeof UpdateTableSchema>;

/** A table as the panel sees it; the token itself travels only inside the URL. */
export interface TableDTO {
  id: string;
  branchId: string;
  label: string;
  isActive: boolean;
  qrUrl: string;
}
