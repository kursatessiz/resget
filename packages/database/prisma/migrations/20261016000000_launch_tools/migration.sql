-- AlterTable
ALTER TABLE "service_areas" ADD COLUMN     "launchTarget" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "marketplace_interest" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_interest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_interest_countryCode_city_district_key" ON "marketplace_interest"("countryCode", "city", "district");

