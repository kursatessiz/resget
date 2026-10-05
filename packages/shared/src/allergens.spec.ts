import {
  AllergenListSchema,
  DietaryTagListSchema,
  allergensFrom,
  avoidsAllergens,
  dietaryConflicts,
  dietaryTagsFrom,
} from './allergens';

describe('allergens', () => {
  it('reads stored values in catalogue order and drops unknown ones', () => {
    expect(allergensFrom(['milk', 'gluten', 'bogus'])).toEqual(['gluten', 'milk']);
    expect(dietaryTagsFrom(['spicy', 'vegan', 'keto'])).toEqual(['vegan', 'spicy']);
    expect(allergensFrom(null)).toEqual([]);
  });

  it('refuses unknown and repeated entries on input', () => {
    expect(AllergenListSchema.safeParse(['gluten', 'gluten']).success).toBe(false);
    expect(AllergenListSchema.safeParse(['shellfish']).success).toBe(false);
    expect(DietaryTagListSchema.safeParse(['vegan', 'spicy']).success).toBe(true);
  });

  it('flags tags that contradict the allergens', () => {
    expect(dietaryConflicts(['milk'], ['vegan', 'vegetarian', 'lactose_free'])).toEqual(['vegan', 'lactose_free']);
    expect(dietaryConflicts(['gluten', 'fish'], ['gluten_free', 'vegetarian', 'spicy'])).toEqual([
      'gluten_free',
      'vegetarian',
    ]);
    expect(dietaryConflicts(['sesame'], ['vegan'])).toEqual([]);
  });

  it('hides an item that contains anything the guest avoids', () => {
    expect(avoidsAllergens({ allergens: ['milk', 'eggs'] }, ['eggs'])).toBe(false);
    expect(avoidsAllergens({ allergens: ['milk'] }, ['nuts'])).toBe(true);
    expect(avoidsAllergens({ allergens: [] }, [])).toBe(true);
  });
});
