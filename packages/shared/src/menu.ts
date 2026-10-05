import { z } from 'zod';
import { BasisPointsSchema, MinorAmountSchema } from './money';
import { UuidSchema } from './validators';
import { OpeningHoursSchema, isOpenAt } from './opening-hours';
import type { OpeningHours } from './opening-hours';
import { hoursAreValid } from './availability';
import { AllergenListSchema, DietaryTagListSchema } from './allergens';
import type { Allergen, DietaryTag } from './allergens';

/**
 * Menu management (restaurant panel). The menu is tenant data: categories,
 * items and modifier groups are rows the restaurant edits, never enums.
 * Prices are integer minor units in the restaurant's currency; the API sets
 * the currency, a client never sends one.
 */

const MenuName = z.string().trim().min(1).max(80);
const SortOrder = z.number().int().min(0).max(100000);
const ImageUrl = z.string().trim().url().max(500);
const nonEmpty = (value: object) => Object.keys(value).length > 0;

/**
 * When a category may be ordered (docs/OGUN_SAATLERI.md, module
 * menu_dayparts): weekly windows in the restaurant's zone, the same shape as
 * opening hours; null means whenever the restaurant takes orders.
 */
const AvailableHours = OpeningHoursSchema.nullable().refine((hours) => hours === null || hoursAreValid(hours), {
  message: 'Window ends before it starts',
});

/** Kitchen station of a section (docs/MUTFAK_EKRANI.md); null clears it. */
const KitchenStation = z.string().trim().min(1).max(40).nullable();

export const CreateMenuCategorySchema = z
  .object({
    name: MenuName,
    sortOrder: SortOrder.optional(),
    availableHours: AvailableHours.optional(),
    kitchenStation: KitchenStation.optional(),
  })
  .strict();
export type CreateMenuCategoryInput = z.infer<typeof CreateMenuCategorySchema>;

export const UpdateMenuCategorySchema = z
  .object({
    name: MenuName.optional(),
    sortOrder: SortOrder.optional(),
    isActive: z.boolean().optional(),
    availableHours: AvailableHours.optional(),
    kitchenStation: KitchenStation.optional(),
  })
  .strict()
  .refine(nonEmpty, { message: 'empty update' });
export type UpdateMenuCategoryInput = z.infer<typeof UpdateMenuCategorySchema>;

export const CreateMenuItemSchema = z
  .object({
    categoryId: UuidSchema,
    name: MenuName,
    description: z.string().trim().max(500).nullable().optional(),
    priceMinor: MinorAmountSchema,
    vatRateBps: BasisPointsSchema,
    imageUrl: ImageUrl.nullable().optional(),
    isAvailable: z.boolean().optional(),
    sortOrder: SortOrder.optional(),
    /** Declared allergens (docs/ALERJENLER.md); shown while the allergens module is on. */
    allergens: AllergenListSchema.optional(),
    dietaryTags: DietaryTagListSchema.optional(),
  })
  .strict();
export type CreateMenuItemInput = z.infer<typeof CreateMenuItemSchema>;

export const UpdateMenuItemSchema = CreateMenuItemSchema.partial().refine(nonEmpty, { message: 'empty update' });
export type UpdateMenuItemInput = z.infer<typeof UpdateMenuItemSchema>;

export const ModifierInputSchema = z
  .object({
    name: MenuName,
    priceDeltaMinor: z.number().int().min(-10_000_000).max(10_000_000),
    isAvailable: z.boolean().default(true),
  })
  .strict();
export type ModifierInput = z.infer<typeof ModifierInputSchema>;

/** One choice group of an item ("Size", "Extras"); min and max bound how many options a guest picks. */
export const ModifierGroupInputSchema = z
  .object({
    name: MenuName,
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    modifiers: z.array(ModifierInputSchema).min(1).max(50),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (group.maxSelect < group.minSelect) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxSelect'], message: 'max below min' });
    }
    if (group.minSelect > group.modifiers.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minSelect'], message: 'min above option count' });
    }
  });
export type ModifierGroupInput = z.infer<typeof ModifierGroupInputSchema>;

/** The groups of an item are replaced as a whole; the panel edits them together. */
export const ReplaceModifierGroupsSchema = z.object({ groups: z.array(ModifierGroupInputSchema).max(20) }).strict();
export type ReplaceModifierGroupsInput = z.infer<typeof ReplaceModifierGroupsSchema>;

/** New order of categories, or of the items of one category: every id of the set, once. */
export const ReorderSchema = z.object({ ids: z.array(UuidSchema).min(1).max(500) }).strict();
export type ReorderInput = z.infer<typeof ReorderSchema>;

export interface MenuModifierDTO {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuModifierGroupDTO {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  modifiers: MenuModifierDTO[];
}

/** An item as the panel sees it: unavailable items and all option groups included. */
export interface MenuItemAdminDTO {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  vatRateBps: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  modifierGroups: MenuModifierGroupDTO[];
}

export interface MenuCategoryAdminDTO {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Ordering windows (docs/OGUN_SAATLERI.md); null for whenever the restaurant takes orders. */
  availableHours: OpeningHours | null;
  /** Kitchen station (docs/MUTFAK_EKRANI.md); null for the shared screen. */
  kitchenStation: string | null;
  items: MenuItemAdminDTO[];
}

export interface MenuAdminDTO {
  currency: string;
  categories: MenuCategoryAdminDTO[];
}

/** Whether a category can be ordered at an instant: no windows means always, otherwise inside one of them. */
export function categoryServedAt(hours: OpeningHours | null, at: Date, timezone: string): boolean {
  return hours === null || isOpenAt(hours, at, timezone) === true;
}

// -- Chosen options on an order line ------------------------------------------------------

/** An item's option groups as the server checks an order line against them. */
export interface ModifierCatalogueGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: { id: string; name: string; priceDeltaMinor: number; isAvailable: boolean }[];
}

/** One chosen option as an order line carries it: the option's id when the client knows it, else its name. */
export interface ChosenModifier {
  id?: string;
  name: string;
  priceDeltaMinor: number;
}

export type ModifierCheck =
  | { ok: true; modifiers: { name: string; priceDeltaMinor: number }[] }
  | { ok: false; code: 'MODIFIER_INVALID' | 'MODIFIER_PRICE_CHANGED' };

/**
 * Checks an order line's chosen options against the item's option groups.
 * The menu, never the client, decides an option's price: an unknown,
 * unavailable or repeated option, or a group outside its min and max, makes
 * the line invalid, and a price the client saw that is no longer the menu's
 * asks the customer to look again instead of charging a different amount.
 * An option is found by id, else by the "Group: Option" name the ordering
 * page shows, else by its bare name. The result carries the canonical name
 * and the menu's price, which the order snapshots.
 */
export function resolveLineModifiers(groups: ModifierCatalogueGroup[], chosen: ChosenModifier[]): ModifierCheck {
  const counts = new Map<string, number>(groups.map((g) => [g.id, 0]));
  const used = new Set<string>();
  const resolved: { name: string; priceDeltaMinor: number }[] = [];
  let priceChanged = false;
  for (const choice of chosen) {
    const name = choice.name.trim();
    const candidates = groups.flatMap((group) =>
      group.modifiers
        .filter((m) =>
          choice.id !== undefined ? m.id === choice.id : `${group.name}: ${m.name}` === name || m.name === name,
        )
        .map((modifier) => ({ group, modifier })),
    );
    const match = candidates.find(
      ({ group, modifier }) => !used.has(modifier.id) && (counts.get(group.id) ?? 0) < group.maxSelect,
    );
    if (!match || !match.modifier.isAvailable) return { ok: false, code: 'MODIFIER_INVALID' };
    used.add(match.modifier.id);
    counts.set(match.group.id, (counts.get(match.group.id) ?? 0) + 1);
    if (choice.priceDeltaMinor !== match.modifier.priceDeltaMinor) priceChanged = true;
    resolved.push({
      name: `${match.group.name}: ${match.modifier.name}`,
      priceDeltaMinor: match.modifier.priceDeltaMinor,
    });
  }
  if (groups.some((g) => (counts.get(g.id) ?? 0) < g.minSelect)) return { ok: false, code: 'MODIFIER_INVALID' };
  if (priceChanged) return { ok: false, code: 'MODIFIER_PRICE_CHANGED' };
  return { ok: true, modifiers: resolved };
}
