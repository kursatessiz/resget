import { isWithinSendWindow, localHour, nextSendWindowStart, registryCovers } from './campaigns';

describe('consent registry coverage', () => {
  it('sends SMS, calls and e-mail to IYS in Turkey, never WhatsApp', () => {
    expect(registryCovers('TR', 'SMS')).toBe(true);
    expect(registryCovers('tr', 'CALL')).toBe(true);
    expect(registryCovers('TR', 'EMAIL')).toBe(true);
    expect(registryCovers('TR', 'WHATSAPP')).toBe(false);
  });

  it('asks no registry where the country has none', () => {
    expect(registryCovers('DE', 'SMS')).toBe(false);
    expect(registryCovers('US', 'EMAIL')).toBe(false);
  });
});

describe('campaign send window', () => {
  it('reads the local hour of the restaurant time zone', () => {
    // 06:30 UTC is 09:30 in Istanbul (UTC+3) and 23:30 the day before in Los Angeles.
    const at = new Date('2026-07-01T06:30:00Z');
    expect(localHour(at, 'Europe/Istanbul')).toBe(9);
    expect(localHour(at, 'America/Los_Angeles')).toBe(23);
  });

  it('allows sends between 09:00 and 21:00 local time only', () => {
    expect(isWithinSendWindow(new Date('2026-07-01T06:30:00Z'), 'Europe/Istanbul')).toBe(true);
    expect(isWithinSendWindow(new Date('2026-07-01T05:59:00Z'), 'Europe/Istanbul')).toBe(false);
    expect(isWithinSendWindow(new Date('2026-07-01T18:00:00Z'), 'Europe/Istanbul')).toBe(false);
    expect(isWithinSendWindow(new Date('2026-07-01T17:59:00Z'), 'Europe/Istanbul')).toBe(true);
  });

  it('moves a quiet-hour send to the next opening of the window', () => {
    const night = new Date('2026-07-01T20:15:00Z'); // 23:15 Istanbul
    const next = nextSendWindowStart(night, 'Europe/Istanbul');
    expect(next.toISOString()).toBe('2026-07-02T06:00:00.000Z');
    const open = new Date('2026-07-01T10:00:00Z');
    expect(nextSendWindowStart(open, 'Europe/Istanbul')).toBe(open);
  });
});
