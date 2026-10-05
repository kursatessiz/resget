import { CampaignDraftRequestSchema, REDACTION_MARK, aiBudgetPeriodStart, redactPersonalData } from './ai-studio';

describe('personal data redaction', () => {
  it('removes phone numbers, email addresses, card numbers and IBANs', () => {
    const { text, redactions } = redactPersonalData(
      'Ayse Hanim icin 0532 123 45 67 veya +90 (532) 123-4567, ayse@ornek.com, kart 4111 1111 1111 1111, TR33 0006 1005 1978 6457 8413 26',
    );
    expect(redactions).toBe(5);
    expect(text).not.toMatch(/\d{4}/);
    expect(text).not.toContain('@');
    expect(text.split(REDACTION_MARK)).toHaveLength(6);
  });

  it('keeps ordinary numbers a brief needs', () => {
    const brief = 'Hafta sonu 2 pizza alana 1 icecek, 15:00 ile 18:00 arasi, yuzde 20 indirim, 2026 sezonu';
    expect(redactPersonalData(brief)).toEqual({ text: brief, redactions: 0 });
  });
});

describe('AI studio requests', () => {
  it('takes a brief, a channel and a locale with sensible defaults', () => {
    const parsed = CampaignDraftRequestSchema.parse({ brief: 'Yeni menu tanitimi', channel: 'SMS', locale: 'tr' });
    expect(parsed).toMatchObject({ tone: 'FRIENDLY', variants: 2 });
    expect(CampaignDraftRequestSchema.safeParse({ brief: 'x', channel: 'SMS', locale: 'tr' }).success).toBe(false);
    expect(
      CampaignDraftRequestSchema.safeParse({ brief: 'Yeni menu', channel: 'SMS', locale: 'tr', variants: 4 }).success,
    ).toBe(false);
  });

  it('counts the budget by UTC month', () => {
    expect(aiBudgetPeriodStart(new Date('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
