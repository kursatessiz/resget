import { CreateJourneySchema, firstNameOf, journeyContentIssue, renderJourneyBody } from './journeys';

describe('journeys', () => {
  it('fills the placeholders and drops an unavailable link', () => {
    expect(
      renderJourneyBody('Merhaba {name}, {restaurant} sizi bekler. {link}', {
        name: 'Ayse',
        restaurant: 'Lokanta',
        link: 'https://resget.test/t/abc',
      }),
    ).toBe('Merhaba Ayse, Lokanta sizi bekler. https://resget.test/t/abc');
    expect(renderJourneyBody('Merhaba {name} {link} gorusuruz', { name: 'Ali', restaurant: 'L', link: null })).toBe(
      'Merhaba Ali gorusuruz',
    );
  });

  it('greets by the first name', () => {
    expect(firstNameOf('  Ayse Nur Yilmaz ')).toBe('Ayse');
    expect(firstNameOf('')).toBe('');
  });

  it('checks the text against the channel and the trigger', () => {
    expect(journeyContentIssue({ trigger: 'ORDER_COMPLETED', channel: 'SMS', body: 'Tesekkurler {name}' })).toBeNull();
    expect(journeyContentIssue({ trigger: 'WIN_BACK', channel: 'SMS', body: 'Sizi ozledik {link}' })).toBe(
      'LINK_NOT_AVAILABLE',
    );
    expect(journeyContentIssue({ trigger: 'REVIEW_REQUEST', channel: 'SMS', body: 'Nasildi? {link}' })).toBeNull();
    expect(journeyContentIssue({ trigger: 'FIRST_ORDER', channel: 'EMAIL', body: 'Hos geldiniz' })).toBe(
      'SUBJECT_REQUIRED',
    );
    expect(journeyContentIssue({ trigger: 'FIRST_ORDER', channel: 'SMS', body: 'x'.repeat(301) })).toBe(
      'BODY_TOO_LONG',
    );
  });

  it('validates the create input', () => {
    const base = { name: 'Tesekkur', trigger: 'ORDER_COMPLETED', channel: 'SMS', body: 'Tesekkurler {name}' };
    expect(CreateJourneySchema.safeParse(base).success).toBe(true);
    expect(CreateJourneySchema.safeParse({ ...base, trigger: 'BIRTHDAY' }).success).toBe(false);
    expect(CreateJourneySchema.safeParse({ ...base, delayHours: 721 }).success).toBe(false);
    expect(CreateJourneySchema.safeParse({ ...base, trigger: 'WIN_BACK', inactiveDays: 3 }).success).toBe(false);
  });
});
