-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('GRACE', 'EXCEPTION');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "excludedFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "restaurant_entitlements" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "until" TIMESTAMP(3),
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_entitlements_restaurantId_key_source_key" ON "restaurant_entitlements"("restaurantId", "key", "source");

-- AddForeignKey
ALTER TABLE "restaurant_entitlements" ADD CONSTRAINT "restaurant_entitlements_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plans become data: BASIC leaves out what was PRO only before (docs/PLAN_MATRISI.md); PRO leaves out nothing.
UPDATE "plans" SET "excludedFeatures" = ARRAY['crm', 'campaigns', 'analytics', 'loyalty', 'coupons', 'custom_domain', 'api_access']::TEXT[] WHERE "code" = 'BASIC';
