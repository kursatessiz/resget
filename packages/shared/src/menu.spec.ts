import { ModifierGroupInputSchema, UpdateMenuItemSchema } from './menu';
import { majorAmountText, parseMajorAmount } from './money';

describe('menu schemas', () => {
  it('rejects a modifier group whose bounds do not fit its options', () => {
    const base = { name: 'Boyut', modifiers: [{ name: 'Kucuk', priceDeltaMinor: 0 }] };
    expect(ModifierGroupInputSchema.safeParse({ ...base, minSelect: 1, maxSelect: 1 }).success).toBe(true);
    expect(ModifierGroupInputSchema.safeParse({ ...base, minSelect: 2, maxSelect: 1 }).success).toBe(false);
    expect(ModifierGroupInputSchema.safeParse({ ...base, minSelect: 2, maxSelect: 3 }).success).toBe(false);
  });

  it('rejects an empty item update', () => {
    expect(UpdateMenuItemSchema.safeParse({}).success).toBe(false);
    expect(UpdateMenuItemSchema.safeParse({ isAvailable: false }).success).toBe(true);
  });
});

describe('major amount input', () => {
  it('parses comma and dot decimals into minor units without rounding', () => {
    expect(parseMajorAmount('42', 'TRY')).toBe(4200);
    expect(parseMajorAmount('42,5', 'TRY')).toBe(4250);
    expect(parseMajorAmount('42.555', 'TRY')).toBe(4255);
    expect(parseMajorAmount('-3.25', 'EUR')).toBe(-325);
    expect(parseMajorAmount('1200', 'JPY')).toBe(1200);
    expect(parseMajorAmount('abc', 'TRY')).toBeNull();
    expect(parseMajorAmount('', 'TRY')).toBeNull();
  });

  it('formats minor units back into field text', () => {
    expect(majorAmountText(4250, 'TRY')).toBe('42.50');
    expect(majorAmountText(-5, 'TRY')).toBe('-0.05');
    expect(majorAmountText(1200, 'JPY')).toBe('1200');
  });
});
