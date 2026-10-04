-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "ownerCustomerId" TEXT,
ADD COLUMN     "referrerCustomerId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "referral_programs" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "friendKind" TEXT NOT NULL,
    "friendPercentBps" INTEGER,
    "friendMaxDiscountMinor" INTEGER,
    "friendAmountMinor" INTEGER,
    "friendMinBasketMinor" INTEGER NOT NULL DEFAULT 0,
    "rewardAmountMinor" INTEGER NOT NULL,
    "rewardValidDays" INTEGER NOT NULL DEFAULT 90,
    "monthlyCapPerReferrer" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "friendCustomerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rewardCouponId" TEXT,
    "valueMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_programs_restaurantId_key" ON "referral_programs"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_orderId_key" ON "referral_rewards"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_rewardCouponId_key" ON "referral_rewards"("rewardCouponId");

-- CreateIndex
CREATE INDEX "referral_rewards_referrerCustomerId_createdAt_idx" ON "referral_rewards"("referrerCustomerId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_rewards_restaurantId_createdAt_idx" ON "referral_rewards"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_referrerCustomerId_key" ON "coupons"("referrerCustomerId");

-- CreateIndex
CREATE INDEX "coupons_restaurantId_source_idx" ON "coupons"("restaurantId", "source");

-- CreateIndex
CREATE INDEX "coupons_ownerCustomerId_idx" ON "coupons"("ownerCustomerId");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_programs" ADD CONSTRAINT "referral_programs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_friendCustomerId_fkey" FOREIGN KEY ("friendCustomerId") REFERENCES "restaurant_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_rewardCouponId_fkey" FOREIGN KEY ("rewardCouponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

