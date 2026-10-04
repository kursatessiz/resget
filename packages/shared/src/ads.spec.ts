import { adCredentialIssues, decimalToMinor, metaFbc, microsToMinor, minorToDecimalString } from './ads';

describe('ad integration helpers', () => {
  it('reads decimal spend into minor units without float arithmetic', () => {
    expect(decimalToMinor('12.5', 2)).toBe(1250);
    expect(decimalToMinor('0.07', 2)).toBe(7);
    expect(decimalToMinor('19.995', 2)).toBe(2000);
    expect(decimalToMinor('100', 0)).toBe(100);
    expect(decimalToMinor('3.141', 3)).toBe(3141);
    expect(decimalToMinor('not a number', 2)).toBe(0);
  });

  it('turns Google micros into minor units', () => {
    expect(microsToMinor(12_340_000, 2)).toBe(1234);
    expect(microsToMinor(1_000_000, 0)).toBe(1);
  });

  it('writes minor units as the decimal string the APIs expect', () => {
    expect(minorToDecimalString(1250, 2)).toBe('12.50');
    expect(minorToDecimalString(7, 2)).toBe('0.07');
    expect(minorToDecimalString(100, 0)).toBe('100');
    expect(minorToDecimalString(-5, 2)).toBe('-0.05');
  });

  it("builds Meta's click id value", () => {
    expect(metaFbc('abc', new Date(1_700_000_000_000))).toBe('fb.1.1700000000000.abc');
  });

  it('lists missing and unknown credential fields', () => {
    expect(adCredentialIssues('META', { pixelId: '1', accessToken: 't' })).toEqual([]);
    expect(adCredentialIssues('META', { pixelId: '1' })).toEqual(['missing:accessToken']);
    expect(
      adCredentialIssues('GOOGLE', { customerId: '1', conversionActionId: '2', refreshToken: 'r', x: 'y' }),
    ).toEqual(['unknown:x']);
  });
});
