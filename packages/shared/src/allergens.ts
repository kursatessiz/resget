import { z } from 'zod';

/**
 * Allergens and dietary tags on menu items (docs/ALERJENLER.md, module
 * allergens). The fourteen allergens are the list food law names for
 * labelling (EU Regulation 1169/2011 Annex II, the Turkish Food Codex
 * labelling regulation follows the same list); they are a fixed catalogue
 * because the law fixes them, and their names come from the i18n catalogue.
 * The restaurant declares them per item; the platform only shows what was
 * declared and says so on the page.
 */

export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Claims the restaurant makes about an item; labels are allergens.diet.<tag>. */
export const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten_free', 'lactose_free', 'spicy'] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const AllergenListSchema = z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).refine(unique, 'duplicate allergen');
export const DietaryTagListSchema = z
  .array(z.enum(DIETARY_TAGS))
  .max(DIETARY_TAGS.length)
  .refine(unique, 'duplicate tag');

/** Stored values, read leniently: unknown entries are dropped and the order follows the catalogue. */
export function allergensFrom(values: readonly string[] | null | undefined): Allergen[] {
  const set = new Set(values ?? []);
  return ALLERGENS.filter((a) => set.has(a));
}

export function dietaryTagsFrom(values: readonly string[] | null | undefined): DietaryTag[] {
  const set = new Set(values ?? []);
  return DIETARY_TAGS.filter((t) => set.has(t));
}

/**
 * Tags that contradict the declared allergens: vegan with milk or eggs,
 * gluten free with gluten, lactose free with milk. The panel warns; the
 * restaurant decides.
 */
export function dietaryConflicts(allergens: readonly Allergen[], tags: readonly DietaryTag[]): DietaryTag[] {
  const has = (a: Allergen) => allergens.includes(a);
  return tags.filter(
    (tag) =>
      (tag === 'vegan' && (has('milk') || has('eggs') || has('fish') || has('crustaceans') || has('molluscs'))) ||
      (tag === 'vegetarian' && (has('fish') || has('crustaceans') || has('molluscs'))) ||
      (tag === 'gluten_free' && has('gluten')) ||
      (tag === 'lactose_free' && has('milk')),
  );
}

/** Whether an item may be shown to a guest who wants to avoid the given allergens. */
export function avoidsAllergens(item: { allergens: readonly Allergen[] }, avoid: readonly Allergen[]): boolean {
  return !item.allergens.some((a) => avoid.includes(a));
}
