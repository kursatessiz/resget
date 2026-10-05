import type { trAllergens } from '../tr/allergens';

export const enAllergens: Record<keyof typeof trAllergens, string> = {
  'allergens.name.gluten': 'Gluten',
  'allergens.name.crustaceans': 'Crustaceans',
  'allergens.name.eggs': 'Eggs',
  'allergens.name.fish': 'Fish',
  'allergens.name.peanuts': 'Peanuts',
  'allergens.name.soybeans': 'Soy',
  'allergens.name.milk': 'Milk',
  'allergens.name.nuts': 'Tree nuts',
  'allergens.name.celery': 'Celery',
  'allergens.name.mustard': 'Mustard',
  'allergens.name.sesame': 'Sesame',
  'allergens.name.sulphites': 'Sulphites',
  'allergens.name.lupin': 'Lupin',
  'allergens.name.molluscs': 'Molluscs',
  'allergens.diet.vegetarian': 'Vegetarian',
  'allergens.diet.vegan': 'Vegan',
  'allergens.diet.gluten_free': 'Gluten free',
  'allergens.diet.lactose_free': 'Lactose free',
  'allergens.diet.spicy': 'Spicy',
  'allergens.contains': 'Contains: {list}',
  'allergens.filter.title': 'Leave out items with',
  'allergens.filter.disclaimer':
    'Allergen and ingredient information is provided by the business. If you have a serious allergy, check with the business before ordering.',
  'allergens.filter.allHidden': 'Every item in this section contains an allergen you chose.',
  'allergens.manage.allergens': 'Allergens',
  'allergens.manage.dietaryTags': 'Dietary tags',
  'allergens.manage.conflict': 'Tags that contradict the selected allergens: {tags}. Please check.',
  'allergens.manage.responsibility':
    'Allergen information is shown to customers as entered; the business is responsible for its accuracy.',
};
