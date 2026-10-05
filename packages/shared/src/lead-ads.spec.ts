import { leadRetryDelayMinutes, leadgenNotices, mapLeadFields, MetaPageWebhookSchema } from './lead-ads';

describe('mapLeadFields', () => {
  it('maps standard fields and keeps custom answers in order', () => {
    const lead = mapLeadFields(
      [
        { name: 'full_name', values: ['Ayse Kaya'] },
        { name: 'phone_number', values: ['0532 111 22 33'] },
        { name: 'EMAIL', values: [' Ayse@Example.com '] },
        { name: 'city', values: ['Izmir'] },
        { name: 'company_name', values: ['Kaya Ltd'] },
        { name: 'kac_kisilik', values: ['4'] },
        { name: 'tarih', values: ['cuma', 'cumartesi'] },
      ],
      'TR',
    );
    expect(lead).toEqual({
      fullName: 'Ayse Kaya',
      phone: '+905321112233',
      email: 'ayse@example.com',
      city: 'Izmir',
      company: 'Kaya Ltd',
      answers: [
        ['kac_kisilik', '4'],
        ['tarih', 'cuma, cumartesi'],
      ],
    });
  });

  it('reads a local phone with the tenant country', () => {
    expect(mapLeadFields([{ name: 'phone_number', values: ['(201) 555-0123'] }], 'US').phone).toBe('+12015550123');
  });

  it('joins first and last names and drops invalid phones and emails', () => {
    const lead = mapLeadFields(
      [
        { name: 'first_name', values: ['Ali'] },
        { name: 'last_name', values: ['Veli'] },
        { name: 'phone_number', values: ['123'] },
        { name: 'email', values: ['not-an-email'] },
      ],
      'TR',
    );
    expect(lead.fullName).toBe('Ali Veli');
    expect(lead.phone).toBeNull();
    expect(lead.email).toBeNull();
  });

  it('caps values and the number of custom answers', () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ name: `q${i}`, values: ['x'.repeat(500)] }));
    const lead = mapLeadFields(fields, 'TR');
    expect(lead.answers).toHaveLength(30);
    expect(lead.answers[0][1]).toHaveLength(300);
  });
});

describe('leadgenNotices', () => {
  const parse = (body: unknown) => leadgenNotices(MetaPageWebhookSchema.parse(body));

  it('reads leadgen changes of page deliveries and skips everything else', () => {
    expect(
      parse({
        object: 'page',
        entry: [
          {
            id: '111',
            changes: [
              { field: 'leadgen', value: { leadgen_id: 444, page_id: '111', form_id: '555', ad_id: '666' } },
              { field: 'feed', value: { post_id: '1' } },
              { field: 'leadgen', value: { page_id: '111' } },
            ],
          },
        ],
      }),
    ).toEqual([{ leadgenId: '444', pageId: '111', formId: '555', adId: '666' }]);
    expect(parse({ object: 'instagram', entry: [{ id: '1', changes: [] }] })).toEqual([]);
  });
});

describe('leadRetryDelayMinutes', () => {
  it('doubles after each failure', () => {
    expect([1, 2, 3, 4].map(leadRetryDelayMinutes)).toEqual([2, 4, 8, 16]);
  });
});
