import { UpdateAvailabilitySchema, UpdateOpeningHoursSchema, nextOpeningAt, orderAvailability } from './availability';

const TZ = 'Europe/Istanbul';
// Monday 2026-10-05 12:00 in Istanbul (UTC+3).
const monNoon = new Date('2026-10-05T09:00:00Z');
const hours = { mon: [['10:00', '22:00']], tue: [['10:00', '22:00']], sat: [['12:00', '02:00']] };
const base = { enabled: true, hours, timezone: TZ, pausedUntil: null, busyExtraMinutes: 0, busyUntil: null };

describe('order availability', () => {
  it('accepts as before while the module is off, whatever the hours or pause', () => {
    const off = orderAvailability({
      ...base,
      enabled: false,
      pausedUntil: new Date(monNoon.getTime() + 60_000),
      busyExtraMinutes: 20,
      busyUntil: new Date(monNoon.getTime() + 60_000),
      now: new Date('2026-10-05T21:00:00Z'),
    });
    expect(off).toMatchObject({ accepting: true, state: 'OPEN', busyExtraMinutes: 0, busyUntil: null });
  });

  it('is open inside the hours and closed outside, with the next opening', () => {
    expect(orderAvailability({ ...base, now: monNoon })).toMatchObject({ accepting: true, state: 'OPEN' });
    // Monday 23:00 local: closed, opens Tuesday 10:00 local (07:00Z).
    const closed = orderAvailability({ ...base, now: new Date('2026-10-05T20:00:00Z') });
    expect(closed).toMatchObject({ accepting: false, state: 'CLOSED', nextOpenAt: '2026-10-06T07:00:00.000Z' });
  });

  it('never closes a restaurant whose hours are unknown', () => {
    expect(orderAvailability({ ...base, hours: null, now: monNoon }).accepting).toBe(true);
  });

  it('a pause wins over open hours and ends by itself', () => {
    const pausedUntil = new Date(monNoon.getTime() + 30 * 60_000);
    expect(orderAvailability({ ...base, pausedUntil, now: monNoon })).toMatchObject({
      accepting: false,
      state: 'PAUSED',
      pausedUntil: pausedUntil.toISOString(),
    });
    expect(orderAvailability({ ...base, pausedUntil, now: new Date(pausedUntil.getTime() + 1) }).state).toBe('OPEN');
  });

  it('busy mode adds minutes only while it lasts', () => {
    const busyUntil = new Date(monNoon.getTime() + 60 * 60_000);
    expect(orderAvailability({ ...base, busyExtraMinutes: 20, busyUntil, now: monNoon }).busyExtraMinutes).toBe(20);
    expect(
      orderAvailability({ ...base, busyExtraMinutes: 20, busyUntil, now: new Date(busyUntil.getTime() + 1) })
        .busyExtraMinutes,
    ).toBe(0);
  });

  it('finds the next opening across days and none without hours', () => {
    // Tuesday 23:00 local: next is Saturday 12:00 local.
    expect(nextOpeningAt(hours, new Date('2026-10-06T20:00:00Z'), TZ)?.toISOString()).toBe('2026-10-10T09:00:00.000Z');
    expect(nextOpeningAt({}, monNoon, TZ)).toBeNull();
    expect(nextOpeningAt(null, monNoon, TZ)).toBeNull();
  });

  it('validates panel input', () => {
    expect(UpdateAvailabilitySchema.safeParse({ pause: { minutes: 30 } }).success).toBe(true);
    expect(UpdateAvailabilitySchema.safeParse({ pause: { minutes: null } }).success).toBe(true);
    expect(UpdateAvailabilitySchema.safeParse({ busy: null }).success).toBe(true);
    expect(UpdateAvailabilitySchema.safeParse({}).success).toBe(false);
    expect(UpdateAvailabilitySchema.safeParse({ busy: { extraMinutes: 500, minutes: 60 } }).success).toBe(false);
    const branchId = '6f1c2a7e-3b7c-4d9e-9a51-6b0f4f7d2c11';
    expect(UpdateOpeningHoursSchema.safeParse({ branchId, hours }).success).toBe(true);
    expect(UpdateOpeningHoursSchema.safeParse({ branchId, hours: null }).success).toBe(true);
    expect(UpdateOpeningHoursSchema.safeParse({ branchId, hours: { mon: [['10:00', '10:00']] } }).success).toBe(false);
    expect(UpdateOpeningHoursSchema.safeParse({ branchId, hours: { mon: [['24:00', '02:00']] } }).success).toBe(false);
  });
});
