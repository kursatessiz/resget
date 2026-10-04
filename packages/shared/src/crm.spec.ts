import { CreateContactSchema, PLATFORM_DEFAULT_STAGES, UpdateContactSchema, csvField } from './crm';

describe('CRM core', () => {
  it('ends the platform funnel in one won and one lost stage', () => {
    expect(PLATFORM_DEFAULT_STAGES.filter((s) => s.kind === 'WON').map((s) => s.key)).toEqual(['live']);
    expect(PLATFORM_DEFAULT_STAGES.filter((s) => s.kind === 'LOST').map((s) => s.key)).toEqual(['lost']);
  });

  it('validates contacts and updates', () => {
    expect(CreateContactSchema.safeParse({ fullName: 'Ayse Yilmaz', phone: '05321234567' }).success).toBe(true);
    expect(CreateContactSchema.safeParse({ fullName: 'A', phone: '05321234567' }).success).toBe(false);
    expect(CreateContactSchema.safeParse({ fullName: 'Ayse', phone: '0532', email: 'x' }).success).toBe(false);
    expect(UpdateContactSchema.safeParse({}).success).toBe(false);
    expect(UpdateContactSchema.safeParse({ stageId: null }).success).toBe(true);
  });

  it('writes safe CSV fields', () => {
    expect(csvField('Kadikoy')).toBe('Kadikoy');
    expect(csvField('Moda, Kadikoy')).toBe('"Moda, Kadikoy"');
    expect(csvField('a "b"')).toBe('"a ""b"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField(null)).toBe('');
    expect(csvField(3)).toBe('3');
  });
});
