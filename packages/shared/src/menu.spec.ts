import {
  ModifierGroupInputSchema,
  UpdateMenuCategorySchema,
  UpdateMenuItemSchema,
  categoryServedAt,
  resolveLineModifiers,
} from './menu';
import type { ModifierCatalogueGroup } from './menu';
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

describe('order line options', () => {
  const groups: ModifierCatalogueGroup[] = [
    {
      id: 'g-size',
      name: 'Boyut',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: 'm-small', name: 'Kucuk', priceDeltaMinor: 0, isAvailable: true },
        { id: 'm-large', name: 'Buyuk', priceDeltaMinor: 2000, isAvailable: true },
      ],
    },
    {
      id: 'g-extra',
      name: 'Ekstra',
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: 'm-cheese', name: 'Peynir', priceDeltaMinor: 500, isAvailable: true },
        { id: 'm-egg', name: 'Yumurta', priceDeltaMinor: 700, isAvailable: false },
        { id: 'm-sauce', name: 'Sos', priceDeltaMinor: 300, isAvailable: true },
      ],
    },
  ];

  it('takes options by id or by name and charges the menu price', () => {
    expect(
      resolveLineModifiers(groups, [
        { id: 'm-large', name: 'whatever', priceDeltaMinor: 2000 },
        { name: 'Ekstra: Peynir', priceDeltaMinor: 500 },
        { name: 'Sos', priceDeltaMinor: 300 },
      ]),
    ).toEqual({
      ok: true,
      modifiers: [
        { name: 'Boyut: Buyuk', priceDeltaMinor: 2000 },
        { name: 'Ekstra: Peynir', priceDeltaMinor: 500 },
        { name: 'Ekstra: Sos', priceDeltaMinor: 300 },
      ],
    });
  });

  it('never lets the client set a price', () => {
    expect(resolveLineModifiers(groups, [{ name: 'Boyut: Kucuk', priceDeltaMinor: -9000 }])).toEqual({
      ok: false,
      code: 'MODIFIER_PRICE_CHANGED',
    });
    expect(resolveLineModifiers(groups, [{ name: 'Indirim', priceDeltaMinor: -9000 }]).ok).toBe(false);
  });

  it('enforces availability, repeats and the group limits', () => {
    const small = { id: 'm-small', name: 'Kucuk', priceDeltaMinor: 0 };
    expect(resolveLineModifiers(groups, [])).toEqual({ ok: false, code: 'MODIFIER_INVALID' });
    expect(resolveLineModifiers(groups, [small, { name: 'Yumurta', priceDeltaMinor: 700 }]).ok).toBe(false);
    expect(resolveLineModifiers(groups, [small, { id: 'm-large', name: 'Buyuk', priceDeltaMinor: 2000 }]).ok).toBe(
      false,
    );
    expect(
      resolveLineModifiers(groups, [
        small,
        { name: 'Peynir', priceDeltaMinor: 500 },
        { name: 'Peynir', priceDeltaMinor: 500 },
      ]).ok,
    ).toBe(false);
    expect(resolveLineModifiers([], [])).toEqual({ ok: true, modifiers: [] });
  });
});
