import { z } from 'zod';
import { isOpenAt, localClock } from './opening-hours';

/**
 * Scheduled orders (docs/ILERI_TARIHLI_SIPARIS.md, module scheduled_orders).
 * A customer places an order now for a later slot: tonight at eight, or
 * tomorrow at noon. Slots are cut from the branch's opening hours in the
 * restaurant's time zone, start at least the lead time ahead and end at the
 * horizon. The order is placed (and paid, when paid first) at once; the
 * restaurant accepts it whenever it likes before the slot, and the accept
 * alarm only rings when preparation would otherwise start late. The slot is
 * when the order is ready for pickup, or when it arrives for delivery.
 */

export const SCHEDULING_SLOT_MINUTES = [15, 30, 60] as const;
export type SchedulingSlotMinutes = (typeof SCHEDULING_SLOT_MINUTES)[number];

export const SchedulingSettingsSchema = z
  .object({
    /** The restaurant offers slots on its ordering page. */
    enabled: z.boolean().default(false),
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
    /** The earliest slot is at least this far ahead of the order. */
    minLeadMinutes: z
      .number()
      .int()
      .min(15)
      .max(24 * 60)
      .default(45),
    /** The latest slot is at most this many days ahead. */
    maxDaysAhead: z.number().int().min(1).max(7).default(2),
    /** Delivery slots are arrival times: the order must be ready this much earlier. */
    deliveryLeadMinutes: z.number().int().min(0).max(120).default(20),
  })
  .strict();
export type SchedulingSettings = z.infer<typeof SchedulingSettingsSchema>;

export const UpdateSchedulingSettingsSchema = SchedulingSettingsSchema;
export type UpdateSchedulingSettingsInput = z.input<typeof UpdateSchedulingSettingsSchema>;

/** Stored settings, read leniently: anything unreadable falls back to the defaults (off). */
export function schedulingSettingsFrom(raw: unknown): SchedulingSettings {
  const parsed = SchedulingSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : SchedulingSettingsSchema.parse({});
}

/** Slots never exceed this many, whatever the settings say. */
export const SCHEDULING_MAX_SLOTS = 400;

/**
 * Slot start times from `now`: aligned to the slot length on the
 * restaurant's local clock, at least the lead time ahead, within the
 * horizon, and inside the opening hours (hours that are not set count as
 * always open).
 */
export function scheduledSlots(input: {
  hours: unknown;
  timezone: string;
  settings: SchedulingSettings;
  now: Date;
}): Date[] {
  const { settings, timezone, hours, now } = input;
  if (!settings.enabled) return [];
  const step = settings.slotMinutes * 60_000;
  const horizon = now.getTime() + settings.maxDaysAhead * 86_400_000;
  // First whole minute after the lead time, then forward to a slot boundary on the local clock.
  let t = Math.ceil((now.getTime() + settings.minLeadMinutes * 60_000) / 60_000) * 60_000;
  for (
    let i = 0;
    i < settings.slotMinutes && localClock(new Date(t), timezone).minutes % settings.slotMinutes !== 0;
    i += 1
  ) {
    t += 60_000;
  }
  const slots: Date[] = [];
  for (; t <= horizon && slots.length < SCHEDULING_MAX_SLOTS; t += step) {
    const at = new Date(t);
    if (isOpenAt(hours, at, timezone) !== false) slots.push(at);
  }
  return slots;
}

/** Whether an instant is one of the slots offered now (exact match, to the minute). */
export function isScheduledSlot(at: Date, input: Parameters<typeof scheduledSlots>[0]): boolean {
  const minute = Math.floor(at.getTime() / 60_000);
  return scheduledSlots(input).some((slot) => Math.floor(slot.getTime() / 60_000) === minute);
}

/** When the order has to be ready for its slot: the slot itself, or the delivery lead earlier. */
export function scheduledReadyAt(
  scheduledFor: Date,
  fulfillment: 'DELIVERY' | 'PICKUP' | 'DINE_IN',
  settings: Pick<SchedulingSettings, 'deliveryLeadMinutes'>,
): Date {
  const lead = fulfillment === 'DELIVERY' ? settings.deliveryLeadMinutes : 0;
  return new Date(scheduledFor.getTime() - lead * 60_000);
}

/**
 * The accept alarm of a scheduled order: no earlier than the usual timeout
 * after placement, otherwise one timeout before preparation has to start.
 */
export function scheduledAcceptDeadline(input: {
  placedAt: Date;
  scheduledFor: Date;
  fulfillment: 'DELIVERY' | 'PICKUP' | 'DINE_IN';
  prepMinutes: number;
  acceptTimeoutMinutes: number;
  settings: Pick<SchedulingSettings, 'deliveryLeadMinutes'>;
}): Date {
  const timeout = input.acceptTimeoutMinutes * 60_000;
  const prepStart =
    scheduledReadyAt(input.scheduledFor, input.fulfillment, input.settings).getTime() - input.prepMinutes * 60_000;
  return new Date(Math.max(input.placedAt.getTime() + timeout, prepStart - timeout));
}

/** The promised ready time when a scheduled order is accepted: the slot's ready time, never sooner than the kitchen can. */
export function scheduledPromisedReadyAt(input: {
  now: Date;
  prepMinutes: number;
  scheduledFor: Date;
  fulfillment: 'DELIVERY' | 'PICKUP' | 'DINE_IN';
  settings: Pick<SchedulingSettings, 'deliveryLeadMinutes'>;
}): Date {
  const earliest = input.now.getTime() + input.prepMinutes * 60_000;
  return new Date(
    Math.max(earliest, scheduledReadyAt(input.scheduledFor, input.fulfillment, input.settings).getTime()),
  );
}

/** What the ordering page needs: the slots on offer now, in the restaurant's zone. */
export interface StorefrontSchedulingDTO {
  enabled: boolean;
  slotMinutes: SchedulingSlotMinutes;
  /** Slot start times, ISO. */
  slots: string[];
  timezone: string;
}
