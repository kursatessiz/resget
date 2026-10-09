-- Cancelled and rejected orders no longer count as the customer's orders (docs/KAYIP_RISKI.md).
-- Data only: rebuild every ordering customer's counters from the orders that were kept.
-- The churn class is recomputed by the daily sweep.
UPDATE "restaurant_customers" AS rc
SET
  "orderCount" = s.kept_count,
  "lifetimeGrossMinor" = s.kept_gross,
  "firstOrderAt" = s.first_at,
  "lastOrderAt" = s.last_at
FROM (
  SELECT
    c."id",
    COUNT(o."id")::int AS kept_count,
    COALESCE(SUM(o."itemsGrossMinor"), 0)::int AS kept_gross,
    MIN(o."placedAt") AS first_at,
    MAX(o."placedAt") AS last_at
  FROM "restaurant_customers" AS c
  LEFT JOIN "orders" AS o
    ON o."restaurantId" = c."restaurantId"
   AND o."customerUserId" = c."userId"
   AND o."status" NOT IN ('REJECTED', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_CUSTOMER')
  WHERE c."orderCount" > 0
  GROUP BY c."id"
) AS s
WHERE rc."id" = s."id";
