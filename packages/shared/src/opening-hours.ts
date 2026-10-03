import { z } from 'zod';

/**
 * Branch opening hours (docs/VITRIN.md): per weekday, zero or more
 * [open, close] windows in the branch's local time, "24:00" allowed as a
 * close. Stored as JSON on the branch and read by the marketplace to say
 * whether a restaurant is open right now. No hours means unknown, not
 * closed.
 */

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const TimeSchema = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'HH:MM expected');
const WindowSchema = z.tuple([TimeSchema, TimeSchema]);

export const OpeningHoursSchema = z
  .object(Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, z.array(WindowSchema).max(4).optional()])))
  .strict();
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Weekday key and minutes since midnight of an instant in a time zone. */
export function localClock(now: Date, timezone: string): { day: WeekdayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday =
    parts
      .find((p) => p.type === 'weekday')
      ?.value.toLowerCase()
      .slice(0, 3) ?? 'mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const day = (WEEKDAY_KEYS as readonly string[]).includes(weekday) ? (weekday as WeekdayKey) : 'mon';
  return { day, minutes: hour * 60 + minute };
}

/**
 * Open at the instant, in the zone; null when the hours are missing or
 * malformed. A window that closes after midnight ("18:00" to "02:00") counts
 * on the day it opens and spills into the next day.
 */
export function isOpenAt(hours: unknown, now: Date, timezone: string): boolean | null {
  const parsed = OpeningHoursSchema.safeParse(hours);
  if (!parsed.success) return null;
  const { day, minutes } = localClock(now, timezone);
  const index = WEEKDAY_KEYS.indexOf(day);
  const previous = WEEKDAY_KEYS[(index + 6) % 7];
  const today = parsed.data[day] ?? [];
  const yesterday = parsed.data[previous] ?? [];
  for (const [open, close] of today) {
    const start = minutesOf(open);
    const end = minutesOf(close);
    if (end > start ? minutes >= start && minutes < end : minutes >= start) return true;
  }
  for (const [open, close] of yesterday) {
    const start = minutesOf(open);
    const end = minutesOf(close);
    if (end <= start && minutes < end) return true;
  }
  return false;
}
