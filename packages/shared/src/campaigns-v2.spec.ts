import {
  CreateCampaignSchema,
  abVariantFor,
  bestHourDueAt,
  campaignContentIssue,
  localHour,
  preferredHourOf,
  usesCampaignsV2,
} from './campaigns';

describe('campaigns v2 helpers', () => {
  it('splits recipients deterministically and close to the share', () => {
    const campaign = '6f1c2f9e-6a52-4c4f-9a43-1f2d3c4b5a69';
    expect(abVariantFor(campaign, 'c-1', 50)).toBe(abVariantFor(campaign, 'c-1', 50));
    expect(abVariantFor(campaign, 'c-1', null)).toBe('A');
    const ids = Array.from({ length: 2000 }, (_, i) => `customer-${i}`);
    const share = (pct: number) => ids.filter((id) => abVariantFor(campaign, id, pct) === 'B').length / ids.length;
    expect(share(50)).toBeGreaterThan(0.45);
    expect(share(50)).toBeLessThan(0.55);
    expect(share(20)).toBeGreaterThan(0.16);
    expect(share(20)).toBeLessThan(0.24);
  });

  it('picks the most frequent ordering hour, the earlier one on a tie', () => {
    expect(preferredHourOf([])).toBeNull();
    expect(
      preferredHourOf([
        { hour: 19, count: 3 },
        { hour: 12, count: 5 },
      ]),
    ).toBe(12);
    expect(
      preferredHourOf([
        { hour: 19, count: 4 },
        { hour: 13, count: 4 },
      ]),
    ).toBe(13);
  });

  it('schedules the next top of the preferred local hour inside the send window', () => {
    const now = new Date('2026-10-05T09:20:00Z');
    expect(bestHourDueAt(now, 'Etc/UTC', 15).toISOString()).toBe('2026-10-05T15:00:00.000Z');
    // Already the preferred hour: now.
    expect(bestHourDueAt(now, 'Etc/UTC', 9)).toBe(now);
    // Before the window: moved to its start (here the current hour, so now); later in the day, the next morning.
    expect(bestHourDueAt(now, 'Etc/UTC', 3)).toBe(now);
    expect(bestHourDueAt(new Date('2026-10-05T10:20:00Z'), 'Etc/UTC', 3).toISOString()).toBe(
      '2026-10-06T09:00:00.000Z',
    );
    // After the window: its last hour.
    expect(bestHourDueAt(now, 'Etc/UTC', 23).toISOString()).toBe('2026-10-05T20:00:00.000Z');
    // Another zone: 18:00 in UTC+3 is 15:00 UTC.
    const due = bestHourDueAt(now, 'Etc/GMT-3', 18);
    expect(localHour(due, 'Etc/GMT-3')).toBe(18);
    expect(due.toISOString()).toBe('2026-10-05T15:00:00.000Z');
  });

  it('checks the text against the channel', () => {
    expect(campaignContentIssue({ channel: 'SMS', body: 'Kisa metin' })).toBeNull();
    expect(campaignContentIssue({ channel: 'SMS', body: 'x'.repeat(301) })).toBe('BODY_TOO_LONG');
    expect(campaignContentIssue({ channel: 'SMS', body: 'Kisa', variant: { body: 'y'.repeat(301) } })).toBe(
      'BODY_TOO_LONG',
    );
    expect(campaignContentIssue({ channel: 'WHATSAPP', body: 'Kisa', subject: 'Konu' })).toBe('SUBJECT_NOT_ALLOWED');
    expect(campaignContentIssue({ channel: 'EMAIL', body: 'x'.repeat(2000) })).toBe('SUBJECT_REQUIRED');
    expect(campaignContentIssue({ channel: 'EMAIL', body: 'x'.repeat(2000), subject: 'Konu' })).toBeNull();
  });

  it('tells which inputs need the module', () => {
    expect(usesCampaignsV2({ channel: 'SMS', sendTimeMode: 'FIXED' })).toBe(false);
    expect(usesCampaignsV2({ channel: 'EMAIL' })).toBe(true);
    expect(usesCampaignsV2({ channel: 'SMS', variant: { body: 'B' } })).toBe(true);
    expect(usesCampaignsV2({ sendTimeMode: 'BEST_HOUR' })).toBe(true);
    expect(usesCampaignsV2({ attributionDays: 3 })).toBe(true);
    expect(usesCampaignsV2({ subject: null, variant: null })).toBe(false);
  });

  it('validates create input with the channel rules', () => {
    const base = { name: 'Hafta sonu', body: 'Hafta sonu yuzde on indirim' };
    expect(CreateCampaignSchema.safeParse({ ...base, channel: 'SMS' }).success).toBe(true);
    expect(CreateCampaignSchema.safeParse({ ...base, channel: 'EMAIL' }).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...base, channel: 'EMAIL', subject: 'Indirim' }).success).toBe(true);
    expect(
      CreateCampaignSchema.safeParse({ ...base, channel: 'SMS', variant: { body: 'Ikinci metin', sharePct: 5 } })
        .success,
    ).toBe(false);
    const parsed = CreateCampaignSchema.parse({ ...base, channel: 'SMS', variant: { body: 'Ikinci metin' } });
    expect(parsed.variant?.sharePct).toBe(50);
    expect(parsed.sendTimeMode).toBe('FIXED');
  });
});
