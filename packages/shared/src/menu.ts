import { z } from 'zod';
import { BasisPointsSchema, MinorAmountSchema } from './money';
import { UuidSchema } from './validators';
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

export const CreateMenuCategorySchema = z.object({ name: MenuName, sortOrder: SortOrder.optional() }).strict();
export type CreateMenuCategoryInput = z.infer<typeof CreateMenuCategorySchema>;

export const UpdateMenuCategorySchema = z
  .object({ name: MenuName.optional(), sortOrder: SortOrder.optional(), isActive: z.boolean().optional() })
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
  items: MenuItemAdminDTO[];
}

export interface MenuAdminDTO {
  currency: string;
  categories: MenuCategoryAdminDTO[];
}
