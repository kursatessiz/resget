import { z } from 'zod';
import { OpeningHoursSchema, WEEKDAY_KEYS, isOpenAt, localClock } from './opening-hours';
import type { OpeningHours } from './opening-hours';

/**
 * Order availability (docs/SIPARIS_VE_SEVK.md, "Sipariş alma durumu"): the
 * restaurant can pause new orders for a while or until it resumes, mark
 * itself busy so customers see a longer preparation time, and refuse
 * consumer orders outside its opening hours. Behind the order_availability
 * module switch; while it is off every restaurant accepts orders as before.
 * Staff-entered orders (phone, counter) are never refused: the person at the
 * till decides.
 */

export type AvailabilityState = 'OPEN' | 'PAUSED' | 'CLOSED';

/** Pause lengths the panel offers; null pauses until the restaurant resumes. */
export const PAUSE_MINUTE_CHOICES = [15, 30, 60, 120] as const;
/** Extra preparation minutes the panel offers in busy mode. */
export const BUSY_EXTRA_MINUTE_CHOICES = [10, 20, 30, 45] as const;
export const BUSY_MAX_EXTRA_MINUTES = 120;
/** A pause or a busy spell without an end lasts at most this long; nobody has to remember to undo it. */
export const AVAILABILITY_MAX_MINUTES = 24 * 60;

/**
 * Changes from the panel. Missing fields stay as they are; null clears.
 * pause.minutes null pauses until resumed (still capped at a day, see
 * AVAILABILITY_MAX_MINUTES in the API).
 */
export const UpdateAvailabilitySchema = z
  .object({
    pause: z
      .object({ minutes: z.number().int().min(5).max(AVAILABILITY_MAX_MINUTES).nullable() })
      .strict()
      .nullable()
      .optional(),
    busy: z
      .object({
        extraMinutes: z.number().int().min(5).max(BUSY_MAX_EXTRA_MINUTES),
        minutes: z.number().int().min(15).max(AVAILABILITY_MAX_MINUTES),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => v.pause !== undefined || v.busy !== undefined, { message: 'Nothing to change' });
export type UpdateAvailabilityInput = z.infer<typeof UpdateAvailabilitySchema>;

/** Weekly hours of one branch, replaced as a whole; null removes them (hours unknown, never closed). */
export const UpdateOpeningHoursSchema = z
  .object({ branchId: z.string().uuid(), hours: OpeningHoursSchema.nullable() })
  .strict()
  .refine((v) => v.hours === null || hoursAreValid(v.hours), { message: 'Window ends before it starts' });
export type UpdateOpeningHoursInput = z.infer<typeof UpdateOpeningHoursSchema>;

export interface OrderAvailabilityDTO {
  /** The module is on for the restaurant; when false the rest only describes defaults. */
  enabled: boolean;
  accepting: boolean;
  state: AvailabilityState;
  /** Set while paused: when orders open again (the pause end, capped). */
  pausedUntil: string | null;
  /** Busy mode: extra minutes on the preparation estimate, 0 when not busy. */
  busyExtraMinutes: number;
  busyUntil: string | null;
  /** When closed by the hours: the next opening, null when none is set within a week. */
  nextOpenAt: string | null;
  /** The restaurant's zone: times above are shown in it, the same on the server and in the browser. */
  timezone: string;
}

export interface AvailabilityInput {
  enabled: boolean;
  hours: unknown;
  timezone: string;
  pausedUntil: Date | null;
  busyExtraMinutes: number;
  busyUntil: Date | null;
  now?: Date;
}

/** What applies right now: a pause first, then the opening hours; unknown hours never close a restaurant. */
export function orderAvailability(input: AvailabilityInput): OrderAvailabilityDTO {
  const now = input.now ?? new Date();
  const busy = input.enabled && input.busyUntil !== null && input.busyUntil > now && input.busyExtraMinutes > 0;
  const base = {
    enabled: input.enabled,
    timezone: input.timezone,
    busyExtraMinutes: busy ? input.busyExtraMinutes : 0,
    busyUntil: busy && input.busyUntil ? input.busyUntil.toISOString() : null,
  };
  if (!input.enabled) {
    return { ...base, accepting: true, state: 'OPEN', pausedUntil: null, nextOpenAt: null };
  }
  if (input.pausedUntil && input.pausedUntil > now) {
    return {
      ...base,
      accepting: false,
      state: 'PAUSED',
      pausedUntil: input.pausedUntil.toISOString(),
      nextOpenAt: null,
    };
  }
  if (isOpenAt(input.hours, now, input.timezone) === false) {
    const next = nextOpeningAt(input.hours, now, input.timezone);
    return {
      ...base,
      accepting: false,
      state: 'CLOSED',
      pausedUntil: null,
      nextOpenAt: next ? next.toISOString() : null,
    };
  }
  return { ...base, accepting: true, state: 'OPEN', pausedUntil: null, nextOpenAt: null };
}

/** The preparation estimate the customer sees: the default plus the busy extra. */
export function preparationEstimateMinutes(defaultPrepMinutes: number, availability: OrderAvailabilityDTO): number {
  return defaultPrepMinutes + availability.busyExtraMinutes;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Every window opens before it closes, except one that runs past midnight (close earlier than open, never equal). */
export function hoursAreValid(hours: OpeningHours): boolean {
  return WEEKDAY_KEYS.every((day) =>
    (hours[day] ?? []).every(([open, close]) => open !== close && minutesOf(open) < 24 * 60),
  );
}

/**
 * The next window start after now within a week, in the restaurant's zone.
 * Counted in local minutes from now, so a daylight-saving change in between
 * can shift it by an hour; the estimate is only shown, never enforced.
 */
export function nextOpeningAt(hours: unknown, now: Date, timezone: string): Date | null {
  const parsed = OpeningHoursSchema.safeParse(hours);
  if (!parsed.success) return null;
  const { day, minutes } = localClock(now, timezone);
  const start = WEEKDAY_KEYS.indexOf(day);
  for (let offset = 0; offset <= 7; offset += 1) {
    const key = WEEKDAY_KEYS[(start + offset) % 7];
    const opens = (parsed.data[key] ?? [])
      .map(([open]) => minutesOf(open))
      .filter((open) => offset > 0 || open > minutes)
      .sort((a, b) => a - b);
    if (opens.length > 0) {
      const delta = offset * 24 * 60 + opens[0] - minutes;
      const at = new Date(now.getTime() + delta * 60_000);
      at.setUTCSeconds(0, 0);
      return at;
    }
  }
  return null;
}

/** One branch's weekly hours for the settings editor; null hours are unknown. */
export interface BranchHoursDTO {
  branchId: string;
  name: string;
  hours: OpeningHours | null;
}
