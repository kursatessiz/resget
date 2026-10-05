import { z } from 'zod';
import type { FulfillmentTypeValue, OrderChannelValue, OrderStatusValue } from './delivery';

/**
 * Kitchen display (docs/MUTFAK_EKRANI.md, module kitchen_display): the
 * accepted orders as tickets, oldest promise first, with each line marked
 * done by the cook. Stations are tenant data: a menu section names the
 * station its items go to, and a screen can show one station only.
 */

/** Orders the kitchen works on; PLACED ones wait for acceptance on the orders screen. */
export const KITCHEN_STATUSES = ['ACCEPTED', 'PREPARING'] as const satisfies readonly OrderStatusValue[];

export const KitchenStationSchema = z.string().trim().min(1).max(40);

export const KitchenQuerySchema = z.object({ station: KitchenStationSchema.optional() }).strict();
export type KitchenQuery = z.infer<typeof KitchenQuerySchema>;

export const MarkItemPreparedSchema = z.object({ prepared: z.boolean() }).strict();
export type MarkItemPreparedInput = z.infer<typeof MarkItemPreparedSchema>;

export interface KitchenItemDTO {
  id: string;
  name: string;
  quantity: number;
  /** Chosen options as the order snapshot names them. */
  modifiers: string[];
  /** The station of the item's menu section; null for the shared screen. */
  station: string | null;
  preparedAt: string | null;
}

export interface KitchenTicketDTO {
  orderId: string;
  shortCode: string;
  status: OrderStatusValue;
  fulfillment: FulfillmentTypeValue;
  channel: OrderChannelValue;
  tableLabel: string | null;
  note: string | null;
  placedAt: string;
  acceptedAt: string | null;
  /** When the kitchen promised it ready; past it the ticket shows late. */
  promisedReadyAt: string | null;
  /** A scheduled order's slot (docs/ILERI_TARIHLI_SIPARIS.md). */
  scheduledFor: string | null;
  /** On a station screen, only that station's lines. */
  items: KitchenItemDTO[];
}

export interface KitchenBoardDTO {
  /** Stations named on the menu, for the screen's picker. */
  stations: string[];
  tickets: KitchenTicketDTO[];
}

/** When a ticket is due: the kitchen promise, else the slot, else when it was placed. */
export function kitchenDueAt(ticket: Pick<KitchenTicketDTO, 'promisedReadyAt' | 'scheduledFor' | 'placedAt'>): string {
  return ticket.promisedReadyAt ?? ticket.scheduledFor ?? ticket.placedAt;
}

/** Past its promise and not yet ready. */
export function isKitchenTicketLate(ticket: Pick<KitchenTicketDTO, 'promisedReadyAt'>, now: Date): boolean {
  return ticket.promisedReadyAt !== null && new Date(ticket.promisedReadyAt).getTime() < now.getTime();
}

/** Tickets in the order the kitchen should cook them: the earliest due first. */
export function sortKitchenTickets<T extends Pick<KitchenTicketDTO, 'promisedReadyAt' | 'scheduledFor' | 'placedAt'>>(
  tickets: T[],
): T[] {
  return [...tickets].sort((a, b) => kitchenDueAt(a).localeCompare(kitchenDueAt(b)));
}
