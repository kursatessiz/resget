import { ModifierGroupInputSchema, UpdateMenuCategorySchema, UpdateMenuItemSchema, categoryServedAt } from './menu';
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

describe('menu dayparts', () => {
  const tz = 'Europe/Istanbul';
  // 2026-10-05 is a Monday; Istanbul is UTC+3 all year.
  const at = (local: string) => new Date(`2026-10-05T${local}:00+03:00`);
  const breakfast = { mon: [['07:00', '11:00']] as [string, string][] };

  it('serves a category without windows at any time and one with windows only inside them', () => {
    expect(categoryServedAt(null, at('03:00'), tz)).toBe(true);
    expect(categoryServedAt(breakfast, at('08:30'), tz)).toBe(true);
    expect(categoryServedAt(breakfast, at('11:00'), tz)).toBe(false);
    expect(categoryServedAt(breakfast, new Date('2026-10-06T08:30:00+03:00'), tz)).toBe(false);
  });

  it('refuses a window that ends where it starts', () => {
    expect(UpdateMenuCategorySchema.safeParse({ availableHours: { mon: [['09:00', '09:00']] } }).success).toBe(false);
    expect(UpdateMenuCategorySchema.safeParse({ availableHours: breakfast }).success).toBe(true);
    expect(UpdateMenuCategorySchema.safeParse({ availableHours: null }).success).toBe(true);
  });
});
