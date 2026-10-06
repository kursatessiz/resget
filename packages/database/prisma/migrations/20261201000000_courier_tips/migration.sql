-- CreateEnum
CREATE TYPE "CourierTipStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'CHARGED_BACK');

-- CreateEnum
CREATE TYPE "TipPassThroughStatus" AS ENUM ('SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'COURIER_TIP';
ALTER TYPE "LedgerEntryType" ADD VALUE 'COURIER_TIP_FEE';

-- CreateTable
CREATE TABLE "courier_tips" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierMembershipId" TEXT,
    "deliveryRequestId" TEXT,
    "status" "CourierTipStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "pspFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" "PaymentMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "capturedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "passThroughStatus" "TipPassThroughStatus",
    "passThroughRef" TEXT,
    "passThroughAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_tips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courier_tips_orderId_key" ON "courier_tips"("orderId");

-- CreateIndex
CREATE INDEX "courier_tips_restaurantId_capturedAt_idx" ON "courier_tips"("restaurantId", "capturedAt");

-- CreateIndex
CREATE INDEX "courier_tips_courierMembershipId_capturedAt_idx" ON "courier_tips"("courierMembershipId", "capturedAt");

-- AddForeignKey
ALTER TABLE "courier_tips" ADD CONSTRAINT "courier_tips_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_tips" ADD CONSTRAINT "courier_tips_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_tips" ADD CONSTRAINT "courier_tips_courierMembershipId_fkey" FOREIGN KEY ("courierMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_tips" ADD CONSTRAINT "courier_tips_deliveryRequestId_fkey" FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

