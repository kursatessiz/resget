import {
  isScheduledSlot,
  scheduledAcceptDeadline,
  scheduledPromisedReadyAt,
  scheduledReadyAt,
  scheduledSlots,
  schedulingSettingsFrom,
} from './scheduling';
import { localClock } from './opening-hours';

const TZ = 'Europe/Istanbul';
const settings = schedulingSettingsFrom({ enabled: true, slotMinutes: 30, minLeadMinutes: 45, maxDaysAhead: 1 });
/** 2026-10-05 is a Monday; Istanbul is UTC+3 all year. */
const at = (local: string) => new Date(`2026-10-05T${local}:00+03:00`);

describe('schedulingSettingsFrom', () => {
  it('falls back to switched-off defaults for anything unreadable', () => {
    expect(schedulingSettingsFrom(null)).toMatchObject({ enabled: false, slotMinutes: 30, minLeadMinutes: 45 });
    expect(schedulingSettingsFrom({ slotMinutes: 7 }).enabled).toBe(false);
  });
});

describe('scheduledSlots', () => {
  it('offers nothing while switched off', () => {
    expect(
      scheduledSlots({ hours: null, timezone: TZ, settings: { ...settings, enabled: false }, now: at('10:00') }),
    ).toEqual([]);
  });

  it('starts after the lead time on a local slot boundary and keeps to the hours', () => {
    const hours = { mon: [['12:00', '14:00']] as [string, string][] };
    const slots = scheduledSlots({ hours, timezone: TZ, settings, now: at('11:20') });
    // 11:20 + 45 min = 12:05, so the first boundary is 12:30; 14:00 itself is closed.
    expect(slots.map((s) => s.toISOString())).toEqual([
      at('12:30').toISOString(),
      at('13:00').toISOString(),
      at('13:30').toISOString(),
    ]);
  });

  it('offers slots while the restaurant is closed now, up to the horizon', () => {
    const hours = { mon: [['18:00', '20:00']] as [string, string][], tue: [['18:00', '19:00']] as [string, string][] };
    const slots = scheduledSlots({ hours, timezone: TZ, settings, now: at('09:00') });
    expect(slots[0].toISOString()).toBe(at('18:00').toISOString());
    // Tuesday 18:00 is beyond 24 hours from Monday 09:00; only Monday's window counts.
    expect(slots).toHaveLength(4);
  });

  it('treats missing hours as always open', () => {
    const slots = scheduledSlots({ hours: null, timezone: TZ, settings, now: at('10:00') });
    expect(slots.length).toBeGreaterThan(40);
  });

  it('aligns on the local clock in a zone with a quarter-hour offset', () => {
    const slots = scheduledSlots({
      hours: null,
      timezone: 'Asia/Kathmandu',
      settings: { ...settings, slotMinutes: 60 },
      now: new Date('2026-10-05T00:00:00Z'),
    });
    expect(slots.slice(0, 3).map((s) => localClock(s, 'Asia/Kathmandu').minutes % 60)).toEqual([0, 0, 0]);
    // UTC+5:45: a local whole hour is a quarter past in UTC.
    expect(slots[0].getUTCMinutes()).toBe(15);
  });
});

describe('isScheduledSlot', () => {
  it('accepts an offered slot and refuses anything else', () => {
    const input = {
      hours: { mon: [['12:00', '14:00']] as [string, string][] },
      timezone: TZ,
      settings,
      now: at('11:20'),
    };
    expect(isScheduledSlot(at('13:00'), input)).toBe(true);
    expect(isScheduledSlot(at('13:10'), input)).toBe(false);
    expect(isScheduledSlot(at('12:00'), input)).toBe(false);
  });
});

describe('scheduled timing', () => {
  it('readies a delivery slot earlier by the delivery margin', () => {
    expect(scheduledReadyAt(at('20:00'), 'DELIVERY', { deliveryLeadMinutes: 20 }).toISOString()).toBe(
      at('19:40').toISOString(),
    );
    expect(scheduledReadyAt(at('20:00'), 'PICKUP', { deliveryLeadMinutes: 20 }).toISOString()).toBe(
      at('20:00').toISOString(),
    );
  });

  it('rings the accept alarm one timeout before preparation starts, never sooner than the usual timeout', () => {
    const base = { prepMinutes: 20, acceptTimeoutMinutes: 10, settings: { deliveryLeadMinutes: 20 } };
    expect(
      scheduledAcceptDeadline({
        ...base,
        placedAt: at('09:00'),
        scheduledFor: at('20:00'),
        fulfillment: 'DELIVERY',
      }).toISOString(),
    ).toBe(at('19:10').toISOString());
    expect(
      scheduledAcceptDeadline({
        ...base,
        placedAt: at('19:30'),
        scheduledFor: at('20:00'),
        fulfillment: 'PICKUP',
      }).toISOString(),
    ).toBe(at('19:40').toISOString());
  });

  it('promises the slot, or later when the kitchen cannot make it', () => {
    const base = {
      prepMinutes: 20,
      scheduledFor: at('20:00'),
      fulfillment: 'PICKUP' as const,
      settings: { deliveryLeadMinutes: 0 },
    };
    expect(scheduledPromisedReadyAt({ ...base, now: at('12:00') }).toISOString()).toBe(at('20:00').toISOString());
    expect(scheduledPromisedReadyAt({ ...base, now: at('19:50') }).toISOString()).toBe(at('20:10').toISOString());
  });
});
