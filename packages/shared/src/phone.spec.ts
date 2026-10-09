import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('reads Turkish numbers in their usual spellings', () => {
    for (const input of ['05321234567', '0532 123 45 67', '5321234567', '+90 532 123 45 67', '00905321234567']) {
      expect(normalizePhone(input)).toBe('+905321234567');
    }
    expect(normalizePhone('0216 123 45 67')).toBe('+902161234567');
  });

  it('reads other countries with their own rules', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('020 7946 0958', '44')).toBe('+442079460958');
  });

  it('refuses digits that are not a phone number instead of storing them', () => {
    for (const input of ['', '12345', '+1234567', '+90 123', '0532 12', 'abc', '00999123456789']) {
      expect(normalizePhone(input)).toBeNull();
    }
    // Turkish rules are never applied to another country's number.
    expect(normalizePhone('05321234567', '44')).toBeNull();
  });
});
