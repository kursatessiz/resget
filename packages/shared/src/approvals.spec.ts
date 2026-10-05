import { AuditQuerySchema, UpdateSendLimitSchema, sendLimitBlock } from './approvals';

describe('send limits', () => {
  it('blocks on the per-campaign limit first, then on the rolling day', () => {
    expect(sendLimitBlock(null, 1_000_000, 1_000_000)).toBeNull();
    const limit = { maxPerCampaign: 100, maxPerDay: 250 };
    expect(sendLimitBlock(limit, 100, 150)).toBeNull();
    expect(sendLimitBlock(limit, 101, 0)).toBe('PER_CAMPAIGN');
    expect(sendLimitBlock(limit, 100, 151)).toBe('PER_DAY');
    expect(sendLimitBlock({ maxPerCampaign: null, maxPerDay: null }, 10_000, 10_000)).toBeNull();
  });

  it('accepts whole positive limits or none', () => {
    expect(UpdateSendLimitSchema.safeParse({ maxPerCampaign: null, maxPerDay: 500 }).success).toBe(true);
    expect(UpdateSendLimitSchema.safeParse({ maxPerCampaign: 0, maxPerDay: null }).success).toBe(false);
    expect(UpdateSendLimitSchema.safeParse({ maxPerCampaign: 1.5, maxPerDay: null }).success).toBe(false);
    expect(UpdateSendLimitSchema.safeParse({ maxPerCampaign: 10 }).success).toBe(false);
  });
});

describe('audit query', () => {
  it('takes a slug, an action prefix and a day range', () => {
    const parsed = AuditQuerySchema.parse({ restaurant: 'platform', action: 'campaign.', from: '2026-10-01' });
    expect(parsed.page).toBe(1);
    expect(AuditQuerySchema.safeParse({ action: 'Campaign;drop' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ from: '01.10.2026' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ unknown: 'x' }).success).toBe(false);
  });
});
