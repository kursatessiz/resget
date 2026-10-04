import {
  DeleteAccountSchema,
  anonymizedAddressSnapshot,
  deletedUserPhone,
  isDeletedUserPhone,
  visibleContact,
} from './privacy';

describe('personal data rights', () => {
  it('replaces a deleted phone with a tombstone that never looks like a number', () => {
    const tombstone = deletedUserPhone('7b0c');
    expect(isDeletedUserPhone(tombstone)).toBe(true);
    expect(isDeletedUserPhone('+905321234567')).toBe(false);
    expect(isDeletedUserPhone(null)).toBe(false);
  });

  it('shows staff no contact for a deleted account', () => {
    expect(visibleContact({ phone: '+905321234567', fullName: 'Ayse' })).toEqual({
      phone: '+905321234567',
      fullName: 'Ayse',
    });
    expect(visibleContact({ phone: deletedUserPhone('x'), fullName: '' })).toBeNull();
    expect(visibleContact(null)).toBeNull();
  });

  it('keeps only the area of an order address', () => {
    expect(
      anonymizedAddressSnapshot({
        addressLine: 'Moda Cad. No 5 D 1',
        city: 'Istanbul',
        district: 'Kadikoy',
        note: 'Zil bozuk',
        contactName: 'Ayse',
        contactPhone: '+905321234567',
        point: { lat: 40.98, lng: 29.02 },
      }),
    ).toEqual({
      addressLine: '',
      city: 'Istanbul',
      district: 'Kadikoy',
      contactName: '',
      contactPhone: '',
      point: null,
    });
    expect(anonymizedAddressSnapshot(null)).toBeNull();
  });

  it('asks for an explicit confirmation', () => {
    expect(DeleteAccountSchema.safeParse({}).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(DeleteAccountSchema.safeParse({ confirm: true }).success).toBe(true);
  });
});
