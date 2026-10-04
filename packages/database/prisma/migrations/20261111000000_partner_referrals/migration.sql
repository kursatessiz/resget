-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "partnerCode" TEXT;

-- CreateTable
CREATE TABLE "partner_referral_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "referrerRewardDays" INTEGER NOT NULL DEFAULT 30,
    "refereeBonusDays" INTEGER NOT NULL DEFAULT 30,
    "qualifyingOrders" INTEGER NOT NULL DEFAULT 10,
    "yearlyCapPerReferrer" INTEGER NOT NULL DEFAULT 12,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_referral_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_referrals" (
    "id" TEXT NOT NULL,
    "referrerRestaurantId" TEXT NOT NULL,
    "refereeRestaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refereeBonusDays" INTEGER NOT NULL DEFAULT 0,
    "rewardDays" INTEGER,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_referrals_refereeRestaurantId_key" ON "partner_referrals"("refereeRestaurantId");

-- CreateIndex
CREATE INDEX "partner_referrals_referrerRestaurantId_createdAt_idx" ON "partner_referrals"("referrerRestaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_referrals_status_idx" ON "partner_referrals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_partnerCode_key" ON "restaurants"("partnerCode");

-- AddForeignKey
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_referrerRestaurantId_fkey" FOREIGN KEY ("referrerRestaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_refereeRestaurantId_fkey" FOREIGN KEY ("refereeRestaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

