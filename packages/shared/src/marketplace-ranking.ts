/**
 * Marketplace order (docs/VITRIN.md, "Pazaryeri sıralaması"). Deterministic
 * and explainable: restaurants that are open now come first, then a score
 * from a damped rating and recent completed orders, then the name. Nothing
 * is paid for; a future promotion product is a separate, labelled slot,
 * never a hidden weight in this score.
 */

/** Prior for the damped rating: a new restaurant starts near the middle until enough people have rated it. */
export const RATING_PRIOR_MEAN = 4;
export const RATING_PRIOR_WEIGHT = 5;
/** Weight of recent demand against the five-point rating scale. */
export const RECENT_ORDERS_WEIGHT = 0.25;

export interface RankableRestaurant {
  name: string;
  /** null when the branch has no opening hours; treated as open so a restaurant is never hidden for missing data. */
  isOpenNow: boolean | null;
  ratingSum: number;
  ratingCount: number;
  /** Completed orders in the recent window (30 days). */
  recentOrders: number;
}

/** Rating pulled towards the prior while the count is small; the plain average once it is large. */
export function dampedRating(sum: number, count: number): number {
  return (sum + RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT) / (count + RATING_PRIOR_WEIGHT);
}

export function rankingScore(
  restaurant: Pick<RankableRestaurant, 'ratingSum' | 'ratingCount' | 'recentOrders'>,
): number {
  return (
    dampedRating(restaurant.ratingSum, restaurant.ratingCount) +
    RECENT_ORDERS_WEIGHT * Math.log1p(Math.max(0, restaurant.recentOrders))
  );
}

/** Stable sort: open first, higher score first, then name with locale-neutral comparison. */
export function rankRestaurants<T extends RankableRestaurant>(restaurants: readonly T[]): T[] {
  return [...restaurants].sort((a, b) => {
    const openA = a.isOpenNow !== false ? 1 : 0;
    const openB = b.isOpenNow !== false ? 1 : 0;
    if (openA !== openB) return openB - openA;
    const diff = rankingScore(b) - rankingScore(a);
    if (Math.abs(diff) > 1e-9) return diff;
    return a.name.localeCompare(b.name);
  });
}
